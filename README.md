# 📚 ReadMeABook

**An automated audiobook request and acquisition system that integrates with your Plex library.**

ReadMeABook bridges the gap between your Plex audiobook library and automation tools like qBittorrent and Prowlarr. Request audiobooks through a web interface, and let ReadMeABook handle finding, downloading, and organizing them into your Plex library.

---

## ✨ Features

- **🔐 Plex Authentication** - Seamless login with your existing Plex account
- **📖 Library Sync** - Automatically scans and tracks your Plex audiobook library
- **🤖 AI-Powered Recommendations** - BookDate: Get personalized audiobook suggestions based on your library and preferences
- **🔍 Smart Search** - Finds audiobooks via Audible metadata and Prowlarr indexers
- **⚡ Automated Downloads** - Integrates with qBittorrent for automatic acquisition
- **📊 Request Management** - Track request status from search to library import
- **👥 Multi-User Support** - Role-based access control (user/admin)
- **🎯 Intelligent Matching** - Matches downloaded files to requested books
- **🔄 Background Jobs** - Automated library scans, status checks, and cleanup

---

## 🚀 Quick Start

### Prerequisites
- **Docker** (recommended) or Docker Compose
- **Plex Media Server** with an audiobook library
- **qBittorrent** - Download client for torrent management
- **Prowlarr** - Indexer aggregator for searching torrents

### Option 1: Docker Compose (Recommended)

1. **Download the compose file:**
   ```bash
   curl -O https://raw.githubusercontent.com/kikootwo/ReadMeABook/main/docker-compose.yml
   ```

2. **Start the container:**
   ```bash
   docker compose up -d
   ```

3. **Access the application:**
   Open http://localhost:3030 in your browser

> **Note:** The application automatically creates all required directories on first run.

### Option 2: Docker Run

```bash
docker run -d \
  --name readmeabook \
  -p 3030:3030 \
  -v ./config:/app/config \
  -v ./cache:/app/cache \
  -v ./downloads:/downloads \
  -v ./media:/media \
  -v readmeabook-pgdata:/var/lib/postgresql/data \
  -v readmeabook-redis:/var/lib/redis \
  ghcr.io/kikootwo/readmeabook:latest
```

> **Note:** Directories are automatically created on first run.

---

## 📁 Volume Mounts

| Path | Description | Required |
|------|-------------|----------|
| `/app/config` | Application configuration and logs | Yes |
| `/app/cache` | Temporary file cache | Yes |
| `/downloads` | qBittorrent download directory | Yes |
| `/media` | Plex audiobook library path | Yes |
| `/var/lib/postgresql/data` | PostgreSQL database | Yes |
| `/var/lib/redis` | Redis cache data | Yes |

> **💡 Tip:** The unified Docker image includes PostgreSQL and Redis built-in. For separate containers, see [docker-compose.debug.yml](docker-compose.debug.yml).

---

## ⚙️ Initial Setup

After starting ReadMeABook for the first time:

1. **Navigate to** http://localhost:3030
2. **Log in with Plex** - First user automatically becomes admin
3. **Configure Settings** (Settings → Configuration):
   - **Plex Server URL** - Your Plex server address
   - **Audiobook Library** - Select your audiobook library
   - **Prowlarr API** - API URL and key for torrent searching
   - **qBittorrent** - Web UI URL and credentials for downloads
4. **Scan Library** - Click "Scan Library" to import existing audiobooks
5. **Explore BookDate** - Get AI-powered audiobook recommendations
6. **Start Requesting** - Search for audiobooks and submit requests

---

## 🔧 Configuration

### Environment Variables (Optional)

Most variables have secure defaults generated automatically. Configure these only if needed:

#### Security (Auto-generated on first run)
- `JWT_SECRET` - JWT token signing secret
- `JWT_REFRESH_SECRET` - Refresh token signing secret
- `CONFIG_ENCRYPTION_KEY` - Database encryption key
- `POSTGRES_PASSWORD` - PostgreSQL password

#### Application
- `PUBLIC_URL` - Your public URL (e.g., `https://readmeabook.example.com`)
- `LOG_LEVEL` - Logging level: `debug`, `info`, `warn`, `error` (default: `info`)
- `PLEX_CLIENT_IDENTIFIER` - Custom Plex client ID (auto-generated if not set)

#### Database
- `POSTGRES_USER` - Database user (default: `readmeabook`)
- `POSTGRES_DB` - Database name (default: `readmeabook`)

**Generate secure secrets:**
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

Don't forget to set the `PUBLIC_URL` environment variable in your docker-compose.yml:
```yaml
environment:
  PUBLIC_URL: "https://readmeabook.example.com"
```

---

## 🔄 Updating

```bash
# Pull latest image
docker compose pull

# Restart with new image
docker compose up -d

# View logs
docker compose logs -f
```

Database migrations run automatically on startup.

---

## 📊 Resource Usage

The unified container typically uses:
- **Memory:** ~500MB-1GB (depending on usage)
- **CPU:** Low (spikes during library scans and downloads)
- **Disk:** Varies based on database size and Redis cache
- **Image Size:** ~3GB (includes PostgreSQL 16 + Redis + App)

---

## 🐛 Troubleshooting

### Container won't start
```bash
# Check logs for errors
docker logs readmeabook

# Check container status
docker ps -a | grep readmeabook
```

### Database issues
```bash
# Access PostgreSQL directly
docker exec -it readmeabook su - postgres -c "psql -h 127.0.0.1 -U readmeabook"

# Check database status
docker exec readmeabook su - postgres -c "pg_isready -h 127.0.0.1"
```

### Redis issues
```bash
# Test Redis connection
docker exec readmeabook redis-cli ping
# Should return: PONG
```

### Reset everything (⚠️ Warning: Deletes all data)
```bash
# Stop and remove container
docker compose down

# Remove volumes
docker volume rm readmeabook-pgdata readmeabook-redis

# Start fresh
docker compose up -d
```

---

## 📦 Backup & Restore

### Backup Database
```bash
docker exec readmeabook su - postgres -c \
  "pg_dump -h 127.0.0.1 -U readmeabook readmeabook" > backup.sql
```

### Restore Database
```bash
cat backup.sql | docker exec -i readmeabook su - postgres -c \
  "psql -h 127.0.0.1 -U readmeabook readmeabook"
```

---

## 🏗️ Development

For local development and debugging, see:
- **Local Build:** [docker-compose.local.yml](docker-compose.local.yml)
- **Debug Mode:** [docker-compose.debug.yml](docker-compose.debug.yml) (separate PostgreSQL/Redis containers)
- **Documentation:** [documentation/](documentation/)

### Project Structure
```
readmeabook/
├── src/
│   ├── app/              # Next.js app router pages
│   ├── components/       # React components
│   ├── lib/              # Utilities and helpers
│   ├── services/         # Backend services (auth, jobs, config)
│   └── generated/        # Prisma client
├── prisma/
│   └── schema.prisma     # Database schema
├── documentation/        # Project documentation
├── docker/               # Docker configuration
└── public/               # Static assets
```

---

## 🆚 Deployment Options

### Unified Container (Default - docker-compose.yml)
**✅ Best for:** Simple deployment, single-host, minimal configuration

- All services in one container (PostgreSQL + Redis + App)
- Easiest to deploy and manage
- Single container to update
- ~3GB image size

### Multi-Container (docker-compose.debug.yml)
**✅ Best for:** Development, debugging, separate service scaling

- PostgreSQL, Redis, and App as separate containers
- Independent service management
- Better for development and testing
- More flexible but requires more configuration

---

## 🔐 Security Best Practices

1. **Change default secrets** in production (set environment variables)
2. **Use HTTPS** via reverse proxy (Nginx, Caddy, Traefik)
3. **Restrict port access** - only expose port 3030 to trusted networks
4. **Keep container updated** - pull latest images regularly
5. **Backup database** - regularly backup PostgreSQL data
6. **Review user access** - Manage user roles appropriately

---

## 📚 Documentation

- **Full Documentation:** [documentation/](documentation/)
- **Table of Contents:** [documentation/TABLEOFCONTENTS.md](documentation/TABLEOFCONTENTS.md)
- **Agent Guidelines:** [AGENTS.md](AGENTS.md)
- **Claude Guidelines:** [CLAUDE.md](CLAUDE.md)

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details

---

## 🙏 Acknowledgments

- **Plex** - Media server platform
- **Prowlarr** - Indexer manager
- **qBittorrent** - BitTorrent client
- **Next.js** - React framework
- **Prisma** - Database ORM
- **PostgreSQL** - Database
- **Redis** - Cache and job queue

---

## 📧 Support

- **Issues:** [GitHub Issues](https://github.com/kikootwo/ReadMeABook/issues)
- **Discussions:** [GitHub Discussions](https://github.com/kikootwo/ReadMeABook/discussions)

---

**Made with ❤️ for audiobook enthusiasts**
