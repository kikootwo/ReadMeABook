#!/bin/bash
# Redis startup wrapper for unified container
# Checks USE_EXTERNAL_REDIS flag (set by entrypoint) to decide whether
# to start the local instance or sleep to keep supervisord happy.
#
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

if [ "$USE_EXTERNAL_REDIS" = "true" ]; then
    echo "[Redis] External Redis configured - skipping local instance"
    exec sleep infinity
fi

echo "[Redis] Starting local Redis server..."

# Get PUID/PGID (default to redis user's current IDs if not set)
PUID=${PUID:-$(id -u redis)}
PGID=${PGID:-$(id -g redis)}

echo "[Redis] Process will run as UID:GID = $PUID:$PGID"

# =============================================================================
# START REDIS WITH APPROPRIATE UID:GID HANDLING
# =============================================================================
# Two scenarios:
# 1. Default: Running as root, use gosu to switch to PUID:PGID
# 2. ROOTLESS_CONTAINER=true: Skip gosu (rootless Podman user namespace handles UID mapping)

REDIS_CMD="/usr/bin/redis-server --appendonly yes --dir /var/lib/redis --bind 127.0.0.1 --port 6379"

if [ "$(id -u)" = "0" ]; then
    if [ "${ROOTLESS_CONTAINER}" = "true" ]; then
        # Rootless Podman: Skip gosu - user namespace already maps UID 0 to host user
        echo "[Redis] ROOTLESS_CONTAINER=true - skipping gosu (user namespace handles UID mapping)"
        exec $REDIS_CMD
    else
        # Default: Use gosu to switch to the specified PUID:PGID
        echo "[Redis] Switching to UID:GID $PUID:$PGID via gosu..."
        exec gosu "$PUID:$PGID" $REDIS_CMD
    fi
else
    # Not running as root - run directly (fallback for unusual configurations)
    echo "[Redis] Warning: Not running as root, cannot use gosu. Running as current user ($(id -u):$(id -g))."
    exec $REDIS_CMD
fi
