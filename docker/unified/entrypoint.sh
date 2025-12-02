#!/bin/bash
set -e

echo "🚀 ReadMeABook Unified Container Starting..."

# ============================================================================
# GENERATE DEFAULT SECRETS IF NOT PROVIDED
# ============================================================================
generate_secret() {
    openssl rand -base64 32
}

# Generate secrets only if not already set
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(generate_secret)}"
export JWT_SECRET="${JWT_SECRET:-$(generate_secret)}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(generate_secret)}"
export CONFIG_ENCRYPTION_KEY="${CONFIG_ENCRYPTION_KEY:-$(generate_secret)}"

# Set other defaults
export POSTGRES_USER="${POSTGRES_USER:-readmeabook}"
export POSTGRES_DB="${POSTGRES_DB:-readmeabook}"
export PLEX_CLIENT_IDENTIFIER="${PLEX_CLIENT_IDENTIFIER:-readmeabook-$(openssl rand -hex 8)}"
export PLEX_PRODUCT_NAME="${PLEX_PRODUCT_NAME:-ReadMeABook}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

# ============================================================================
# INITIALIZE POSTGRESQL
# ============================================================================
PGDATA="/var/lib/postgresql/data"

# Ensure correct ownership of data directories (critical for bind mounts)
echo "🔧 Setting up directory permissions..."
chown -R postgres:postgres "$PGDATA" /var/run/postgresql
chown -R redis:redis /var/lib/redis
chown -R node:node /app/config /app/cache

if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "📦 Initializing PostgreSQL database..."
    su - postgres -c "/usr/lib/postgresql/15/bin/initdb -D $PGDATA"

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

# ============================================================================
# START POSTGRESQL TEMPORARILY TO CREATE USER/DATABASE
# ============================================================================
echo "🔧 Starting PostgreSQL for setup..."
su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D $PGDATA -w start -o '-c listen_addresses=127.0.0.1'"

# Wait for PostgreSQL to be ready
for i in {1..30}; do
    if su - postgres -c "psql -h 127.0.0.1 -U postgres -c 'SELECT 1'" > /dev/null 2>&1; then
        echo "✅ PostgreSQL is ready"
        break
    fi
    echo "⏳ Waiting for PostgreSQL to be ready... ($i/30)"
    sleep 1
done

# Create user and database if they don't exist
echo "👤 Setting up database user and database..."
su - postgres -c "psql -h 127.0.0.1 -U postgres" <<EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$POSTGRES_USER') THEN
        CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE $POSTGRES_DB' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$POSTGRES_DB')\\gexec

GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;
ALTER DATABASE $POSTGRES_DB OWNER TO $POSTGRES_USER;
EOF

echo "✅ Database setup complete"

# Stop PostgreSQL (supervisord will start it)
su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D $PGDATA stop -m fast"

# ============================================================================
# SET ENVIRONMENT VARIABLES FOR APP
# ============================================================================
export DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:5432/$POSTGRES_DB"
export REDIS_URL="redis://127.0.0.1:6379"
export NODE_ENV="production"
export PORT="3030"
export HOSTNAME="0.0.0.0"

# Persist environment variables for supervisord
cat > /etc/environment <<EOF
DATABASE_URL=$DATABASE_URL
REDIS_URL=$REDIS_URL
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
CONFIG_ENCRYPTION_KEY=$CONFIG_ENCRYPTION_KEY
PLEX_CLIENT_IDENTIFIER=$PLEX_CLIENT_IDENTIFIER
PLEX_PRODUCT_NAME=$PLEX_PRODUCT_NAME
LOG_LEVEL=$LOG_LEVEL
NODE_ENV=$NODE_ENV
PORT=$PORT
HOSTNAME=$HOSTNAME
EOF

echo "✅ Environment configured"

# ============================================================================
# RUN PRISMA MIGRATIONS
# ============================================================================
echo "🔄 Running Prisma migrations..."
cd /app
su - node -c "cd /app && DATABASE_URL='$DATABASE_URL' npx prisma db push --skip-generate --accept-data-loss" || echo "⚠️  Migrations may have failed, continuing..."

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
echo "   - PostgreSQL (internal)"
echo "   - Redis (internal)"
echo "   - Next.js App (port 3030)"
echo "============================================"
echo ""

# Start supervisord with all services
exec "$@"
