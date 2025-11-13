# ReadMeABook - Audiobook Library Management

**Status:** MVP Complete (Phases 1-4 ✅) | Docker deployment pending

## Stack
- **Frontend:** Next.js 14+, TypeScript, Tailwind CSS
- **Backend:** Node.js/Express via Next.js API routes
- **Database:** PostgreSQL (Docker embedded)
- **Queue:** Bull + Redis (Docker embedded)
- **Deployment:** Single Docker image

## Architecture
```
Docker Container
├── Next.js App (Frontend + Backend)
├── PostgreSQL (users, audiobooks, requests, config, jobs)
├── Bull Queue + Redis (background jobs)
└── Volumes: /config, /downloads, /media
```

External integrations: Plex (auth + library), Prowlarr/Jackett (indexers), qBittorrent/Transmission (downloads), Audible (metadata scraping)

## Core Features (Implemented)
- Plex OAuth authentication
- Setup wizard (8 steps: admin, Plex, Prowlarr, download client, paths)
- Audiobook discovery (popular, new releases via Audible scraping)
- Request management with status tracking
- Automation pipeline: search → download → organize → Plex scan
- Admin dashboard with metrics, active downloads, recent requests
- Settings pages (Plex, Prowlarr, download client, paths)
- Scheduled jobs (Plex scan, Audible refresh, retry logic, cleanup)
- User/admin RBAC

## User Flow
1. Login with Plex → 2. Search/browse audiobooks → 3. Request → 4. Auto: search indexers → download torrent → organize files → scan Plex → 5. Available in Plex library

## Documentation Map
**Backend:**
- [database.md](backend/database.md) - PostgreSQL schema, Prisma ORM
- [services/auth.md](backend/services/auth.md) - Plex OAuth, JWT sessions
- [services/config.md](backend/services/config.md) - Settings storage, encryption
- [services/jobs.md](backend/services/jobs.md) - Bull queue, background processors
- [services/scheduler.md](backend/services/scheduler.md) - Recurring jobs (cron)

**Integrations:**
- [integrations/plex.md](integrations/plex.md) - Library scanning, OAuth, matching
- [integrations/audible.md](integrations/audible.md) - Web scraping, metadata

**Automation (Phase 3):**
- [phase3/README.md](phase3/README.md) - Automation pipeline overview
- [phase3/qbittorrent.md](phase3/qbittorrent.md) - Download client integration
- [phase3/prowlarr.md](phase3/prowlarr.md) - Indexer search
- [phase3/ranking-algorithm.md](phase3/ranking-algorithm.md) - Torrent selection
- [phase3/file-organization.md](phase3/file-organization.md) - File management, seeding

**Frontend:**
- [frontend/components.md](frontend/components.md) - React components catalog
- [frontend/routing-auth.md](frontend/routing-auth.md) - Route protection, auth flow
- [frontend/pages/login.md](frontend/pages/login.md) - Login page design

**Admin:**
- [admin-dashboard.md](admin-dashboard.md) - Metrics, monitoring
- [settings-pages.md](settings-pages.md) - Configuration UI
- [setup-wizard.md](setup-wizard.md) - First-time setup flow

**Deployment:**
- [deployment/docker.md](deployment/docker.md) - Docker Compose, volumes, env vars

## Development Phases
✅ Phase 1: Foundation (auth, database, setup wizard)
✅ Phase 2: User features (discovery, requests, dashboard)
✅ Phase 3: Automation (search, download, organize, Plex integration)
✅ Phase 4: Admin tools (dashboard, settings, monitoring, scheduled jobs)
⏳ Phase 5: Enhanced features (WebSockets, advanced search)
⏳ Phase 6: Advanced admin (analytics, notifications, quality profiles)

## Standards
- Files ≤400 lines
- File headers link to documentation
- Update docs before/after code changes
- Type-safe TypeScript throughout
- Encrypted sensitive config (AES-256)
