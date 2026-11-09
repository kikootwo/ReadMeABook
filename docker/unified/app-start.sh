#!/bin/bash
# App startup wrapper for unified container
# Uses gosu to ensure correct PUID:PGID for file operations
#
# Supports:
# - Docker/LXC: Uses gosu to switch to PUID:PGID (default)
# - Rootless Podman: Set ROOTLESS_CONTAINER=true to skip gosu

set -e

# Load environment from /etc/environment (set by entrypoint)
if [ -f /etc/environment ]; then
    set -a
    source /etc/environment
    set +a
fi

# Get PUID/PGID (default to node user's current IDs if not set)
PUID=${PUID:-$(id -u node)}
PGID=${PGID:-$(id -g node)}

echo "[App] Starting Next.js server..."
echo "[App] Process will run as UID:GID = $PUID:$PGID"

# Apply UMASK if set (controls default file permissions)
if [ -n "$UMASK" ]; then
    echo "[App] Applying umask: $UMASK"
    umask "$UMASK"
fi

cd /app

# =============================================================================
# STOP HANDLING
# =============================================================================
# supervisord sends SIGTERM to this wrapper only. The wrapper forwards it to node
# and keeps waiting, so node gets its stop window (src/lib/startup/shutdown-coordinator.ts,
# hard deadline 5 s) and the wrapper exits after it. With this set, Next.js leaves
# SIGTERM/SIGINT to that coordinator instead of exiting at once.
export NEXT_MANUAL_SIG_HANDLE=true

# Node's deadline is a timer on its own event loop. A node too busy or stuck to run it
# is SIGKILLed this many seconds after the stop by wall clock, so on Docker's and
# Unraid's default 10 s stop Redis and PostgreSQL still get their stop signal.
# Above node's 5 s deadline, below supervisord's stopwaitsecs=8 (tests/docker/supervisord-config.test.ts).
APP_STOP_KILL_AFTER=6

SERVER_PID=""
STOPPING=0

# shellcheck disable=SC2317 # reached through the trap below
on_stop() {
    # One forward and one watchdog per stop; node ignores a second signal anyway
    if [ "$STOPPING" = "1" ]; then return 0; fi
    STOPPING=1
    # $! covers a signal that lands between starting node and recording its PID
    local pid="${SERVER_PID:-$!}"
    if [ -z "$pid" ]; then
        echo "[App] Stop requested before node started"
        exit 143
    fi
    SERVER_PID="$pid"
    echo "[App] Stop requested, sending SIGTERM to node (PID $SERVER_PID)"
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    # Watchdog in this process group: end_leftovers ends it once node is gone
    (
        sleep "$APP_STOP_KILL_AFTER"
        if kill -0 "$SERVER_PID" 2>/dev/null; then
            echo "[App] node did not stop within ${APP_STOP_KILL_AFTER}s, sending SIGKILL (PID $SERVER_PID)"
            kill -KILL "$SERVER_PID" 2>/dev/null || true
        fi
    ) &
}
trap on_stop TERM INT

# Fills LEFTOVER with the PIDs in this wrapper's process group other than the wrapper
# (supervisord makes it the group leader). Builtins only, so no helper process is
# counted. Node's ffmpeg children (chapter merge, tagging) are not detached and stay here.
LEFTOVER=""
find_leftovers() {
    local stat line rest pid pgrp
    LEFTOVER=""
    for stat in /proc/[0-9]*/stat; do
        # Braces: the redirect's own error (a process gone since the glob) goes to /dev/null too
        { read -r line < "$stat"; } 2>/dev/null || continue
        pid="${stat#/proc/}"
        pid="${pid%/stat}"
        rest="${line##*) }"
        # rest: state ppid pgrp ...
        read -r _ _ pgrp _ <<< "$rest" || continue
        if [ "$pgrp" = "$$" ] && [ "$pid" != "$$" ]; then
            LEFTOVER="$LEFTOVER $pid"
        fi
    done
}

# Run only once node is gone. Anything node left behind (an ffmpeg mid-merge) would
# otherwise outlive it and write the same temp file as the rerun after a restart.
end_leftovers() {
    trap '' TERM INT
    kill -TERM -- "-$$" 2>/dev/null || true
    local _i
    for _i in 1 2 3 4 5 6 7 8 9 10; do
        find_leftovers
        if [ -z "$LEFTOVER" ]; then return 0; fi
        sleep 0.1
    done
    echo "[App] Ending leftover processes:$LEFTOVER"
    # shellcheck disable=SC2086 # word splitting intended: one PID per word
    kill -KILL $LEFTOVER 2>/dev/null || true
}

finish() {
    end_leftovers
    exit "$1"
}

# Sets NODE_STATUS once node is gone. A trapped signal cuts `wait` short with a status
# above 128, and `set -e` would end the script right there and orphan node: wait again
# while node runs, then once more for a status a cut-short wait did not collect.
NODE_STATUS=0
wait_for_node() {
    local again
    while :; do
        NODE_STATUS=0
        wait "$SERVER_PID" || NODE_STATUS=$?
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
    done
    if [ "$NODE_STATUS" -gt 128 ]; then
        again=0
        wait "$SERVER_PID" 2>/dev/null || again=$?
        if [ "$again" -ne 127 ]; then NODE_STATUS=$again; fi
    fi
}

# =============================================================================
# START SERVER WITH APPROPRIATE UID:GID HANDLING
# =============================================================================
# Two scenarios:
# 1. Default: Running as root, use gosu to switch to PUID:PGID
# 2. ROOTLESS_CONTAINER=true: Skip gosu (rootless Podman user namespace handles UID mapping)

start_server() {
    if [ "$(id -u)" = "0" ]; then
        if [ "${ROOTLESS_CONTAINER}" = "true" ]; then
            # Rootless Podman: Skip gosu - user namespace already maps UID 0 to host user
            echo "[App] ROOTLESS_CONTAINER=true - skipping gosu (user namespace handles UID mapping)"
            node server.js &
        else
            # Default: Use gosu to switch to the specified PUID:PGID
            echo "[App] Switching to UID:GID $PUID:$PGID via gosu..."
            gosu "$PUID:$PGID" node server.js &
        fi
    else
        # Not running as root - run directly (fallback for unusual configurations)
        echo "[App] Warning: Not running as root, cannot use gosu. Running as current user ($(id -u):$(id -g))."
        node server.js &
    fi
}

# Start the server in background
start_server
SERVER_PID=$!

# =============================================================================
# WAIT FOR SERVER READINESS
# =============================================================================
# The health endpoint (/api/health) checks both the Next.js server AND database
# connectivity. This wait is for logging only: service initialization (scheduler,
# credential migration) is started by the app itself (src/instrumentation.ts) and
# retries until the database and Redis are ready.

HEALTH_URL="http://localhost:3030/api/health"
READY_TIMEOUT=${APP_READY_TIMEOUT:-60}

echo "[App] Waiting for server to be ready (timeout: ${READY_TIMEOUT}s)..."

READY=false
for i in $(seq 1 "$READY_TIMEOUT"); do
    # A stop during startup goes straight to the final wait
    if [ "$STOPPING" = "1" ]; then break; fi

    # Check if the server process is still alive
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        if [ "$STOPPING" = "1" ]; then break; fi
        wait_for_node
        echo "[App] ERROR: Server process (PID $SERVER_PID) exited unexpectedly (status $NODE_STATUS)"
        finish 1
    fi

    # bash runs the stop trap only once a foreground command returns: keep each one short
    if curl -sf --max-time 2 "$HEALTH_URL" > /dev/null 2>&1; then
        READY=true
        echo "[App] Server is healthy (took ${i}s)"
        break
    fi

    # Log progress every 10 seconds
    if [ $((i % 10)) -eq 0 ]; then
        echo "[App] Still waiting for server... (${i}/${READY_TIMEOUT}s)"
    fi

    sleep 1
done

if [ "$READY" = "false" ] && [ "$STOPPING" = "0" ]; then
    echo "[App] WARNING: Server did not become healthy within ${READY_TIMEOUT}s"
    echo "[App] Startup initialization keeps retrying inside the app - check logs for [Startup] lines"
fi

echo "[App] Server running with PID $SERVER_PID"

# Verify the process is running with correct UID:GID (for debugging)
if [ -f "/proc/$SERVER_PID/status" ]; then
    ACTUAL_UID=$(grep '^Uid:' /proc/$SERVER_PID/status | awk '{print $2}')
    ACTUAL_GID=$(grep '^Gid:' /proc/$SERVER_PID/status | awk '{print $2}')
    echo "[App] Verified process credentials: UID=$ACTUAL_UID GID=$ACTUAL_GID"

    if [ "${ROOTLESS_CONTAINER}" != "true" ] && { [ "$ACTUAL_UID" != "$PUID" ] || [ "$ACTUAL_GID" != "$PGID" ]; }; then
        echo "[App] WARNING: Process UID:GID ($ACTUAL_UID:$ACTUAL_GID) does not match expected ($PUID:$PGID)"
    fi
fi

# Keep the wrapper running as long as node runs; exit with node's status
wait_for_node
echo "[App] node exited (status $NODE_STATUS)"
finish "$NODE_STATUS"
