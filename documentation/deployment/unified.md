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

**Base:** `node:24-bookworm` (debian bookworm with Node.js 24 LTS; floating tag, so release builds pick up Node 24 patch releases)

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

**Stages (multi-stage, from PR #279 by ChaoticSciuridae):**
| Stage | From | Does | Shipped |
|---|---|---|---|
| `ffmpeg` | `mwader/static-ffmpeg@sha256:…` | pinned ffmpeg/ffprobe | copied |
| `base` | `node:24-bookworm` | apt (postgres, redis, supervisor, gosu, locales), ffmpeg + guard, purge imagemagick | yes (OS layer) |
| `builder` | `node:24-bookworm` | `npm ci` (all deps) → `COPY . .` → `prisma generate` → `next build` (standalone) | no |
| `prisma-cli` | `node:24-bookworm` | Prisma CLI closure from `package-lock.json` → `/opt/prisma-cli` | no |
| `runtime` | `base` | app artifacts below + guard | yes |
- Requires BuildKit (`RUN --network=none`, `RUN --mount=type=bind`): the legacy builder (`DOCKER_BUILDKIT=0`, the default before Docker 23, e.g. on 20.10) can't build it; use Docker 23+ or `docker buildx build`
- Node major: all three `node:` stages share one tag, and `e2e/Dockerfile.test`, `e2e/fake-arr/Dockerfile` and both CI workflows (`node-version`) use the same major; `tests/docker/node-version-pins.test.ts` fails on a partial bump (any `FROM [--platform=…] [docker.io/library/]node:` spelling, full pins such as `node:24.11.1-bookworm`; failures name file:line). `@types/node` must have the same major (same test; Dependabot ignores its majors); code the host `npm test` runs must still work on Node 22.12+
- `builder`/`prisma-cli` must stay on bookworm and build for TARGETPLATFORM (never `--platform=$BUILDPLATFORM`): Prisma engines + bcrypt are native
- `builder` WORKDIR must stay `/app` (generated client records absolute paths)
- Version vars: `builder` sets `APP_VERSION`/`GIT_COMMIT`/`BUILD_DATE` + `NEXT_PUBLIC_*` before `next build` (inlined into VersionBadge); `runtime` re-declares the ARGs + ENVs (`/api/version`)
- Dummy `DATABASE_URL` exists only in `builder`; the runtime image has no baked `DATABASE_URL`

**Runtime `/app` contents:**
| Path | Source |
|---|---|
| `server.js`, `.next/server`, `node_modules/` (traced) | `builder` `.next/standalone` |
| `.next/static`, `public/`, `package.json`, `prisma/` | `builder` |
| `src/generated/prisma/` (whole client) | `builder` (credential recovery `require`s it; bundled app finds its engine via `cwd/src/generated/prisma`) |
| `node_modules/{prisma,@prisma/engines,…}` + `.bin/prisma` | `prisma-cli`, ONE `COPY` merged into `node_modules` (a lone `.bin/prisma` copy flattens the symlink and the CLI can't find its wasm) |
| `scripts/` | build context, explicit `COPY` |
| `app-start.sh`, `redis-start.sh`, `postgres-start.sh`; `/entrypoint.sh` | `docker/unified/` |
- Not shipped: devDependencies, untraced prod deps (`@next/swc-*`; msgpackr's native `@msgpackr-extract/*` binary, so bull's msgpackr uses its JS fallback), app source (`src/` except `src/generated/prisma`), `tests/`, `e2e/`, `screenshots/`, `documentation/`, `docker/`, root config/docs files, build `.next/cache`
- Whole-project trace: routes that open admin-configured paths (`fs` on download/media dirs) make Turbopack trace the whole project root ("Dynamic filesystem access causes tracing of the whole project" build warnings). `next.config.ts` `outputFileTracingExcludes['*']` keeps the non-runtime paths above out of `.next/standalone`; the runtime guard fails the build if any of them reappears in `/app`
- Foreign-platform prebuilds: every `node_modules/**/prebuilds/<platform>-<arch>/` except `linux-<build arch>` is deleted (bcrypt 6 ships all platforms; tracing copies the folder); a missing mapping for the arch fails the build

**Prisma CLI provenance (`docker/unified/prisma-cli-lock.js`):**
- Walks `node_modules/prisma` deps in `package-lock.json` (npm lookup order, optional peers skipped) → writes a sub `package.json` + `package-lock.json` with entries copied verbatim (version, `resolved`, sha512 `integrity`); version comes from the lockfile, never hardcoded
- Hard errors: prisma absent, unresolved edge, non-sha512 integrity, non-`registry.npmjs.org` `resolved`, link entries
- `npm ci --ignore-scripts` (tarball integrity checked against the lockfile) → `npm rebuild prisma @prisma/engines` (only install scripts allowed) → delete `@prisma/engines/node_modules/.cache`
- Engines (`schema-engine-*`, `libquery_engine-*`) are NOT lockfile-verified: `@prisma/engines` downloads them from `binaries.prisma.sh` and checks a sha256 served by that host. Never set `PRISMA_ENGINES_MIRROR`, `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` or `PRISMA_*_BINARY`
- Stage guard: installed prisma == lockfile version; exactly one executable `schema-engine-*`
- Dependency bumps: when the Prisma CLI closure changes (a `prisma` bump, or any of its deps moving in the lockfile), update `EXPECTED_PATHS` in `tests/docker/prisma-cli-lock.test.ts` in the same PR (`npm test` fails until it matches)

**Runtime guard (`RUN --network=none`, `docker/unified/runtime-guard.js`, bind-mounted, never in a layer):**
- Runs the entrypoint's `prisma-cli-preflight` block verbatim, then the entrypoint's exact `PRISMA_CLI`
- `.bin/prisma` is a symlink to `prisma/build/index.js`
- CLI version == `Prisma.prismaVersion.client`; `@prisma/engines-version` == CLI engines hash == `Prisma.prismaVersion.engine` (catches a split prisma/@prisma/client bump)
- `prisma migrate diff --from-empty --to-schema-datamodel /app/prisma/schema.prisma --script` renders the schema offline (dummy URL on that command only)
- Recovery: generated client + bcrypt load from `/app/scripts`; `package.json` has `rmab:recover`
- Every bare `require("…")` in `.next/server/**/*.js` resolves from its chunk (externals today: `bcrypt`, `bull`, `keyv`, `next/dist/...`); `bcrypt` + `bull` must be seen (else the scan is blind). Only allowlisted miss: `something` in `[turbopack]_runtime.js` (a code comment)
- Next >= 16.4 requires externals through hashed aliases (`require("bcrypt-a3fecf8c027c10c9")`) backed by relative symlinks in `.next/node_modules/` (`-> ../../node_modules/bcrypt`); an alias counts as its package and must resolve inside `/app/node_modules/<pkg>/`
- Each resolved app external (not `next/…`) is also `require`d once, so a missing transitive dependency fails the build
- bull: `lib/scripts/index.js` exports ≥20 commands, each with Lua `content` (bull 4 loads the precompiled `lib/scripts/<name>-<keys>.js`, not the `.lua` files). When `lib/commands/*.lua` is shipped (it arrives only via a broad route trace), each must have its `lib/scripts` entry; when absent the cross-check is skipped
- Recovery also requires every `/app/scripts/lib/*.js`; `terminal-prompt.js` and `password-users.js` must exist
- Layout: required runtime paths exist; none of the non-runtime paths (`src/{app,components,contexts,hooks,lib}`, `tests`, `e2e`, `screenshots`, `documentation`, `docker`, `dockerfile.unified`, `package-lock.json`, `tsconfig.json`) is in `/app`
- Note: Next 16 `next build` uses Turbopack even with `TURBOPACK=0` (chunk names `[turbopack]_runtime.js`)
- System users (uid:gid) are exactly `postgres=102:106`, `redis=101:105`, `node=1000:1000` (as shipped by 1.2.7 and later; the PUID/LXC sections below and host-side ownership rely on them)
- Prints `node <version> (napi, openssl)` for the build log
- Builtins are skipped with `module.isBuiltin` (Node 24's `builtinModules` lists prefix-only modules such as `node:sqlite` only with the prefix)
- Every ELF file in `/app` + ffmpeg/ffprobe has the build arch's `e_machine`; expects 1 schema engine, ≥2 `libquery_engine` copies, a bcrypt `.node` binding (bcrypt 5 `bcrypt_lib.node`, bcrypt 6 `prebuilds/linux-<arch>/bcrypt.*.node`)

**Guard failures:**
- `prisma X installed, lockfile says Y` / `prisma CLI X != generated client Y` → split or stale Prisma bump (`prisma` and `@prisma/client` must move together)
- `… is not a symlink` → CLI tree copied piecemeal; copy `/opt/prisma-cli/node_modules` whole
- `unresolvable require("x") in .next/server/…` → standalone tracing missed a server external; fix tracing or add an explicit `COPY`
- `require("x") … resolves but does not load` → a traced external is missing one of its own dependencies (tracing gap); same fix
- `non-runtime files in /app` → one of the guard's listed paths (`NOT_SHIPPED` in `runtime-guard.js`) is back in the whole-project trace; restore its `outputFileTracingExcludes` entry in `next.config.ts`. The guard checks only that list, not every new path: keep `NOT_SHIPPED` and the excludes in sync, and add a new top-level dir or `src/` folder to both
- `system user X is a:b, expected c:d` → the base image or the apt install order changed the account IDs. The entrypoint re-chowns its volumes by name, but LXC idmaps, filesystems where chown fails and host-side ownership would break. Never ship it: diff `/etc/passwd` against the last release, then pre-create the account with the old IDs before `apt-get install`
- `e_machine 0x.., expected 0x..` → wrong-arch native file (e.g. a `--platform=$BUILDPLATFORM` stage); never ship it

**Build process:**
1. `ffmpeg` stage: pinned `mwader/static-ffmpeg` index digest (platform variant auto-selected)
2. `base`: apt install (postgres, redis, supervisor, ...), `COPY --from=ffmpeg` ffmpeg/ffprobe → `/usr/local/bin`, versions.json → `/usr/local/share/ffmpeg/`, ffmpeg guard (failure meanings below)
3. `builder`: install all dependencies, generate Prisma client, build Next.js (standalone); `prisma-cli` builds in parallel
4. `runtime`: copy artifacts (table above), create directories, copy supervisord.conf + scripts, runtime guard

**ffmpeg guard failures:**
- `ERROR: <bin> e_machine 0x.., expected 0x.. for <arch>` → wrong-arch binary copied (platform selection broken, e.g. a `--platform` added to the ffmpeg `FROM`); never ship it
- `ERROR: expected <bin> <ver>, got: ...` → `FROM` tag/digest and `ARG FFMPEG_VERSION` disagree
- `ERROR: no pinned static ffmpeg for <arch>` → unsupported platform (only amd64/arm64)
- Bump: new tag + its multi-arch index digest on the `FROM` line (`docker buildx imagetools inspect mwader/static-ffmpeg:<tag>`) AND `ARG FFMPEG_VERSION`, in one commit

**Files:**
- `dockerfile.unified` - Main Dockerfile
- `docker/unified/prisma-cli-lock.js` - Build-time Prisma CLI sub-lockfile generator (tests: `tests/docker/prisma-cli-lock.test.ts`)
- `docker/unified/runtime-guard.js` - Build-time runtime-stage guard
- `docker/unified/supervisord.conf` - Process manager config
- `docker/unified/entrypoint.sh` - Startup script

## Startup Sequence

**Entrypoint script (`entrypoint.sh`):**
0. Prisma CLI preflight (`prisma-cli-preflight` block): `PRISMA_CLI=/app/node_modules/.bin/prisma` (entrypoint variable, not an image ENV) must be executable and exactly one executable `@prisma/engines/schema-engine-*` must exist, else `❌ FATAL: …` and `exit 1` before any volume is touched
1. Load secrets from `/app/config/.secrets` if exists
2. Generate secrets if not provided (from env or file)
3. Persist secrets to `/app/config/.secrets` for future restarts
4. Initialize PostgreSQL if first run
5. Start PostgreSQL temporarily
6. Create database user and database
7. Run Prisma schema sync (`$PRISMA_CLI db push --skip-generate --accept-data-loss`) + run-once data migrations (`$PRISMA_CLI db execute`, tracked in `_data_migrations`). Never `npx prisma`: with no local CLI, npx silently installs the latest prisma from the registry
   - A failed `db push` still does NOT stop the container (logs `⚠️  Migrations may have failed, continuing...`); a failed data migration is retried on the next start. Only a missing CLI is fatal
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
      # Hybrid approach: postgres keeps its UID (102), everything else uses PUID:PGID
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
- `postgres` user: **Keeps UID 102** (PostgreSQL requirement), **remaps GID → PGID**
- `redis` user: **Fully remapped to PUID:PGID**
- `node` user: **Fully remapped to PUID:PGID**

**File Ownership Result:**
- PostgreSQL data (`/var/lib/postgresql/data`): **102:PGID**
- Redis data (`/var/lib/redis`): **PUID:PGID** ✅ Your user owns it
- App config (`/app/config`): **PUID:PGID** ✅ Your user owns it
- Downloads (`/downloads`): **PUID:PGID** ✅ Your user owns it
- Media (`/media`): **PUID:PGID** ✅ Your user owns it

**Key Benefits:**
- ✅ You fully own downloads, media, and config directories
- ✅ PostgreSQL works correctly (no username conflicts)
- ✅ All files accessible via shared PGID group
- ✅ Minimal LXC mapping needed (only UID 102)

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

For LXC with user namespace mapping, you only need to passthrough container UID 102 (postgres). IDs below are as shipped by 1.2.7 and later (`postgres=102:106`, `redis=101:105`, `node=1000:1000`); confirm yours with `docker exec <container> id postgres` or the entrypoint's `Current UIDs:` line:

**Example LXC Config:**
```bash
# File: /etc/pve/lxc/<CTID>.conf
# Map most UIDs normally (0-101 → 100000-100101)
lxc.idmap: u 0 100000 102
lxc.idmap: g 0 100000 102

# Passthrough postgres UID 102 to host UID 102
lxc.idmap: u 102 102 1
lxc.idmap: g 102 100102 1

# Map remaining UIDs (103-65535 → 100103-165535)
lxc.idmap: u 103 100103 65433
lxc.idmap: g 103 100103 65433
```

**Alternative: Map to your user:**
```bash
# If you want PostgreSQL files accessible as your host user (UID 1000):
lxc.idmap: u 0 100000 102
lxc.idmap: g 0 100000 102
lxc.idmap: u 102 1000 1      # Map container 102 → host 1000
lxc.idmap: g 102 1000 1
lxc.idmap: u 103 100103 65433
lxc.idmap: g 103 100103 65433

# Then set in docker-compose.yml:
environment:
  PUID: 1000
  PGID: 1000
```

### Startup Logs

When PUID/PGID are set, you'll see:

```
🔧 PUID/PGID detected - Configuring hybrid user mapping for 1000:1000

   Current UIDs: postgres=102 redis=101 node=1000

   Applying hybrid mapping strategy:
   - postgres: Keep UID 102, remap GID → 1000 (PostgreSQL compatibility)
   - redis:    Remap to 1000:1000 (full user ownership)
   - node:     Remap to 1000:1000 (full user ownership)

✅ User mapping complete!

   File ownership will be:
   - PostgreSQL data (/var/lib/postgresql/data): 102:1000
   - Redis data      (/var/lib/redis):           1000:1000
   - App config      (/app/config):              1000:1000
   - Downloads       (/downloads):               1000:1000
   - Media           (/media):                   1000:1000

   On your host, these will appear as:
   - PostgreSQL: UID 102, GID 1000 (readable via group)
   - Everything else: Your user (1000:1000)
```

### File Permissions

The container uses group-friendly permissions:

| Directory | Ownership | Permissions | Description |
|-----------|-----------|-------------|-------------|
| `/var/lib/postgresql/data` | 102:PGID | 750 (rwxr-x---) | PostgreSQL data, group-readable |
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
   - PostgreSQL data: postgres (UID 102)
   - Redis data:      redis (UID 101)
   - App/Downloads:   node (UID 1000)
```

This works fine for most deployments, but files will have different owners on the host.

## GitHub Action

**File:** `.github/workflows/build-unified-image.yml`

- **Triggers:** `v*` tags (test, build, publish); manual dispatch (on a branch: test + build only, nothing published). No image build on PRs.
- **Platforms:** linux/amd64, linux/arm64
- **Tags (from `v1.2.3`):** `1.2.3`, `1.2`, `1`, `latest`, `sha-<short>`
- **Registry:** ghcr.io via `GITHUB_TOKEN` (`packages: write` on the build job only)
- **Details:** [ci-workflows.md](ci-workflows.md)

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

*Symptom:* Files owned by UID 102 on host are not accessible

*Solution:* Configure LXC idmap to passthrough UID 102 (postgres, as shipped by 1.2.7 and later)

```bash
# Edit /etc/pve/lxc/<CTID>.conf and add:
lxc.idmap: u 0 100000 102
lxc.idmap: g 0 100000 102
lxc.idmap: u 102 102 1          # Passthrough postgres UID
lxc.idmap: g 102 100102 1
lxc.idmap: u 103 100103 65433
lxc.idmap: g 103 100103 65433

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

**Check schema drift (read-only):**
```bash
docker exec readmeabook-unified bash -c 'set -a; . /etc/environment; set +a; cd /app && \
  gosu node /app/node_modules/.bin/prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code'
# exit 0 = database matches the schema; 2 = drift (diff printed). The schema is applied with db push
# at every start, not migrations. Never use npx prisma in the container (it can fetch another version).
```

**Reset database:**
```bash
# Stop container and remove database directory
docker compose -f docker-compose.unified.yml down
rm -rf ./pgdata
docker compose -f docker-compose.unified.yml up -d
```

### TLS errors after upgrading to Node 24

*Cause:* the image runs Node 24 (OpenSSL 3.5, security level 2); Node 20 images used level 1. Two limits, for every outbound HTTPS connection the app makes (download clients, Audiobookshelf, Plex, Prowlarr/indexers, Apprise/ntfy/webhooks, BookDate, OIDC issuers, an external `REDIS_URL` over TLS):
- **RSA certificate key < 2048 bits:** refused only when the certificate is verified (an old public cert, or a private CA trusted via `NODE_EXTRA_CA_CERTS`)
- **DH parameters < 2048 bits** (TLS 1.2 server that picks DHE): refused whether verification is on or off

*What you see:*

| Where | Message |
|---|---|
| OIDC: Test button in setup/admin settings | `Issuer.discover() failed.` (the TLS cause is not shown or logged; OIDC login fails too) |
| SABnzbd, NZBGet: Test | `SSL/TLS certificate error. Enable "Disable SSL verification" if using self-signed certificates.` Enabling it fixes only the RSA-key case; it does **not** fix `dh key too small` |
| qBittorrent, Transmission, Deluge: Test | A generic connection error with no SSL hint, e.g. `Failed to connect to qBittorrent at https://…: <raw text below>` |
| Raw error text (in the qBittorrent/Transmission/Deluge messages and in container logs where the error is logged) | `EE certificate key too weak` (error code `UNSPECIFIED`) or `…SSL routines:tls_process_ske_dhe:dh key too small` (code `EPROTO`) |

*Fix (preferred):* give the server a ≥ 2048-bit RSA (or an ECDSA) certificate and ≥ 2048-bit DH parameters, or allow only ECDHE key exchange.

*Stopgap (lowers TLS security for every connection the app makes; remove it once the server is fixed):*
```yaml
environment:
  NODE_OPTIONS: "--tls-cipher-list=DEFAULT@SECLEVEL=1"
```
- Reaches the app (`node server.js`) and `npm run rmab:recover` through the container env; the image itself keeps level 2
- Not needed for servers with a ≥ 2048-bit key (TLS 1.2 or 1.3), or when verification is off and the server uses ECDHE

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
- Fix: runtime stage copies standalone output to `/app` (`COPY --from=builder /app/.next/standalone ./`)

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
- Fix (original): `app-start.sh` called `/api/init` after the health check
- Fix (current): the app starts its own init from `src/instrumentation.ts` (loopback POST with a per-process secret, retries until DB + Redis are ready). `app-start.sh` only starts the server, waits for `/api/health` for logging, and verifies UID/GID. `/api/init` answers 404 to any other caller. See [scheduler.md](../backend/services/scheduler.md#startup-initialization)

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
- Issue: Container fails with "Operation not permitted" when using bind mounts (`./pgdata`, `./redis`). LXC user namespace mapping (container UID 102 → host UID 100102) makes file access complex.
- Root cause analysis:
  - PostgreSQL requires database cluster owner to be username "postgres" (UID 102 as shipped by 1.2.7 and later)
  - Cannot remap postgres UID without breaking PostgreSQL initialization
  - Users need ownership of downloads, media, config directories
- Solution: Hybrid PUID/PGID approach:
  - postgres user: Keep UID 102 (PostgreSQL compatibility), remap GID → PGID
  - redis/node users: Fully remap to PUID:PGID
  - Result: Downloads/media/config owned by PUID:PGID, PostgreSQL uses 102:PGID with group-readable permissions
- Usage: Set `PUID=1000` and `PGID=1000` in docker-compose.yml
- File ownership:
  - PostgreSQL data: 102:PGID (readable via group)
  - Downloads/media/config: PUID:PGID (full user ownership)
- LXC configuration: Only need to passthrough UID 102 (much simpler than before)
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

**20. Oversized image; Prisma CLI kept only by accident (#279)**
- Issue: single-stage build shipped the full `npm ci` layer (devDependencies survive `npm prune` in earlier layers), `src/`, tests, the build cache and a duplicate standalone tree
- Latent: CLI present only because prune keeps `devOptional` prisma; recovery worked only because `COPY . .` shipped `scripts/` + `src/generated/prisma`; a missing CLI made `npx prisma` fetch the latest prisma at start, then `|| echo` hid any failure
- Fix: multi-stage build (idea + first version: PR #279, ChaoticSciuridae); CLI from the lockfile (`prisma-cli` stage); explicit copies for `scripts/`, the generated client, `prisma/`; entrypoint preflight + absolute `PRISMA_CLI`; offline runtime guard

**21. Node.js 20 end of life → Node.js 24**
- Change: all image stages, `e2e/Dockerfile.test`, `e2e/fake-arr/Dockerfile` and CI moved to Node 24 together; `@types/node` ^24
- Native modules unchanged: bcrypt 6 and the Prisma engines are Node-API, the same binaries as on Node 20
- Behaviour change: OpenSSL security level 2, see [TLS errors after upgrading to Node 24](#tls-errors-after-upgrading-to-node-24)
- Expected log line: one `[DEP0169] DeprecationWarning: url.parse()` per process. Harmless: it comes from dependencies bundled into the server build (openid-client, follow-redirects), so Node treats them as app code; not suppressed on purpose
- Guards added: system user IDs, Node/OpenSSL version line, `isBuiltin` for builtins

## Related

- [Multi-container deployment](docker.md)
- [README.unified.md](../../README.unified.md) (user guide)
- [docker-compose.unified.yml](../../docker-compose.unified.yml) (example)
