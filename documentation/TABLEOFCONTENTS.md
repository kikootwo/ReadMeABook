# Documentation Table of Contents

**Purpose:** Quick navigation for AI to locate relevant documentation without reading all files.

## Authentication & Users
- **Plex OAuth, JWT sessions, RBAC** → [backend/services/auth.md](backend/services/auth.md)
- **Local admin authentication, password change** → [backend/services/auth.md](backend/services/auth.md)
- **Route protection, auth guards** → [frontend/routing-auth.md](frontend/routing-auth.md)
- **Login page UI/UX** → [frontend/pages/login.md](frontend/pages/login.md)

## Configuration & Setup
- **First-time setup wizard** → [setup-wizard.md](setup-wizard.md)
- **Settings management, encryption** → [backend/services/config.md](backend/services/config.md)
- **Settings UI (Plex, Prowlarr, paths)** → [settings-pages.md](settings-pages.md)
- **Setup middleware & status check** → [backend/middleware.md](backend/middleware.md)
- **Environment variables, PUBLIC_URL, OAuth configuration** → [backend/services/environment.md](backend/services/environment.md)

## Database & Data Models
- **PostgreSQL schema, tables, relationships** → [backend/database.md](backend/database.md)
- **Prisma ORM, migrations** → [backend/database.md](backend/database.md)

## Plex Integration
- **OAuth, library scanning, fuzzy matching** → [integrations/plex.md](integrations/plex.md)
- **Availability status, plexGuid linking** → [integrations/plex.md](integrations/plex.md)

## Audiobookshelf Integration (PRD - Not Implemented)
- **Full PRD, architecture, implementation phases** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md)
- **Step-by-step implementation guide** → [features/audiobookshelf-implementation-guide.md](features/audiobookshelf-implementation-guide.md)
- **OIDC authentication (Authentik, Keycloak)** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md)
- **Manual user registration** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md)
- **Backend mode selection (Plex vs ABS)** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md)
- **Library service abstraction** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md)

## Audible Integration
- **Web scraping (popular, new releases)** → [integrations/audible.md](integrations/audible.md)
- **Database caching, real-time matching** → [integrations/audible.md](integrations/audible.md)
- **Book covers API for login page** → [frontend/pages/login.md](frontend/pages/login.md)

## Automation Pipeline
- **Full pipeline overview** → [phase3/README.md](phase3/README.md)
- **Torrent search via Prowlarr** → [phase3/prowlarr.md](phase3/prowlarr.md)
- **Torrent ranking/selection** → [phase3/ranking-algorithm.md](phase3/ranking-algorithm.md)
- **qBittorrent integration** → [phase3/qbittorrent.md](phase3/qbittorrent.md)
- **File organization, seeding** → [phase3/file-organization.md](phase3/file-organization.md)
- **Chapter merging (PRD, not implemented)** → [features/chapter-merging.md](features/chapter-merging.md)

## Background Jobs
- **Bull queue, processors, retry logic** → [backend/services/jobs.md](backend/services/jobs.md)
- **Scheduled/recurring jobs (cron)** → [backend/services/scheduler.md](backend/services/scheduler.md)
- **Job types:** search, download monitor, organize, Plex scan, cleanup, retries

## Frontend Components
- **Component catalog (cards, badges, forms)** → [frontend/components.md](frontend/components.md)
- **RequestCard, StatusBadge, ProgressBar** → [frontend/components.md](frontend/components.md)
- **Pages: home, search, requests, profile** → [frontend/components.md](frontend/components.md)

## BookDate (AI Recommendations)
- **AI-powered recommendations, swipe interface** → [features/bookdate.md](features/bookdate.md)
- **Configuration, OpenAI/Claude integration** → [features/bookdate.md](features/bookdate.md)
- **Setup wizard integration, settings** → [features/bookdate.md](features/bookdate.md)

## Admin Features
- **Dashboard (metrics, downloads, requests)** → [admin-dashboard.md](admin-dashboard.md)
- **Jobs management UI** → [backend/services/scheduler.md](backend/services/scheduler.md)

## Deployment
- **Docker Compose setup (multi-container)** → [deployment/docker.md](deployment/docker.md)
- **Unified container (all-in-one)** → [deployment/unified.md](deployment/unified.md)
- **Environment variables, volumes** → [deployment/docker.md](deployment/docker.md)
- **Database setup (Prisma), migrations** → [deployment/docker.md](deployment/docker.md)

## Feature-Specific Lookups
**"How do I add a new audiobook?"** → [integrations/audible.md](integrations/audible.md) (scraping), [phase3/README.md](phase3/README.md) (automation)
**"How do downloads work?"** → [phase3/qbittorrent.md](phase3/qbittorrent.md), [backend/services/jobs.md](backend/services/jobs.md)
**"How does Plex matching work?"** → [integrations/plex.md](integrations/plex.md)
**"How do scheduled jobs work?"** → [backend/services/scheduler.md](backend/services/scheduler.md)
**"How do I configure external services?"** → [setup-wizard.md](setup-wizard.md), [settings-pages.md](settings-pages.md)
**"What's the database schema?"** → [backend/database.md](backend/database.md)
**"How does authentication work?"** → [backend/services/auth.md](backend/services/auth.md)
**"How do I change the admin password?"** → [settings-pages.md](settings-pages.md), [backend/services/auth.md](backend/services/auth.md)
**"How do I deploy?"** → [deployment/docker.md](deployment/docker.md) (multi-container), [deployment/unified.md](deployment/unified.md) (all-in-one)
**"How do I use the unified container?"** → [deployment/unified.md](deployment/unified.md)
**"OAuth redirects to localhost / PUBLIC_URL not working"** → [backend/services/environment.md](backend/services/environment.md)
**"What environment variables do I need?"** → [backend/services/environment.md](backend/services/environment.md)
**"How does chapter merging work?"** → [features/chapter-merging.md](features/chapter-merging.md) (PRD only, not implemented)
**"How does Audiobookshelf integration work?"** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md) (PRD only, not implemented)
**"How do I use OIDC/Authentik/Keycloak?"** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md) (PRD only, not implemented)
**"How does manual user registration work?"** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md) (PRD only, not implemented)
**"How do I switch from Plex to Audiobookshelf?"** → [features/audiobookshelf-integration.md](features/audiobookshelf-integration.md) (PRD only, not implemented)
