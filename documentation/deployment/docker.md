# Docker Deployment

**Status:** ✅ Implemented

Multi-container Docker application using Docker Compose: Next.js app, PostgreSQL, Redis.

## Architecture

**Services:**
1. **app** - Next.js (port 3000), depends on postgres + redis
2. **postgres** - PostgreSQL 16 (port 5432, internal only)
3. **redis** - Redis 7-alpine (port 6379, internal only)

**Volumes:**
- `pgdata` - PostgreSQL data (Docker-managed)
- `redisdata` - Redis persistence (Docker-managed)
- `./config:/app/config` - App config/logs (bind mount)
- `./downloads:/downloads` - Torrent downloads (bind mount)
- `./media:/media` - Plex audiobook library (bind mount)

## Dockerfile

**Base:** node:20-alpine
**Strategy:** Multi-stage (dependencies → builder → runner)

**Features:**
- Runs Prisma migrations on startup
- Non-root user (node:node)
- Health check endpoint
- Minimal production dependencies

**Build Env:** `DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy` (Prisma generate needs URL format but doesn't connect)

## docker-compose.yml

**App Service:**
```yaml
environment:
  - NODE_ENV=production
  - DATABASE_URL=postgresql://readmeabook:password@postgres:5432/readmeabook
  - REDIS_URL=redis://redis:6379
  - NEXTAUTH_URL=http://localhost:3000
  - NEXTAUTH_SECRET=<generated>
  - TURBOPACK=0  # Use Webpack, not Turbopack
```

**Health Checks:**
- Postgres: `pg_isready -U readmeabook`
- Redis: `redis-cli ping`

## Startup Sequence

1. Postgres + Redis start → health checks pass
2. App container starts → waits for healthy dependencies
3. `docker-entrypoint.sh` runs Prisma migrations (`prisma migrate deploy`)
4. Generates Prisma client
5. Starts Next.js server (`npm start`)
6. Health check: `http://localhost:3000/api/health`
7. Setup wizard: `http://localhost:3000/setup`

## Usage

**First Deploy:**
```bash
mkdir -p config downloads media
openssl rand -base64 32  # Generate NEXTAUTH_SECRET
# Edit docker-compose.yml, set secret
docker compose up -d
docker compose logs -f app
```

**Update:**
```bash
git pull
docker compose up -d --build
# Migrations run automatically
```

**Backup DB:**
```bash
docker compose exec postgres pg_dump -U readmeabook readmeabook > backup.sql
docker compose exec -T postgres psql -U readmeabook readmeabook < backup.sql
```

## Fixed Issues ✅

**1. Prisma Build Errors**
- Issue: Missing DATABASE_URL during build
- Fix: Set dummy URL in Dockerfile (Prisma generate doesn't connect)

**2. Next.js Module Errors**
- Missing components → Created Input component
- next-auth references → Replaced with custom JWT auth
- Bull bundling issues → Added to `serverExternalPackages`

**3. Bull Library Errors**
- Issue: Bull incompatible with Turbopack client bundling
- Fix: Set `TURBOPACK=0` to use Webpack + `webpack.resolve.alias: {bull: false}` for client

**4. TypeScript Compilation Errors**
- `user.name` → `user.plexUsername`
- `prisma.config` → `prisma.configuration`
- Fixed DownloadHistory field names (see full list in doc)

## Security

- Postgres not exposed to host
- Redis not exposed to host
- App runs as non-root
- Change NEXTAUTH_SECRET from default
- HTTPS in production

## Troubleshooting

**App won't start:**
```bash
docker compose logs app
docker compose exec app npx prisma migrate status
docker compose exec app npx prisma migrate deploy
```

**DB connection:**
```bash
docker compose ps
docker compose exec postgres pg_isready -U readmeabook
docker compose exec app env | grep DATABASE_URL
```

**Redis:**
```bash
docker compose exec redis redis-cli ping  # Should return PONG
```
