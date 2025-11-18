# Unified Container Deployment

**Status:** ✅ Implemented

Single container with PostgreSQL, Redis, and Next.js app combined.

## Overview

All-in-one Docker image for simple deployment. PostgreSQL + Redis + App in single container with automatic secret generation and minimal configuration.

## Key Details

**Architecture:**
- PostgreSQL 15 (internal, 127.0.0.1:5432)
- Redis 7 (internal, 127.0.0.1:6379)
- Next.js app (exposed, 0.0.0.0:3030)
- Supervisord manages all processes

**Image:** `ghcr.io/kikootwo/readmeabook:latest`

**Auto-generated secrets:**
- `JWT_SECRET` - Random 32-byte base64
- `JWT_REFRESH_SECRET` - Random 32-byte base64
- `CONFIG_ENCRYPTION_KEY` - Random 32-byte base64
- `POSTGRES_PASSWORD` - Random 32-byte base64
- `PLEX_CLIENT_IDENTIFIER` - Random hex ID

**Volumes:**
- `/app/config` - App config/logs (bind mount)
- `/downloads` - Torrent downloads (bind mount)
- `/media` - Plex library (bind mount)
- `/var/lib/postgresql/data` - PostgreSQL data (volume)
- `/var/lib/redis` - Redis data (volume)

## Dockerfile Structure

**Base:** `node:20-bookworm` (debian with node)

**Installed packages:**
- postgresql-15
- redis-server
- supervisor
- curl, openssl

**Build process:**
1. Install dependencies (production only)
2. Generate Prisma client
3. Build Next.js app
4. Create directories (postgres, redis, app)
5. Copy supervisord.conf and entrypoint.sh

**Files:**
- `dockerfile.unified` - Main Dockerfile
- `docker/unified/supervisord.conf` - Process manager config
- `docker/unified/entrypoint.sh` - Startup script

## Startup Sequence

**Entrypoint script (`entrypoint.sh`):**
1. Generate secrets if not provided
2. Initialize PostgreSQL if first run
3. Start PostgreSQL temporarily
4. Create database user and database
5. Stop PostgreSQL
6. Export environment variables
7. Run Prisma migrations
8. Start supervisord (postgres → redis → app)

**Supervisord priorities:**
- PostgreSQL: priority 10 (starts first)
- Redis: priority 20 (starts second)
- App: priority 30 (starts last)

**Logs:** All services output to stdout/stderr (visible in `docker logs`)

## Deployment

**Docker Compose:**
```yaml
services:
  readmeabook:
    image: ghcr.io/kikootwo/readmeabook:latest
    ports:
      - "3030:3030"
    volumes:
      - ./config:/app/config
      - ./downloads:/downloads
      - ./media:/media
      - readmeabook-pgdata:/var/lib/postgresql/data
      - readmeabook-redis:/var/lib/redis
    environment:
      # Optional overrides:
      # JWT_SECRET: "custom"
      # PUBLIC_URL: "https://example.com"
```

**Docker Run:**
```bash
docker run -d \
  --name readmeabook \
  -p 3030:3030 \
  -v ./config:/app/config \
  -v ./downloads:/downloads \
  -v ./media:/media \
  -v readmeabook-data:/var/lib/postgresql/data \
  -v readmeabook-redis:/var/lib/redis \
  ghcr.io/kikootwo/readmeabook:latest
```

## Environment Variables

**All optional (auto-generated if not set):**
- `JWT_SECRET` - JWT signing key
- `JWT_REFRESH_SECRET` - Refresh token key
- `CONFIG_ENCRYPTION_KEY` - DB encryption key
- `POSTGRES_PASSWORD` - Postgres password
- `POSTGRES_USER` - Postgres user (default: readmeabook)
- `POSTGRES_DB` - Database name (default: readmeabook)
- `PLEX_CLIENT_IDENTIFIER` - Plex client ID
- `PLEX_PRODUCT_NAME` - Plex product name
- `LOG_LEVEL` - Log level (default: info)
- `PUBLIC_URL` - Public URL for callbacks

**Internal (set automatically):**
- `DATABASE_URL` - Built from postgres vars
- `REDIS_URL` - redis://127.0.0.1:6379
- `NODE_ENV` - production
- `PORT` - 3030
- `HOSTNAME` - 0.0.0.0

## GitHub Action

**File:** `.github/workflows/build-unified-image.yml`

**Triggers:**
- Push to `main` branch
- Tags matching `v*`
- Manual workflow dispatch
- Pull requests (build only, no push)

**Platforms:**
- linux/amd64
- linux/arm64

**Tags:**
- `latest` (main branch)
- `v1.2.3` (version tags)
- `v1.2` (minor version)
- `v1` (major version)
- `main-<sha>` (commit SHA)

**Registry:** GitHub Container Registry (ghcr.io)

**Permissions:** Uses `GITHUB_TOKEN` (no manual setup needed)

## Logs

**View all logs:**
```bash
docker logs readmeabook-unified
docker logs -f readmeabook-unified  # Follow
```

**Filter by service:**
```bash
docker logs readmeabook-unified 2>&1 | grep "postgresql"
docker logs readmeabook-unified 2>&1 | grep "redis"
docker logs readmeabook-unified 2>&1 | grep "app"
```

**Supervisord manages log output:**
- All stdout → container stdout
- All stderr → container stderr
- No log files (everything to console)

## Troubleshooting

**Database access:**
```bash
docker exec -it readmeabook-unified \
  su - postgres -c "psql -h 127.0.0.1 -U readmeabook"
```

**Redis test:**
```bash
docker exec readmeabook-unified redis-cli ping
# Should return: PONG
```

**Check migrations:**
```bash
docker exec readmeabook-unified \
  su - node -c "cd /app && npx prisma migrate status"
```

**Reset database:**
```bash
docker volume rm readmeabook-pgdata
docker compose -f docker-compose.unified.yml up -d
```

## Backup/Restore

**Backup:**
```bash
docker exec readmeabook-unified \
  su - postgres -c "pg_dump -h 127.0.0.1 -U readmeabook readmeabook" \
  > backup.sql
```

**Restore:**
```bash
cat backup.sql | docker exec -i readmeabook-unified \
  su - postgres -c "psql -h 127.0.0.1 -U readmeabook readmeabook"
```

## vs Multi-Container

**Unified advantages:**
- ✅ Single container (simple)
- ✅ No external dependencies
- ✅ Auto-configured networking
- ✅ Minimal environment variables

**Multi-container advantages:**
- ✅ Independent service scaling
- ✅ Separate backups
- ✅ External DB access
- ✅ Resource limits per service

**Use unified for:** Simple deployments, single-host, easy updates
**Use multi-container for:** Complex setups, scaling, orchestration

## Security Notes

1. **Auto-generated secrets:** Secure by default (32-byte random)
2. **Override in production:** Set environment variables for persistent secrets
3. **No external DB access:** PostgreSQL bound to 127.0.0.1
4. **No external Redis access:** Redis bound to 127.0.0.1
5. **Use reverse proxy:** HTTPS termination (Nginx, Caddy, Traefik)

## Fixed Issues ✅

**1. PostgreSQL initialization**
- Issue: First-run database creation
- Fix: Entrypoint script initializes and creates user/database

**2. Multi-process logging**
- Issue: Need logs from all services
- Fix: Supervisord configured with stdout/stderr to /dev/stdout|stderr

**3. Secret management**
- Issue: Users need to set many secrets
- Fix: Auto-generate all secrets on first run with openssl

**4. Startup ordering**
- Issue: App starts before DB ready
- Fix: Supervisord priorities + entrypoint pre-starts DB for init

**5. Prisma migrations**
- Issue: Need to run migrations before app starts
- Fix: Entrypoint runs `prisma db push` after DB init

## Related

- [Multi-container deployment](docker.md)
- [README.unified.md](../../README.unified.md) (user guide)
- [docker-compose.unified.yml](../../docker-compose.unified.yml) (example)
