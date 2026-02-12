#!/bin/bash
set -e

echo "🚀 ReadMeABook Unified Container Starting..."

# ============================================================================
# PUID/PGID USER REMAPPING (Hybrid approach with gosu)
# ============================================================================
# Hybrid approach to support user file ownership while maintaining PostgreSQL compatibility:
# - postgres user: Keep UID 103 (required by PostgreSQL), remap GID → PGID
# - redis user:    Remap UID → PUID, GID → PGID (also uses gosu at runtime)
# - node user:     Remap UID → PUID, GID → PGID (also uses gosu at runtime)
#
# NOTE: We use gosu in app-start.sh and redis-start.sh to ensure the process
# actually runs with the correct UID:GID. This fixes issues where PUID collides
# with existing system users (e.g., PUID=65534 collides with 'nobody').
#
# Result:
# - PostgreSQL data (103:PGID) - postgres user with shared group
# - Redis/App/Downloads/Media (PUID:PGID) - your user owns everything else
# - All files accessible via PGID group permissions

PUID=${PUID:-}
PGID=${PGID:-}

if [ -n "$PUID" ] && [ -n "$PGID" ]; then
    echo "🔧 PUID/PGID detected - Configuring hybrid user mapping for $PUID:$PGID"
    echo ""

    # Get current UIDs/GIDs before remapping
    POSTGRES_UID=$(id -u postgres)
    POSTGRES_GID=$(id -g postgres)
    REDIS_UID=$(id -u redis)
    NODE_UID=$(id -u node)

    echo "   Current UIDs: postgres=$POSTGRES_UID redis=$REDIS_UID node=$NODE_UID"
    echo ""
    echo "   Applying hybrid mapping strategy:"
    echo "   - postgres: Keep UID $POSTGRES_UID, remap GID → $PGID (PostgreSQL compatibility)"
    echo "   - redis:    Remap to $PUID:$PGID (full user ownership)"
    echo "   - node:     Remap to $PUID:$PGID (full user ownership)"
    echo ""

    # Step 1: Remap postgres group to PGID (keep UID 103 for PostgreSQL compatibility)
    echo "   [1/3] Remapping postgres group to $PGID..."
    groupmod -o -g "$PGID" postgres 2>/dev/null || true
    # Postgres user keeps its UID but gets the new GID
    usermod -g "$PGID" postgres

    # Step 2: Remap redis user to PUID:PGID
    echo "   [2/3] Remapping redis user to $PUID:$PGID..."
    groupmod -o -g "$PGID" redis 2>/dev/null || true
    usermod -o -u "$PUID" -g "$PGID" redis

    # Step 3: Remap node user to PUID:PGID
    echo "   [3/3] Remapping node user to $PUID:$PGID..."
    groupmod -o -g "$PGID" node 2>/dev/null || true
    usermod -o -u "$PUID" -g "$PGID" node

    echo ""
    echo "✅ User mapping complete!"
    echo ""
    echo "   File ownership will be:"
    echo "   - PostgreSQL data (/var/lib/postgresql/data): $POSTGRES_UID:$PGID"
    echo "   - Redis data      (/var/lib/redis):           $PUID:$PGID"
    echo "   - App config      (/app/config):              $PUID:$PGID"
    echo "   - Downloads       (/downloads):               $PUID:$PGID"
    echo "   - Media           (/media):                   $PUID:$PGID"
    echo ""
    echo "   On your host, these will appear as:"
    echo "   - PostgreSQL: UID $POSTGRES_UID, GID $PGID (readable via group)"
    echo "   - Everything else: Your user ($PUID:$PGID)"
    echo ""

    # For LXC users, provide helpful mapping info
    if [ "$POSTGRES_UID" != "$PUID" ]; then
        echo "   📝 LXC Note: You need to map container UID $POSTGRES_UID to an accessible host UID"
        echo "   Example lxc.idmap configuration:"
        echo "   lxc.idmap: u 0 100000 $POSTGRES_UID"
        echo "   lxc.idmap: g 0 100000 $POSTGRES_UID"
        echo "   lxc.idmap: u $POSTGRES_UID $POSTGRES_UID 1    # Passthrough postgres UID"
        echo "   lxc.idmap: g $POSTGRES_UID 100$POSTGRES_UID 1"
        echo "   lxc.idmap: u $((POSTGRES_UID + 1)) 100$((POSTGRES_UID + 1)) 65432"
        echo "   lxc.idmap: g $((POSTGRES_UID + 1)) 100$((POSTGRES_UID + 1)) 65432"
        echo ""
    fi
else
    echo "ℹ️  PUID/PGID not set - using default system user IDs"
    echo "   Default ownership:"
    echo "   - PostgreSQL data: postgres (UID 103)"
    echo "   - Redis data:      redis (UID 102)"
    echo "   - App/Downloads:   node (UID 1000)"
    echo ""
    echo "   To customize ownership, set PUID and PGID environment variables"
    echo "   Example: PUID=1000 PGID=1000"
    echo ""
fi

# ============================================================================
# GENERATE DEFAULT SECRETS IF NOT PROVIDED
# ============================================================================
generate_secret() {
    openssl rand -base64 32
}

# URL encode function for database password
urlencode() {
    local string="$1"
    local strlen=${#string}
    local encoded=""
    local pos c o

    for (( pos=0 ; pos<strlen ; pos++ )); do
        c=${string:$pos:1}
        case "$c" in
            [-_.~a-zA-Z0-9] ) o="${c}" ;;
            * ) printf -v o '%%%02x' "'$c"
        esac
        encoded+="${o}"
    done
    echo "${encoded}"
}

# Secrets file location (persisted on volume)
SECRETS_FILE="/app/config/.secrets"

# Load existing secrets from file if it exists
if [ -f "$SECRETS_FILE" ]; then
    echo "🔑 Loading persisted secrets from $SECRETS_FILE"
    source "$SECRETS_FILE"
fi

# Generate secrets only if not already set (from env, file, or generate new)
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(generate_secret)}"
export JWT_SECRET="${JWT_SECRET:-$(generate_secret)}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(generate_secret)}"
export CONFIG_ENCRYPTION_KEY="${CONFIG_ENCRYPTION_KEY:-$(generate_secret)}"

# Persist secrets to file for future container restarts
cat > "$SECRETS_FILE" <<EOF
# Auto-generated secrets - DO NOT DELETE THIS FILE
# Generated on: $(date)
POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
JWT_SECRET="$JWT_SECRET"
JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET"
CONFIG_ENCRYPTION_KEY="$CONFIG_ENCRYPTION_KEY"
EOF

chmod 600 "$SECRETS_FILE"
echo "✅ Secrets persisted to $SECRETS_FILE"

# Set other defaults
export POSTGRES_USER="${POSTGRES_USER:-readmeabook}"
export POSTGRES_DB="${POSTGRES_DB:-readmeabook}"
export PLEX_CLIENT_IDENTIFIER="${PLEX_CLIENT_IDENTIFIER:-readmeabook-$(openssl rand -hex 8)}"
export PLEX_PRODUCT_NAME="${PLEX_PRODUCT_NAME:-ReadMeABook}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

# ============================================================================
# DETECT EXTERNAL SERVICES
# ============================================================================
# Check if user provided external DATABASE_URL or REDIS_URL
USE_EXTERNAL_POSTGRES=false
USE_EXTERNAL_REDIS=false

if [ -n "$DATABASE_URL" ]; then
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
    if [ "$DB_HOST" != "127.0.0.1" ] && [ "$DB_HOST" != "localhost" ]; then
        USE_EXTERNAL_POSTGRES=true
        echo "ℹ️  External PostgreSQL detected at $DB_HOST"
    fi
fi

if [ -n "$REDIS_URL" ]; then
    # Extract host from REDIS_URL - handles both redis://host:port and redis://:password@host:port
    if echo "$REDIS_URL" | grep -q '@'; then
        REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
    else
        REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|redis://\([^:/]*\).*|\1|p')
    fi
    if [ -n "$REDIS_HOST" ] && [ "$REDIS_HOST" != "127.0.0.1" ] && [ "$REDIS_HOST" != "localhost" ]; then
        USE_EXTERNAL_REDIS=true
        echo "ℹ️  External Redis detected at $REDIS_HOST"
    fi
fi

# ============================================================================
# INITIALIZE POSTGRESQL (only if using internal PostgreSQL)
# ============================================================================
if [ "$USE_EXTERNAL_POSTGRES" = "false" ]; then
    echo "📦 Configuring internal PostgreSQL..."
    PGDATA="/var/lib/postgresql/data"
    PG_WAS_EMPTY=0

    # Ensure correct ownership of data directories (critical for bind mounts)
    echo "🔧 Setting up directory permissions..."

    # PostgreSQL directories - owned by postgres user, group accessible
    if ! chown -R postgres:postgres "$PGDATA" /var/run/postgresql 2>/dev/null; then
        echo ""
        echo "❌ ERROR: Failed to set ownership on PostgreSQL directories"
        echo ""
        echo "   This usually happens when using bind mounts on incompatible filesystems."
        echo ""
        echo "   Common causes:"
        echo "   - WSL2: Project on Windows filesystem (/mnt/c/...)"
        echo "   - NFS/CIFS: Mount without proper permission support"
        echo ""
        echo "   Solutions:"
        echo ""
        echo "   1. Use Docker named volumes (recommended for WSL2):"
        echo "      In docker-compose.yml, change:"
        echo "        - ./pgdata:/var/lib/postgresql/data"
        echo "      To:"
        echo "        - pgdata:/var/lib/postgresql/data"
        echo "      Then add at bottom:"
        echo "        volumes:"
        echo "          pgdata:"
        echo ""
        echo "   2. Move project to Linux filesystem (WSL2):"
        echo "      mkdir -p ~/readmeabook && cd ~/readmeabook"
        echo "      # Copy docker-compose.yml and restart"
        echo ""
        echo "   3. Pre-create directories with correct ownership:"
        echo "      mkdir -p pgdata redis config cache"
        echo "      # Let Docker create them on first run"
        echo ""
        exit 1
    fi

    if [ -n "$PGID" ]; then
        # With PUID/PGID: Use 750 (owner rwx, group rx) for PostgreSQL data
        # This allows the PGID group to read PostgreSQL files if needed
        chmod 750 "$PGDATA"
        chmod 775 /var/run/postgresql
    else
        # Without PUID/PGID: Use strict 700 permissions (owner only)
        chmod 700 "$PGDATA"
        chmod 775 /var/run/postgresql
    fi
else
    echo "⏭️  Skipping internal PostgreSQL setup (using external database)"
fi

# Redis directory - owned by redis user (remapped to PUID:PGID if set)
if [ "$USE_EXTERNAL_REDIS" = "false" ]; then
    if ! chown -R redis:redis /var/lib/redis 2>/dev/null; then
        echo ""
        echo "❌ ERROR: Failed to set ownership on Redis directory"
        echo "   See solutions above for PostgreSQL directories"
        echo ""
        exit 1
    fi
    chmod 770 /var/lib/redis
else
    echo "⏭️  Skipping internal Redis setup (using external Redis)"
fi

# App directories - owned by node user (remapped to PUID:PGID if set)
# These need group write permissions for shared access
if ! chown -R node:node /app/config /app/cache 2>/dev/null; then
    echo ""
    echo "❌ ERROR: Failed to set ownership on app directories"
    echo "   See solutions above for PostgreSQL directories"
    echo ""
    exit 1
fi
chmod 775 /app/config /app/cache

echo "✅ Directory permissions configured"

if [ "$USE_EXTERNAL_POSTGRES" = "false" ]; then
    # Only initialize/setup PostgreSQL if using internal instance
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
        PG_WAS_EMPTY=1
        echo "📦 Initializing PostgreSQL database..."
        su - postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA"

        # Configure PostgreSQL for local access
        echo "host all all 127.0.0.1/32 trust" >> "$PGDATA/pg_hba.conf"
        echo "host all all ::1/128 trust" >> "$PGDATA/pg_hba.conf"
        echo "local all all trust" >> "$PGDATA/pg_hba.conf"

        # Update postgresql.conf for performance
        cat >> "$PGDATA/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
max_connections = 100
shared_buffers = 128MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 512MB
log_destination = 'stderr'
logging_collector = off
EOF

        echo "✅ PostgreSQL initialized"
    else
        echo "✅ PostgreSQL data directory already exists"
    fi

    # ========================================================================
    # START POSTGRESQL TEMPORARILY TO CREATE USER/DATABASE
    # ========================================================================
    echo "🔧 Starting PostgreSQL for setup..."
    su - postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -w start -o '-c listen_addresses=127.0.0.1'"

    # Wait for PostgreSQL to be ready
    for i in {1..30}; do
        if su - postgres -c "/usr/lib/postgresql/16/bin/pg_isready -h 127.0.0.1 -p 5432" > /dev/null 2>&1; then
            echo "✅ PostgreSQL is ready"
            break
        fi
        echo "⏳ Waiting for PostgreSQL to be ready... ($i/30)"
        sleep 1
    done

    # Always ensure user and database exist (safe due to IF NOT EXISTS checks)
    # This handles cases where data directory exists but user/database don't
    echo "👤 Ensuring database user and database exist..."
    su - postgres -c "psql -h 127.0.0.1 -U postgres" <<EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$POSTGRES_USER') THEN
        CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';
        RAISE NOTICE 'Created user $POSTGRES_USER';
    ELSE
        RAISE NOTICE 'User $POSTGRES_USER already exists';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE $POSTGRES_DB' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$POSTGRES_DB')\\gexec

GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;
ALTER DATABASE $POSTGRES_DB OWNER TO $POSTGRES_USER;
EOF

    if [ "$PG_WAS_EMPTY" -eq 1 ]; then
        echo "✅ Database initialized and setup complete"
    else
        echo "✅ Database user and permissions verified"
    fi

fi

# ============================================================================
# SET ENVIRONMENT VARIABLES FOR APP
# ============================================================================
# Set DATABASE_URL and REDIS_URL based on whether we're using internal or external services
if [ "$USE_EXTERNAL_POSTGRES" = "false" ]; then
    # URL-encode the password to handle special characters
    ENCODED_PASSWORD=$(urlencode "$POSTGRES_PASSWORD")
    export DATABASE_URL="postgresql://$POSTGRES_USER:$ENCODED_PASSWORD@127.0.0.1:5432/$POSTGRES_DB"
    echo "✅ Using internal PostgreSQL (127.0.0.1:5432)"
else
    # DATABASE_URL already set by user - do not modify
    echo "✅ Using external DATABASE_URL: $(echo "$DATABASE_URL" | sed 's|//.*@|//***@|')"
fi

if [ "$USE_EXTERNAL_REDIS" = "false" ]; then
    export REDIS_URL="redis://127.0.0.1:6379"
    echo "✅ Using internal Redis (127.0.0.1:6379)"
else
    # REDIS_URL already set by user - do not modify
    echo "✅ Using external REDIS_URL: $(echo "$REDIS_URL" | sed 's|//.*@|//***@|')"
fi

export NODE_ENV="production"
export PORT="3030"
export HOSTNAME="0.0.0.0"

# Persist environment variables for supervisord and child processes
# PUID/PGID are critical for gosu-based user switching in app-start.sh and redis-start.sh
cat > /etc/environment <<EOF
DATABASE_URL=$DATABASE_URL
REDIS_URL=$REDIS_URL
USE_EXTERNAL_POSTGRES=$USE_EXTERNAL_POSTGRES
USE_EXTERNAL_REDIS=$USE_EXTERNAL_REDIS
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
CONFIG_ENCRYPTION_KEY=$CONFIG_ENCRYPTION_KEY
PLEX_CLIENT_IDENTIFIER=$PLEX_CLIENT_IDENTIFIER
PLEX_PRODUCT_NAME=$PLEX_PRODUCT_NAME
LOG_LEVEL=$LOG_LEVEL
NODE_ENV=$NODE_ENV
PORT=$PORT
HOSTNAME=$HOSTNAME
PUID=${PUID:-}
PGID=${PGID:-}
ROOTLESS_CONTAINER=${ROOTLESS_CONTAINER:-}
EOF

echo "✅ Environment configured"

# ============================================================================
# RUN PRISMA MIGRATIONS
# ============================================================================
if [ "$USE_EXTERNAL_POSTGRES" = "true" ]; then
    echo "⚠️  Running schema sync against EXTERNAL database - prisma db push --accept-data-loss"
    echo "   This runs on every container start. Ensure your external database is backed up."
fi
echo "🔄 Running Prisma migrations..."
cd /app
su - node -c "cd /app && DATABASE_URL='$DATABASE_URL' npx prisma db push --skip-generate --accept-data-loss" || echo "⚠️  Migrations may have failed, continuing..."

# Stop internal PostgreSQL (supervisord will restart it via wrapper)
if [ "$USE_EXTERNAL_POSTGRES" = "false" ]; then
    echo "🔧 Stopping temporary PostgreSQL instance..."
    su - postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA stop -m fast"
fi

# ============================================================================
# DISPLAY STARTUP INFO
# ============================================================================
echo ""
echo "============================================"
echo "🎉 ReadMeABook is starting!"
echo "============================================"
echo "📍 Access your application at: http://localhost:3030"
echo ""
if [ "$POSTGRES_PASSWORD" = "$(generate_secret)" ]; then
    echo "🔐 Auto-generated secrets (first run):"
    echo "   - Database password: $POSTGRES_PASSWORD"
    echo "   - Store these securely if you need to access the database directly"
fi
echo ""
echo "📊 Services starting:"
if [ "$USE_EXTERNAL_POSTGRES" = "false" ]; then
    echo "   - PostgreSQL (internal, 127.0.0.1:5432)"
else
    echo "   - PostgreSQL (external - local instance disabled)"
fi
if [ "$USE_EXTERNAL_REDIS" = "false" ]; then
    echo "   - Redis (internal, 127.0.0.1:6379, UID:GID=${PUID:-102}:${PGID:-102})"
else
    echo "   - Redis (external - local instance disabled)"
fi
echo "   - Next.js App (port 3030, UID:GID=${PUID:-1000}:${PGID:-1000})"
if [ "${ROOTLESS_CONTAINER}" = "true" ]; then
    echo ""
    echo "🔐 ROOTLESS_CONTAINER=true - gosu will be skipped (user namespace handles UID mapping)"
elif [ -n "$PUID" ] && [ -n "$PGID" ]; then
    echo ""
    echo "🔐 Using gosu for reliable UID:GID switching"
    echo "   App and Redis will run as $PUID:$PGID"
fi
echo "============================================"
echo ""

# Start supervisord with all services
exec "$@"
