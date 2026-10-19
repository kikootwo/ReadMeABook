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

**Auto-generated secrets (persisted to `/app/config/.secrets`):**
- `JWT_SECRET` - Random 32-byte base64
- `JWT_REFRESH_SECRET` - Random 32-byte base64
- `CONFIG_ENCRYPTION_KEY` - Random 32-byte base64
- `POSTGRES_PASSWORD` - Random 32-byte base64
- `PLEX_CLIENT_IDENTIFIER` - Random hex ID
- **Note:** Secrets are generated once on first run and reused on subsequent container restarts

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
- postgresql-16
- redis-server
- supervisor
- curl, openssl
- ffmpeg + ffprobe 9.0.2 (static-pie, no runtime deps) → `/usr/local/bin`

**ffmpeg source:**
- `FROM mwader/static-ffmpeg:9.0.2-1@sha256:<index digest> AS ffmpeg` + `COPY --from=ffmpeg /ffmpeg /ffprobe`
- Digest = multi-arch index (amd64 + arm64); BuildKit copies the TARGETPLATFORM variant. Other platforms fail the build (no match)
- Build guard: ELF arch byte of each binary must match `uname -m`, and `-version` must equal `FFMPEG_VERSION`
- License: GPLv3 build (no nonfree/libfdk-aac); bundled lib versions at `/usr/local/share/ffmpeg/versions.json`
- Bump: change tag + digest on the `FROM` line AND `ARG FFMPEG_VERSION` together
- **Fixed (#230):** previously an unpinned amd64-only tarball from johnvansickle.com (host outages broke builds; arm64 got amd64 binaries)

**Build process:**
1. `ffmpeg` stage: pinned `mwader/static-ffmpeg` index digest (platform variant auto-selected)
2. apt install (postgres, redis, supervisor, ...)
3. `COPY --from=ffmpeg` ffmpeg/ffprobe → `/usr/local/bin`, versions.json → `/usr/local/share/ffmpeg/`
4. Guard RUN: arch + version check (failure meanings below)
5. Install dependencies (production only)
6. Generate Prisma client
7. Build Next.js app
8. Create directories (postgres, redis, app)
9. Copy supervisord.conf and entrypoint.sh

**ffmpeg guard failures:**
- `ERROR: <bin> e_machine 0x.., expected 0x.. for <arch>` → wrong-arch binary copied (platform selection broken, e.g. a `--platform` added to the ffmpeg `FROM`); never ship it
- `ERROR: expected <bin> <ver>, got: ...` → `FROM` tag/digest and `ARG FFMPEG_VERSION` disagree
- `ERROR: no pinned static ffmpeg for <arch>` → unsupported platform (only amd64/arm64)
- Bump: new tag + its multi-arch index digest on the `FROM` line (`docker buildx imagetools inspect mwader/static-ffmpeg:<tag>`) AND `ARG FFMPEG_VERSION`, in one commit

**Files:**
- `dockerfile.unified` - Main Dockerfile
- `docker/unified/supervisord.conf` - Process manager config
- `docker/unified/entrypoint.sh` - Startup script

## Startup Sequence

**Entrypoint script (`entrypoint.sh`):**
1. Load secrets from `/app/config/.secrets` if exists
2. Generate secrets if not provided (from env or file)
3. Persist secrets to `/app/config/.secrets` for future restarts
4. Initialize PostgreSQL if first run
5. Start PostgreSQL temporarily
6. Create database user and database
7. Run Prisma migrations
8. Stop PostgreSQL
9. Export environment variables
10. Start supervisord (postgres → redis → app)

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
      # RECOMMENDED: Set to your user/group IDs (run 'id' to find yours)
      # Hybrid approach: postgres keeps UID 103, everything else uses PUID:PGID
      PUID: 1000
      PGID: 1000

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
  -e PUID=1000 \
  -e PGID=1000 \
  -v ./config:/app/config \
  -v ./cache:/app/cache \
  -v ./downloads:/downloads \
  -v ./media:/media \
  -v ./pgdata:/var/lib/postgresql/data \
  -v ./redis:/var/lib/redis \
  ghcr.io/kikootwo/readmeabook:latest
```

## Environment Variables

**Recommended (for bind mount permissions):**
- `PUID` - User ID for file ownership (default: uses system defaults)
- `PGID` - Group ID for file ownership (default: uses system defaults)

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

## PUID/PGID Configuration (Hybrid Approach - Recommended)

**Problem:** Bind-mounted volumes (`./pgdata`, `./redis`, `./config`, etc.) may have permission issues, especially with:
- LXC containers with user namespace mapping
- NFS/CIFS mounts
- Running Docker as non-root user
- Multiple users accessing the same files

**Solution:** Hybrid PUID/PGID mapping that maintains PostgreSQL compatibility while giving you ownership of important files.

### How the Hybrid Approach Works

PostgreSQL requires that the database cluster owner have a specific username ("postgres"), which prevents full user remapping. The hybrid approach solves this:

**User Remapping Strategy:**
- `postgres` user: **Keeps UID 103** (PostgreSQL requirement), **remaps GID → PGID**
- `redis` user: **Fully remapped to PUID:PGID**
- `node` user: **Fully remapped to PUID:PGID**

**File Ownership Result:**
- PostgreSQL data (`/var/lib/postgresql/data`): **103:PGID**
- Redis data (`/var/lib/redis`): **PUID:PGID** ✅ Your user owns it
- App config (`/app/config`): **PUID:PGID** ✅ Your user owns it
- Downloads (`/downloads`): **PUID:PGID** ✅ Your user owns it
- Media (`/media`): **PUID:PGID** ✅ Your user owns it

**Key Benefits:**
- ✅ You fully own downloads, media, and config directories
- ✅ PostgreSQL works correctly (no username conflicts)
- ✅ All files accessible via shared PGID group
- ✅ Minimal LXC mapping needed (only UID 103)

### Usage

**Standard Docker Setup:**

```yaml
services:
  readmeabook:
    image: ghcr.io/kikootwo/readmeabook:latest
    environment:
      PUID: 1000  # Your user ID
      PGID: 1000  # Your group ID
    volumes:
      - ./config:/app/config
      - ./pgdata:/var/lib/postgresql/data
      - ./redis:/var/lib/redis
      - ./downloads:/downloads
      - ./media:/media
```

**Find your PUID/PGID:**
```bash
id
# Output: uid=1000(youruser) gid=1000(yourgroup)
```

### LXC Configuration

For LXC with user namespace mapping, you only need to passthrough container UID 103 (postgres):

**Example LXC Config:**
```bash
# File: /etc/pve/lxc/<CTID>.conf
# Map most UIDs normally (0-102 → 100000-100102)
lxc.idmap: u 0 100000 103
lxc.idmap: g 0 100000 103

# Passthrough postgres UID 103 to host UID 103
lxc.idmap: u 103 103 1
lxc.idmap: g 103 100103 1

# Map remaining UIDs (104-65536 → 100104-165536)
lxc.idmap: u 104 100104 65432
lxc.idmap: g 104 100104 65432
```

**Alternative: Map to your user:**
```bash
# If you want PostgreSQL files accessible as your host user (UID 1000):
lxc.idmap: u 0 100000 103
lxc.idmap: g 0 100000 103
lxc.idmap: u 103 1000 1      # Map container 103 → host 1000
lxc.idmap: g 103 1000 1
lxc.idmap: u 104 100104 65432
lxc.idmap: g 104 100104 65432

# Then set in docker-compose.yml:
environment:
  PUID: 1000
  PGID: 1000
```

### Startup Logs

When PUID/PGID are set, you'll see:

```
🔧 PUID/PGID detected - Configuring hybrid user mapping for 1000:1000

   Current UIDs: postgres=103 redis=102 node=1000

   Applying hybrid mapping strategy:
   - postgres: Keep UID 103, remap GID → 1000 (PostgreSQL compatibility)
   - redis:    Remap to 1000:1000 (full user ownership)
   - node:     Remap to 1000:1000 (full user ownership)

✅ User mapping complete!

   File ownership will be:
   - PostgreSQL data (/var/lib/postgresql/data): 103:1000
   - Redis data      (/var/lib/redis):           1000:1000
   - App config      (/app/config):              1000:1000
   - Downloads       (/downloads):               1000:1000
   - Media           (/media):                   1000:1000

   On your host, these will appear as:
   - PostgreSQL: UID 103, GID 1000 (readable via group)
   - Everything else: Your user (1000:1000)
```

### File Permissions

The container uses group-friendly permissions:

| Directory | Ownership | Permissions | Description |
|-----------|-----------|-------------|-------------|
| `/var/lib/postgresql/data` | 103:PGID | 750 (rwxr-x---) | PostgreSQL data, group-readable |
| `/var/lib/redis` | PUID:PGID | 770 (rwxrwx---) | Redis data, group-writable |
| `/app/config` | PUID:PGID | 775 (rwxrwxr-x) | App config, group-writable |
| `/app/cache` | PUID:PGID | 775 (rwxrwxr-x) | Thumbnail cache, group-writable |
| `/downloads` | PUID:PGID | 775 (rwxrwxr-x) | Torrent downloads, group-writable |
| `/media` | PUID:PGID | 775 (rwxrwxr-x) | Plex library, group-writable |

**Your host user (PUID:PGID) can:**
- ✅ Fully read/write: downloads, media, config, cache, redis
- ✅ Read (via group): PostgreSQL data

### Without PUID/PGID (Default Behavior)

If you don't set PUID/PGID, the container uses default system users:

```
   Default ownership:
   - PostgreSQL data: postgres (UID 103)
   - Redis data:      redis (UID 102)
   - App/Downloads:   node (UID 1000)
```

This works fine for most deployments, but files will have different owners on the host.

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

**Container fails with permission errors:**

*Symptom:* "Operation not permitted" or "Failed to set ownership" in logs

*Solution:* Set PUID and PGID in docker-compose.yml

```bash
# 1. Find your user ID and group ID
id
# Output: uid=1000(youruser) gid=1000(yourgroup)

# 2. Update docker-compose.yml:
services:
  readmeabook:
    environment:
      PUID: 1000  # Use your UID from step 1
      PGID: 1000  # Use your GID from step 1

# 3. Restart container
docker compose down
docker compose up -d
```

**LXC Permission Issues:**

*Symptom:* Files owned by UID 103 on host are not accessible

*Solution:* Configure LXC idmap to passthrough UID 103

```bash
# Edit /etc/pve/lxc/<CTID>.conf and add:
lxc.idmap: u 0 100000 103
lxc.idmap: g 0 100000 103
lxc.idmap: u 103 103 1          # Passthrough postgres UID
lxc.idmap: g 103 100103 1
lxc.idmap: u 104 100104 65432
lxc.idmap: g 104 100104 65432

# Then restart LXC container
pct stop <CTID>
pct start <CTID>
```

**WSL2 Permission Errors:**

*Symptom:* "Failed to set ownership" or "Operation not permitted" on `/mnt/c/` filesystem

*Cause:* Windows filesystem doesn't support Linux permissions when using bind mounts

*Solution 1: Use Docker volumes (RECOMMENDED for WSL2)*

```yaml
# In docker-compose.yml, replace bind mounts:
volumes:
  - ./pgdata:/var/lib/postgresql/data
  - ./redis:/var/lib/redis

# With named volumes:
volumes:
  - pgdata:/var/lib/postgresql/data
  - redis:/var/lib/redis

# Add at bottom of file:
volumes:
  pgdata:
  redis:
```

This stores data in Docker-managed volumes which support full permissions.

*Solution 2: Move project to Linux filesystem*

```bash
# Move to Linux filesystem
cd ~
mkdir readmeabook
cd readmeabook

# Copy compose file
cp /mnt/c/git/readmeabook/docker-compose.yml .

# Start container
docker compose up -d
```

*Solution 3: Delete existing directories and let Docker create them*

```bash
# Stop container and remove directories
docker compose down
rm -rf pgdata redis config cache

# Start fresh - Docker will create directories with correct ownership
docker compose up -d
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

1. **Auto-generated secrets:** Secure by default (32-byte random), persisted to `/app/config/.secrets`
2. **Secrets persistence:** Auto-generated secrets are saved to `/app/config/.secrets` on first run and reused on subsequent starts
3. **Override in production:** Set environment variables in docker-compose.yml to use custom secrets (takes precedence over file)
4. **Protect secrets file:** Ensure `/app/config` volume has appropriate permissions (chmod 600 on .secrets file)
5. **No external DB access:** PostgreSQL bound to 127.0.0.1
6. **No external Redis access:** Redis bound to 127.0.0.1
7. **Use reverse proxy:** HTTPS termination (Nginx, Caddy, Traefik)

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

**15. Setup middleware hairpin fetch failures**
- Issue: Middleware logs `Setup check failed: Error: fetch failed` on every request when the container cannot resolve the public hostname.
- Cause: Setup check used the incoming Host header only, so DNS hairpinning or air-gapped domains blocked loopback fetches.
- Fix: Middleware now tries `SETUP_CHECK_BASE_URL` (optional), request origin, then `http://127.0.0.1:${PORT|3030}`; log noise eliminated once any origin succeeds.

**16. Local admin authentication fails after container restart**
- Issue: After container restart, local admin (manual registration) login fails with "Invalid username or password"
- Cause: CONFIG_ENCRYPTION_KEY was auto-generated on each container start and not persisted. Passwords are encrypted with bcrypt hash then encrypted again with CONFIG_ENCRYPTION_KEY. When the key changes, decryption fails and password validation fails.
- Fix: Entrypoint script now persists all auto-generated secrets (JWT_SECRET, JWT_REFRESH_SECRET, CONFIG_ENCRYPTION_KEY, POSTGRES_PASSWORD) to `/app/config/.secrets` file which is mounted on a volume. On subsequent starts, secrets are loaded from this file instead of regenerating.
- Recovery: If already experiencing this issue, either (1) recreate admin account after updating to fixed version, or (2) if you know the old CONFIG_ENCRYPTION_KEY, set it as environment variable in docker-compose.yml

**17. Permission errors with bind mounts and LXC user namespace mapping (Hybrid PUID/PGID)**
- Issue: Container fails with "Operation not permitted" when using bind mounts (`./pgdata`, `./redis`). LXC user namespace mapping (container UID 103 → host UID 100103) makes file access complex.
- Root cause analysis:
  - PostgreSQL requires database cluster owner to be username "postgres" (UID 103)
  - Cannot remap postgres UID without breaking PostgreSQL initialization
  - Users need ownership of downloads, media, config directories
- Solution: Hybrid PUID/PGID approach:
  - postgres user: Keep UID 103 (PostgreSQL compatibility), remap GID → PGID
  - redis/node users: Fully remap to PUID:PGID
  - Result: Downloads/media/config owned by PUID:PGID, PostgreSQL uses 103:PGID with group-readable permissions
- Usage: Set `PUID=1000` and `PGID=1000` in docker-compose.yml
- File ownership:
  - PostgreSQL data: 103:PGID (readable via group)
  - Downloads/media/config: PUID:PGID (full user ownership)
- LXC configuration: Only need to passthrough UID 103 (much simpler than before)
- Backwards compatible: If PUID/PGID not set, uses default system user IDs

**18. WSL2 Windows filesystem incompatibility**
- Issue: Container fails when using bind mounts on Windows filesystem (`/mnt/c/`) with error "Operation not permitted"
- Cause: Windows 9p filesystem doesn't support Linux permission operations (chmod/chown) required by PostgreSQL when using bind mounts
- Fix: Only error when chown actually fails (not preemptively), provide helpful solutions
- Solutions:
  - Use Docker named volumes (recommended): `pgdata:/var/lib/postgresql/data` instead of `./pgdata:/var/lib/postgresql/data`
  - Move project to Linux filesystem: `~/readmeabook` instead of `/mnt/c/`
  - Let Docker create directories on first run (they'll have correct ownership)
- Note: Works fine on WSL2 when using Docker volumes or letting container create directories

**19. PUID collision causes wrong GID (EACCES: permission denied, mkdir)**
- Issue: File organization fails with `EACCES: permission denied, mkdir '/media/...'` even though PUID/PGID are set correctly
- Symptoms: `docker exec -u $PUID:$PGID container mkdir /media/test` works, but the app fails
- Root cause: When PUID collides with an existing system user (e.g., PUID=65534 collides with `nobody`), the `usermod` command creates two users with the same UID. When supervisord resolves `user=node` from /etc/passwd, it may resolve to the wrong user's GID
- Example: User sets PUID=65534 (nobody), PGID=321601206 (AD group). App runs with UID=65534 but GID=65534 (nogroup) instead of GID=321601206
- Diagnosis: Run `docker exec container ps ax -o user,pid,group,gid,comm` - if GID column shows wrong value, this is the issue
- Fix: Use `gosu` for reliable UID:GID switching that bypasses username resolution
  - Added `gosu` package to Dockerfile
  - Created `app-start.sh` and `redis-start.sh` wrapper scripts that use `gosu $PUID:$PGID` to switch users
  - Supervisord now starts these wrappers as root, and gosu switches to the exact UID:GID
  - PUID/PGID are passed via /etc/environment to the wrapper scripts
- Verification: After fix, `ps ax -o user,pid,group,gid,comm` will show correct GID for app and redis processes
- Note: This primarily affects users with complex setups (NFS mounts, AD/SSSD groups, PUID=65534)

## Related

- [Multi-container deployment](docker.md)
- [README.unified.md](../../README.unified.md) (user guide)
- [docker-compose.unified.yml](../../docker-compose.unified.yml) (example)
