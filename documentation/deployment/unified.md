# Unified Container Deployment

**Status:** ✅ Implemented

Single container with PostgreSQL, Redis, and Next.js app combined.

## Overview

All-in-one Docker image for simple deployment. PostgreSQL + Redis + App in single container with automatic secret generation and minimal configuration.

## Key Details

**Architecture:**
- PostgreSQL 16 (internal, 127.0.0.1:5432)
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
- `/app/config` - App config/logs (bind mount: ./config)
- `/app/cache` - Thumbnail cache (bind mount: ./cache)
- `/downloads` - Torrent downloads (bind mount: ./downloads)
- `/media` - Plex library (bind mount: ./media)
- `/var/lib/postgresql/data` - PostgreSQL data (bind mount: ./pgdata)
- `/var/lib/redis` - Redis data (bind mount: ./redis)

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

### Production (Pre-built Image)

**Docker Compose:**
```yaml
services:
  readmeabook:
    image: ghcr.io/kikootwo/readmeabook:latest
    ports:
      - "3030:3030"
    volumes:
      - ./config:/app/config
      - ./cache:/app/cache
      - ./downloads:/downloads
      - ./media:/media
      - ./pgdata:/var/lib/postgresql/data
      - ./redis:/var/lib/redis
    environment:
      # Optional overrides:
      # JWT_SECRET: "custom"
      # PUBLIC_URL: "https://example.com"
```

**Usage:**
```bash
docker compose -f docker-compose.unified.yml up -d
docker logs -f readmeabook-unified
```

### Local Development (Build Locally)

**For faster iteration without waiting for CI/CD:**

```bash
# Build and run locally (rebuilds on every up)
docker compose -f docker-compose.local.yml up -d --build

# View logs
docker logs -f readmeabook-local

# Rebuild after changes
docker compose -f docker-compose.local.yml up -d --build

# Stop
docker compose -f docker-compose.local.yml down
```

**Build time:** ~2-3 minutes (vs 10 minutes on CI/CD)

**Note:** `docker-compose.local.yml` uses `build:` instead of `image:` to build from `dockerfile.unified`

**Docker Run:**
```bash
docker run -d \
  --name readmeabook \
  -p 3030:3030 \
  -v ./config:/app/config \
  -v ./cache:/app/cache \
  -v ./downloads:/downloads \
  -v ./media:/media \
  -v ./pgdata:/var/lib/postgresql/data \
  -v ./redis:/var/lib/redis \
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

**Container keeps restarting - Permission errors:**
```bash
# Symptom: "could not change permissions" or "Operation not permitted" in logs
# Note: This should not happen with current version (entrypoint fixes ownership automatically)
# If using older image or encountering issues, manually fix ownership:
docker compose -f docker-compose.unified.yml down
sudo chown -R 103:107 ./pgdata
sudo chown -R 102:106 ./redis
sudo chown -R 1000:1000 ./cache ./config
docker compose -f docker-compose.unified.yml pull  # Get latest image
docker compose -f docker-compose.unified.yml up -d
```

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
# Stop container and remove database directory
docker compose -f docker-compose.unified.yml down
rm -rf ./pgdata
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

## Migration: Named Volumes → Bind Mounts

**Migrating from Docker named volumes to local directories:**

1. **Stop the container:**
```bash
docker compose -f docker-compose.unified.yml down
```

2. **Copy data from named volumes to local directories:**
```bash
# Create local directories
mkdir -p ./pgdata ./redis ./cache

# Copy PostgreSQL data
docker run --rm -v readmeabook-pgdata:/source -v $(pwd)/pgdata:/dest alpine sh -c "cp -a /source/. /dest/"

# Copy Redis data
docker run --rm -v readmeabook-redis:/source -v $(pwd)/redis:/dest alpine sh -c "cp -a /source/. /dest/"

# Copy cache data
docker run --rm -v readmeabook-cache:/source -v $(pwd)/cache:/dest alpine sh -c "cp -a /source/. /dest/"
```

3. **Update docker-compose.unified.yml** (already updated to use bind mounts)

4. **Start container with bind mounts:**
```bash
docker compose -f docker-compose.unified.yml up -d
```

5. **Verify data integrity:**
```bash
docker logs readmeabook-unified
docker exec readmeabook-unified redis-cli ping
```

6. **Remove old named volumes (optional):**
```bash
docker volume rm readmeabook-pgdata readmeabook-redis readmeabook-cache
```

**Benefits of bind mounts:**
- ✅ Easy backup/restore (standard filesystem tools)
- ✅ Direct access to data files
- ✅ Simpler migration between hosts
- ✅ No hidden volume location
- ✅ No manual ownership configuration needed (entrypoint handles it)

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

**6. Bind mount permissions**
- Issue: Container fails with "Operation not permitted" when using bind mounts (./pgdata, ./redis, ./cache)
- Cause: Docker creates bind mount directories with root ownership, postgres/redis/node users cannot write
- Fix: Entrypoint sets correct ownership before initialization (chown postgres:postgres, redis:redis, node:node)

**7. Missing server.js in standalone build**
- Issue: App fails with "Cannot find module '/app/server.js'"
- Cause: Next.js standalone output creates server.js in `.next/standalone/`, needs to be copied to `/app/`
- Fix: Dockerfile copies standalone output to root: `cp -r .next/standalone/* .`

**8. DATABASE_URL with special characters**
- Issue: Prisma fails with "invalid port number in database URL" when password has special chars
- Cause: Auto-generated passwords can contain characters that need URL encoding (@, #, $, etc.)
- Fix: Entrypoint URL-encodes password before constructing DATABASE_URL

**9. Stale Prisma client in Docker builds**
- Issue: TypeScript errors about missing Prisma fields during build (e.g., `plexHomeUserId does not exist`)
- Cause: `COPY . .` copies stale `src/generated/prisma` from local filesystem, overwriting fresh generation
- Fix: Generate Prisma client AFTER copying code + add `src/generated` to `.dockerignore`

**10. Entrypoint script line endings on Windows/WSL2**
- Issue: Container fails with "exec /entrypoint.sh: no such file or directory"
- Cause: Windows CRLF line endings in shell scripts are incompatible with Linux
- Fix: Added `.gitattributes` rule (`*.sh text eol=lf`) + Dockerfile converts line endings (`sed -i 's/\r$//'`)

**11. PostgreSQL config file mismatch**
- Issue: App fails with "password authentication failed" / "Role 'readmeabook' does not exist"
- Cause: supervisord used system config (`/etc/postgresql/15/main/postgresql.conf`) which overrides trust auth configured in data directory
- Fix: Remove `-c config_file=` from supervisord.conf, use data directory's postgresql.conf (standard behavior)

**12. Prisma migrations run before PostgreSQL available**
- Issue: "P1001: Can't reach database server" during entrypoint migrations
- Cause: Migrations ran after PostgreSQL was stopped, before supervisord started it
- Fix: Run migrations while PostgreSQL is still running in entrypoint, then stop it

**13. Scheduled jobs not initialized (setup wizard errors)**
- Issue: Setup wizard shows "Job configuration not found" for Audible/Plex jobs
- Cause: `/api/init` endpoint never called, so `schedulerService.start()` never runs and default jobs aren't created
- Fix: Created `app-start.sh` wrapper script that starts server then calls `/api/init`, supervisord uses wrapper instead of direct node command

**14. PostgreSQL binary mismatch in supervisord**
- Issue: Container logs `spawnerr: can't find command '/usr/lib/postgresql/15/bin/postgres'` and app can't reach DB.
- Cause: Base image upgraded to PostgreSQL 16 but supervisord still referenced `/usr/lib/postgresql/15/bin/postgres`.
- Fix: Update `docker/unified/supervisord.conf` to call `/usr/lib/postgresql/16/bin/postgres`.

## Related

- [Multi-container deployment](docker.md)
- [README.unified.md](../../README.unified.md) (user guide)
- [docker-compose.unified.yml](../../docker-compose.unified.yml) (example)
