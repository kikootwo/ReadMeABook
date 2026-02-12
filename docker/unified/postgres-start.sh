#!/bin/bash
# PostgreSQL startup wrapper for unified container
# Checks USE_EXTERNAL_POSTGRES flag (set by entrypoint) to decide whether
# to start the local instance or sleep to keep supervisord happy.

set -e

# Load environment from /etc/environment (set by entrypoint)
if [ -f /etc/environment ]; then
    set -a
    source /etc/environment
    set +a
fi

if [ "$USE_EXTERNAL_POSTGRES" = "true" ]; then
    echo "[PostgreSQL] External database configured - skipping local instance"
    exec sleep infinity
fi

echo "[PostgreSQL] Starting local PostgreSQL server..."
exec /usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/data
