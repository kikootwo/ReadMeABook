# ReadMeABook - Docker Deployment Guide

## Quick Start

### Prerequisites

- Docker Engine 20.10+
- Docker Compose V2
- 2GB+ available disk space
- Ports 3000 available on host

### First Time Setup

1. **Clone the repository**

```bash
git clone <your-repo-url>
cd ReadMeABook
```

2. **Create required directories**

```bash
mkdir -p config downloads media
```

3. **Generate secure secrets**

```bash
# Generate NEXTAUTH_SECRET (minimum 32 characters)
openssl rand -base64 32
```

4. **Edit docker-compose.yml**

Update the following environment variables in `docker-compose.yml`:

```yaml
environment:
  # REQUIRED: Change these values
  DATABASE_URL: postgresql://readmeabook:YOUR_SECURE_PASSWORD@postgres:5432/readmeabook
  NEXTAUTH_SECRET: YOUR_GENERATED_SECRET_FROM_STEP_3

  # Update if not running on localhost
  NEXTAUTH_URL: http://localhost:3000
```

Also update the PostgreSQL password in the `postgres` service:

```yaml
postgres:
  environment:
    POSTGRES_PASSWORD: YOUR_SECURE_PASSWORD  # Must match DATABASE_URL
```

5. **Start the application**

```bash
docker compose up -d
```

6. **View logs**

```bash
# Follow all logs
docker compose logs -f

# Or just the application
docker compose logs -f app
```

7. **Access the application**

Open your browser to:
- **Application**: http://localhost:3000
- **Setup Wizard**: http://localhost:3000/setup

### Initial Configuration

On first launch, visit http://localhost:3000/setup and configure:

1. **Plex Media Server**
   - Your Plex server URL
   - Authentication token
   - Audiobook library selection

2. **Prowlarr**
   - Prowlarr server URL
   - API key

3. **Download Client**
   - qBittorrent or Transmission
   - Server URL and credentials

4. **Directory Paths**
   - Download directory: `/downloads` (already mounted)
   - Media directory: `/media/audiobooks` (already mounted)

## Common Operations

### View Status

```bash
docker compose ps
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f app
docker compose logs -f postgres
docker compose logs -f redis
```

### Restart Application

```bash
docker compose restart app
```

### Stop Services

```bash
docker compose down
```

### Update Application

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose up -d --build

# Migrations run automatically on startup
```

### Clean Restart (Preserves Data)

```bash
docker compose down
docker compose up -d --build
```

### Complete Reset (DELETES ALL DATA)

```bash
docker compose down -v
rm -rf config/*
docker compose up -d
```

## Backup & Restore

### Backup Database

```bash
# Create backup
docker compose exec postgres pg_dump -U readmeabook readmeabook > backup-$(date +%Y%m%d).sql

# Backup volumes
tar -czf backup-volumes-$(date +%Y%m%d).tar.gz config downloads media
```

### Restore Database

```bash
# Restore from backup
docker compose exec -T postgres psql -U readmeabook readmeabook < backup-20240101.sql

# Restore volumes
tar -xzf backup-volumes-20240101.tar.gz
```

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker compose logs app

# Verify services are healthy
docker compose ps

# Check migrations
docker compose exec app npx prisma migrate status

# Manually run migrations
docker compose exec app npx prisma migrate deploy
```

### Database Connection Errors

```bash
# Test PostgreSQL
docker compose exec postgres pg_isready -U readmeabook

# Check environment variables
docker compose exec app env | grep DATABASE_URL

# Restart PostgreSQL
docker compose restart postgres
```

### Redis Connection Errors

```bash
# Test Redis
docker compose exec redis redis-cli ping
# Should return: PONG

# Restart Redis
docker compose restart redis
```

### Port Already in Use

If port 3000 is already in use, edit `docker-compose.yml`:

```yaml
app:
  ports:
    - "8080:3000"  # Changed from 3000:3000
```

Then access at http://localhost:8080

### Permission Issues

```bash
# Fix permissions on mounted directories
sudo chown -R 1001:1001 config downloads media
```

## Advanced Configuration

### Custom Port

Edit `docker-compose.yml`:

```yaml
app:
  ports:
    - "8080:3000"
  environment:
    NEXTAUTH_URL: http://localhost:8080
```

### External Database

To use an external PostgreSQL instance:

1. Remove the `postgres` service from `docker-compose.yml`
2. Update `DATABASE_URL` to point to your external database
3. Ensure network connectivity

### External Redis

To use an external Redis instance:

1. Remove the `redis` service from `docker-compose.yml`
2. Update `REDIS_URL` to point to your external Redis
3. Ensure network connectivity

### Resource Limits

Add resource limits in `docker-compose.yml`:

```yaml
app:
  deploy:
    resources:
      limits:
        cpus: '2.0'
        memory: 2G
      reservations:
        cpus: '1.0'
        memory: 512M
```

## Production Deployment

### Recommended Changes for Production

1. **Use Strong Secrets**
   - Generate unique NEXTAUTH_SECRET
   - Use strong PostgreSQL password
   - Never commit secrets to git

2. **Enable HTTPS**
   - Use a reverse proxy (nginx, Traefik, Caddy)
   - Obtain SSL certificate (Let's Encrypt)
   - Update NEXTAUTH_URL to https://

3. **Configure Plex OAuth**
   - Register application at https://www.plex.tv/
   - Add PLEX_CLIENT_ID and PLEX_CLIENT_SECRET

4. **Set Up Backups**
   - Automated database backups
   - Volume snapshots
   - Off-site backup storage

5. **Monitor Resources**
   - Set up logging aggregation
   - Monitor disk space
   - Track application performance

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `REDIS_URL` | Yes | - | Redis connection string |
| `NEXTAUTH_URL` | Yes | - | Application URL |
| `NEXTAUTH_SECRET` | Yes | - | JWT secret (min 32 chars) |
| `PLEX_CLIENT_ID` | No | - | Plex OAuth client ID |
| `PLEX_CLIENT_SECRET` | No | - | Plex OAuth client secret |
| `NODE_ENV` | No | production | Node environment |
| `LOG_LEVEL` | No | info | Logging level |
| `PORT` | No | 3000 | Application port |

## Support

For issues and questions:
- Check logs: `docker compose logs`
- Verify health: http://localhost:3000/api/health
- Review documentation: `/documentation`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Compose                         │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │         readmeabook-app (Next.js)               │   │
│  │         Port: 3000                              │   │
│  │         Volumes: /config, /downloads, /media    │   │
│  └──────────────────┬──────────────┬───────────────┘   │
│                     │              │                     │
│  ┌──────────────────▼──────┐  ┌───▼──────────────┐     │
│  │   postgres:16-alpine    │  │ redis:7-alpine   │     │
│  │   Port: 5432 (internal) │  │ Port: 6379       │     │
│  │   Volume: pgdata        │  │ Volume: redisdata│     │
│  └─────────────────────────┘  └──────────────────┘     │
└─────────────────────────────────────────────────────────┘

Host Directories:
./config    → /app/config    (application configuration)
./downloads → /downloads     (temporary torrent downloads)
./media     → /media         (organized audiobook library)
```

## Next Steps

After deployment:
1. Complete setup wizard at http://localhost:3000/setup
2. Configure external services (Plex, Prowlarr, qBittorrent)
3. Create user accounts
4. Start requesting audiobooks!
