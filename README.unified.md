# ReadMeABook - Unified Container Deployment

This guide covers deploying ReadMeABook using the **unified container image** that bundles PostgreSQL, Redis, and the application into a single container.

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

1. **Download the compose file:**
   ```bash
   curl -O https://raw.githubusercontent.com/kikootwo/ReadMeABook/main/docker-compose.unified.yml
   ```

2. **Create required directories:**
   ```bash
   mkdir -p config downloads media
   ```

3. **Start the container:**
   ```bash
   docker compose -f docker-compose.unified.yml up -d
   ```

4. **Access the application:**
   Open http://localhost:3030 in your browser

### Option 2: Docker Run

```bash
# Create directories
mkdir -p config downloads media

# Run container
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

## 📋 Environment Variables

**Most environment variables are optional** with secure defaults generated automatically. Only configure these if needed:

### Security (Auto-generated if not set)
- `JWT_SECRET` - JWT token signing secret
- `JWT_REFRESH_SECRET` - Refresh token signing secret
- `CONFIG_ENCRYPTION_KEY` - Database encryption key
- `POSTGRES_PASSWORD` - PostgreSQL password

### Application (Optional)
- `PUBLIC_URL` - Your public URL (e.g., `https://readmeabook.example.com`)
- `LOG_LEVEL` - Logging level: `debug`, `info`, `warn`, `error` (default: `info`)
- `PLEX_CLIENT_IDENTIFIER` - Custom Plex client ID (auto-generated if not set)

### Database (Optional)
- `POSTGRES_USER` - Database user (default: `readmeabook`)
- `POSTGRES_DB` - Database name (default: `readmeabook`)

## 📁 Volume Mounts

| Path | Description | Required |
|------|-------------|----------|
| `/app/config` | Application configuration and logs | Yes |
| `/downloads` | Torrent download directory | Yes |
| `/media` | Plex audiobook library | Yes |
| `/var/lib/postgresql/data` | PostgreSQL data (persistent) | Yes |
| `/var/lib/redis` | Redis data (persistent) | Yes |

## 🔍 Viewing Logs

The unified container outputs logs from all services (PostgreSQL, Redis, and the app):

```bash
# View all logs
docker logs readmeabook-unified

# Follow logs in real-time
docker logs -f readmeabook-unified

# Filter by service
docker logs readmeabook-unified 2>&1 | grep "postgresql"
docker logs readmeabook-unified 2>&1 | grep "redis"
docker logs readmeabook-unified 2>&1 | grep "app"
```

## 🔧 Advanced Configuration

### Custom Secrets

For production deployments, set custom secrets:

```yaml
# docker-compose.unified.yml
environment:
  JWT_SECRET: "your-secure-random-string-here"
  JWT_REFRESH_SECRET: "another-secure-random-string"
  CONFIG_ENCRYPTION_KEY: "32-character-encryption-key"
  POSTGRES_PASSWORD: "secure-database-password"
```

Generate secure secrets:
```bash
openssl rand -base64 32
```

### Reverse Proxy Setup

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name readmeabook.example.com;

    location / {
        proxy_pass http://localhost:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Don't forget to set `PUBLIC_URL` environment variable:
```yaml
environment:
  PUBLIC_URL: "https://readmeabook.example.com"
```

## 🔄 Updating

```bash
# Pull latest image
docker compose -f docker-compose.unified.yml pull

# Restart with new image
docker compose -f docker-compose.unified.yml up -d

# View logs to ensure smooth startup
docker compose -f docker-compose.unified.yml logs -f
```

Database migrations run automatically on startup.

## 🐛 Troubleshooting

### Container won't start
```bash
# Check logs for errors
docker logs readmeabook-unified

# Check container status
docker ps -a | grep readmeabook
```

### Database issues
```bash
# Access PostgreSQL directly
docker exec -it readmeabook-unified su - postgres -c "psql -h 127.0.0.1 -U readmeabook"

# Check database status
docker exec readmeabook-unified su - postgres -c "pg_isready -h 127.0.0.1"
```

### Redis issues
```bash
# Test Redis connection
docker exec readmeabook-unified redis-cli ping
# Should return: PONG
```

### Reset everything
```bash
# Stop and remove container
docker compose -f docker-compose.unified.yml down

# Remove volumes (WARNING: deletes all data)
docker volume rm readmeabook-pgdata readmeabook-redis

# Start fresh
docker compose -f docker-compose.unified.yml up -d
```

## 📊 Resource Usage

The unified container typically uses:
- **Memory:** ~500MB-1GB (depending on usage)
- **CPU:** Low (spikes during library scans and downloads)
- **Disk:** Varies based on database size and Redis cache

## 🔐 Security Notes

1. **Change default secrets** in production (set environment variables)
2. **Use HTTPS** via reverse proxy (Nginx, Caddy, Traefik)
3. **Restrict port access** - only expose 3030 to trusted networks
4. **Keep container updated** - pull latest images regularly
5. **Backup data** - regularly backup the PostgreSQL volume

## 📦 Backup & Restore

### Backup Database
```bash
docker exec readmeabook-unified su - postgres -c \
  "pg_dump -h 127.0.0.1 -U readmeabook readmeabook" > backup.sql
```

### Restore Database
```bash
cat backup.sql | docker exec -i readmeabook-unified su - postgres -c \
  "psql -h 127.0.0.1 -U readmeabook readmeabook"
```

## 🆚 Unified vs Multi-Container

### Use Unified Container When:
- ✅ Simple deployment with minimal configuration
- ✅ Single-host deployment
- ✅ Don't need separate database/cache scaling
- ✅ Want easy updates and management

### Use Multi-Container When:
- ✅ Need to scale services independently
- ✅ Want separate database backups
- ✅ Running in Kubernetes or orchestrated environment
- ✅ Need external access to database/Redis

## 📚 More Information

- **Full Documentation:** [documentation/](documentation/)
- **Multi-Container Setup:** [docker-compose.yml](docker-compose.yml)
- **Issues:** [GitHub Issues](https://github.com/kikootwo/ReadMeABook/issues)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)

## ⚖️ License

MIT License - see [LICENSE](LICENSE) for details
