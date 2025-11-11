# Docker Deployment

## Current State

**Status:** Completed ✅

ReadMeABook is deployed as a multi-container Docker application using Docker Compose. The setup includes the Next.js application, PostgreSQL database, and Redis for job queue management.

## Design Architecture

### Why Docker Compose?

**Requirements:**
- Single command deployment (`docker compose up`)
- Persistent data storage across restarts
- Automatic database migrations on startup
- Environment variables configured in Dockerfile
- Volume mounts for downloads, media, and configuration
- Service health checks and dependencies
- Network isolation between services

### Container Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Compose Stack                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │         readmeabook-app (Next.js)              │    │
│  │  Port: 3000                                    │    │
│  │  Depends on: postgres, redis                   │    │
│  │  Volumes: /config, /downloads, /media          │    │
│  └────────────────────────────────────────────────┘    │
│                   │              │                       │
│                   ▼              ▼                       │
│  ┌─────────────────────┐  ┌─────────────────────┐     │
│  │   postgres:16       │  │    redis:7-alpine   │     │
│  │   Port: 5432        │  │    Port: 6379       │     │
│  │   Volume: pgdata    │  │    Volume: redisdata│     │
│  └─────────────────────┘  └─────────────────────┘     │
│                                                          │
│  Networks: readmeabook-network (internal)               │
│  Volumes: pgdata, redisdata (Docker managed)            │
│  Bind Mounts: ./config, ./downloads, ./media (host)     │
└─────────────────────────────────────────────────────────┘
```

## Implementation Details

### Dockerfile

**Base Image:** node:20-alpine
**Build Strategy:** Multi-stage build
  1. Dependencies stage: Install all dependencies
  2. Builder stage: Build Next.js application
  3. Runner stage: Production runtime with minimal footprint

**Features:**
- Runs Prisma migrations on startup
- Non-root user for security
- Health check endpoint
- Automatic Next.js optimization
- Minimal production dependencies

**Build-Time Environment Variables:**
- `DATABASE_URL` - Set to a dummy value during build for Prisma client generation
  - Prisma's `generate` command requires DATABASE_URL to be set, but doesn't actually connect
  - Actual DATABASE_URL from docker-compose.yml is used at runtime
  - Build uses: `postgresql://dummy:dummy@localhost:5432/dummy?schema=public`

### Docker Compose Services

#### 1. Application Service (app)

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./config:/app/config
      - ./downloads:/downloads
      - ./media:/media
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://readmeabook:password@postgres:5432/readmeabook
      - REDIS_URL=redis://redis:6379
      - NEXTAUTH_URL=http://localhost:3000
      - NEXTAUTH_SECRET=<generated-secret>
```

#### 2. PostgreSQL Service (postgres)

```yaml
  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=readmeabook
      - POSTGRES_USER=readmeabook
      - POSTGRES_PASSWORD=password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U readmeabook"]
      interval: 5s
      timeout: 5s
      retries: 5
```

#### 3. Redis Service (redis)

```yaml
  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
```

### Volume Mounts

**Docker-Managed Volumes:**
- `pgdata`: PostgreSQL database files
- `redisdata`: Redis persistence files

**Bind Mounts (Host → Container):**
- `./config:/app/config` - Application configuration and logs
- `./downloads:/downloads` - Temporary torrent downloads
- `./media:/media` - Organized audiobook library (Plex scans here)

### Environment Variables

All environment variables are defined in `docker-compose.yml`:

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `NEXTAUTH_URL` - Application URL
- `NEXTAUTH_SECRET` - JWT secret (must be unique)

**Optional:**
- `NODE_ENV` - Set to "production"
- `LOG_LEVEL` - Logging verbosity

### Startup Sequence

1. **Docker Compose starts all services**
   - PostgreSQL starts first
   - Redis starts in parallel
   - Health checks ensure they're ready

2. **Application container starts**
   - Waits for healthy postgres and redis
   - Runs `docker-entrypoint.sh`

3. **Entrypoint script executes**
   - Runs Prisma migrations (`prisma migrate deploy`)
   - Generates Prisma client if needed
   - Starts Next.js server (`npm start`)

4. **Application is ready**
   - Health check: `http://localhost:3000/api/health`
   - Setup wizard available at `http://localhost:3000/setup`

## Usage Examples

### First Time Deployment

```bash
# Clone repository
git clone <repo-url>
cd ReadMeABook

# Create required directories
mkdir -p config downloads media

# Generate NEXTAUTH_SECRET
openssl rand -base64 32

# Edit docker-compose.yml and set NEXTAUTH_SECRET

# Start services
docker compose up -d

# View logs
docker compose logs -f app

# Application available at http://localhost:3000
```

### Updating Application

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose up -d --build

# Migrations run automatically on startup
```

### Stopping Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (DELETES ALL DATA)
docker compose down -v
```

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f app
docker compose logs -f postgres
docker compose logs -f redis
```

### Backup Database

```bash
# Backup
docker compose exec postgres pg_dump -U readmeabook readmeabook > backup.sql

# Restore
docker compose exec -T postgres psql -U readmeabook readmeabook < backup.sql
```

## Security Considerations

- PostgreSQL not exposed to host (internal network only)
- Redis not exposed to host (internal network only)
- Application runs as non-root user (node:node)
- Secrets should be changed from defaults
- NEXTAUTH_SECRET must be unique and random
- Consider using Docker secrets for production

## Performance Tuning

**PostgreSQL:**
- Default configuration suitable for small-medium libraries
- For large libraries (>10,000 audiobooks), increase `shared_buffers` and `work_mem`

**Redis:**
- Persistence enabled by default
- AOF (Append Only File) for durability

**Application:**
- Next.js runs in production mode (optimized)
- Static assets cached
- Image optimization enabled

## Troubleshooting

### Prisma build errors during Docker build

**Error:** `PrismaConfigEnvError: Missing required environment variable: DATABASE_URL`

**Cause:** Prisma's `generate` command runs during the Docker build stage, but environment variables from docker-compose.yml are only available at runtime.

**Solution:** The Dockerfile now sets a dummy DATABASE_URL during build (Dockerfile:37). The actual DATABASE_URL from docker-compose.yml is used at runtime.

**Note:** Prisma generate doesn't actually connect to the database - it only needs the URL format to be valid.

### Application won't start

```bash
# Check logs
docker compose logs app

# Verify database migrations
docker compose exec app npx prisma migrate status

# Manually run migrations
docker compose exec app npx prisma migrate deploy
```

### Database connection errors

```bash
# Check postgres is healthy
docker compose ps

# Test connection
docker compose exec postgres pg_isready -U readmeabook

# Check environment variables
docker compose exec app env | grep DATABASE_URL
```

### Redis connection errors

```bash
# Check redis is healthy
docker compose ps

# Test connection
docker compose exec redis redis-cli ping

# Should return "PONG"
```

## Future Enhancements

- Docker Swarm support for multi-node deployment
- Traefik reverse proxy integration
- Automatic SSL with Let's Encrypt
- Horizontal scaling support
- Metrics and monitoring (Prometheus/Grafana)
