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

cd /app

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
# connectivity. We must wait for both before initializing scheduled jobs.

HEALTH_URL="http://localhost:3030/api/health"
INIT_URL="http://localhost:3030/api/init"
READY_TIMEOUT=${APP_READY_TIMEOUT:-60}
INIT_RETRIES=${APP_INIT_RETRIES:-5}

echo "[App] Waiting for server to be ready (timeout: ${READY_TIMEOUT}s)..."

READY=false
for i in $(seq 1 "$READY_TIMEOUT"); do
    # Check if the server process is still alive
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[App] ERROR: Server process (PID $SERVER_PID) exited unexpectedly"
        exit 1
    fi

    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
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

if [ "$READY" = "false" ]; then
    echo "[App] ERROR: Server did not become healthy within ${READY_TIMEOUT}s"
    echo "[App] The scheduler will not be initialized - scheduled jobs may be missing"
    echo "[App] Check server logs above for errors (database connection, port conflict, etc.)"
else
    # =========================================================================
    # INITIALIZE APPLICATION SERVICES
    # =========================================================================
    # Creates default scheduled jobs, runs credential migration, etc.
    # Retry with backoff to handle transient failures during startup.

    echo "[App] Initializing application services..."

    INIT_SUCCESS=false
    for attempt in $(seq 1 "$INIT_RETRIES"); do
        HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$INIT_URL" 2>/dev/null) || HTTP_CODE="000"

        if [ "$HTTP_CODE" = "200" ]; then
            INIT_SUCCESS=true
            echo "[App] Services initialized successfully"
            break
        fi

        echo "[App] Init attempt $attempt/$INIT_RETRIES failed (HTTP $HTTP_CODE), retrying in ${attempt}s..."
        sleep "$attempt"
    done

    if [ "$INIT_SUCCESS" = "false" ]; then
        echo "[App] ERROR: Failed to initialize services after $INIT_RETRIES attempts"
        echo "[App] Scheduled jobs may be missing - check application logs for details"
    fi
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

# Wait for server process (keeps the script running as long as the server is alive)
wait $SERVER_PID
