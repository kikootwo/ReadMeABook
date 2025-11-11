# ReadMeABook - Audiobook Library Management System

## Project Overview

**ReadMeABook** is a self-hosted, full-stack web application that automates audiobook acquisition and management, similar to how Radarr/Overseerr work for movies. The system provides a beautiful, modern interface for end-users to request audiobooks, while giving administrators comprehensive tools to manage the entire library lifecycle.

## Current State

**Status:** MVP Complete - Phases 1-4 ✅

The core application is fully functional with complete automation from user request to Plex library availability. All foundation, user features, automation engine, and admin tools have been implemented. The system includes:

- **Complete Automation Pipeline**: Search → Download → Organize → Plex Integration
- **Setup Wizard**: First-time configuration for all external services
- **Admin Dashboard**: Real-time monitoring with metrics and system health
- **Settings Management**: Full configuration interface for all services
- **User Interface**: Search, request, and track audiobook acquisitions

Docker deployment configuration pending. Phases 5-6 (enhanced features) are post-MVP.

## Architecture Overview

### Technology Stack

- **Frontend:** Next.js 14+ with TypeScript and Tailwind CSS
- **Backend:** Node.js with Express and TypeScript (via Next.js API routes)
- **Database:** PostgreSQL (embedded within Docker container)
- **Job Queue:** Bull with Redis (embedded within Docker container)
- **Deployment:** Single Docker image with all services embedded

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Container                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │            Next.js Application                     │ │
│  │  ┌──────────────┐        ┌──────────────┐         │ │
│  │  │   Frontend   │◄──────►│   Backend    │         │ │
│  │  │  (React/UI)  │        │ (Express API)│         │ │
│  │  └──────────────┘        └──────┬───────┘         │ │
│  │                                  │                  │ │
│  │         ┌────────────────────────┼─────────┐       │ │
│  │         ▼                        ▼         ▼       │ │
│  │   ┌──────────┐           ┌─────────┐  ┌──────┐   │ │
│  │   │PostgreSQL│           │  Bull   │  │Redis │   │ │
│  │   │ Database │           │  Queue  │  │      │   │ │
│  │   └──────────┘           └─────────┘  └──────┘   │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Volume Mounts:                                          │
│  • /config  - Configuration, DB, logs                    │
│  • /downloads - Temporary download location              │
│  • /media - Final audiobook library location             │
└─────────────────────────────────────────────────────────┘
           │                 │                 │
           ▼                 ▼                 ▼
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │   Plex   │      │ Indexer  │      │ Download │
    │  Server  │      │(Prowlarr/│      │  Client  │
    │          │      │ Jackett) │      │(qBit/    │
    │          │      │          │      │Trans)    │
    └──────────┘      └──────────┘      └──────────┘
```

### Core Components

1. **Authentication & Authorization** - Plex OAuth, JWT sessions, RBAC
2. **Setup Wizard** - First-run configuration interface
3. **User Interface** - Request management, discovery, search
4. **Admin Interface** - Library management, settings, monitoring
5. **Automation Engine** - Background jobs for download lifecycle
6. **External Integrations** - Plex, indexers, download clients, Audible

## Documentation Structure

### Backend Documentation

- [API Documentation](backend/api.md) - REST endpoints, authentication, request/response contracts
- [Database Schema](backend/database.md) - Tables, relationships, migrations
- [Services](backend/services/README.md) - Business logic layer documentation
  - [Authentication Service](backend/services/auth.md) - Plex OAuth, JWT, session management
  - [Configuration Service](backend/services/config.md) - Settings storage and encryption
  - [Job Queue Service](backend/services/jobs.md) - Background job processing
- [Integrations](integrations/README.md) - External service connections
  - [Plex Integration](integrations/plex.md) - OAuth, library scanning, media detection
  - [Indexer Integration](integrations/indexers.md) - Prowlarr and Jackett search
  - [Download Client Integration](integrations/download-clients.md) - qBittorrent and Transmission
  - [Audible Integration](integrations/audible.md) - Metadata scraping

### Frontend Documentation

- [UI Components](frontend/components.md) - Reusable component library
- [Pages](frontend/pages.md) - Route structure and page components
- [State Management](frontend/state.md) - Global state and data flow
- [Styling](frontend/styling.md) - Tailwind configuration and design system

### Deployment Documentation

- [Docker Configuration](deployment/docker.md) - Dockerfile, image building, embedded services
- [Environment Variables](deployment/environment.md) - Configuration options
- [Installation Guide](deployment/installation.md) - User-facing setup instructions
- [Upgrade Process](deployment/upgrades.md) - Version migration procedures

## Design Principles

### Code Standards

- **Modularity:** No file should exceed 300-400 lines of code
- **Documentation:** Every code file must link to its documentation in a header comment
- **Type Safety:** Strict TypeScript throughout the stack
- **Error Handling:** Comprehensive error handling with clear user messages
- **Security:** Encrypted sensitive data, input validation, RBAC enforcement

### Development Workflow

1. Read relevant documentation before making changes
2. Update documentation after making changes
3. Add file headers to all new files
4. Keep files focused and under size limits
5. Write tests for critical paths

## User Journeys

### End User Flow

1. Visit application → Login with Plex
2. Search for audiobook via Audible
3. Click "Request"
4. System automatically: searches indexers → selects best torrent → downloads → organizes files → triggers Plex scan
5. User sees real-time status updates
6. Audiobook appears in Plex library

### Administrator Flow

1. First-time setup via wizard
2. Configure external services (Plex, indexer, download client)
3. Monitor requests and downloads via dashboard
4. Manage users and permissions
5. Troubleshoot failed requests
6. Adjust settings and preferences

## External Dependencies

### Required Services

- **Plex Media Server** - For authentication and media library
- **Indexer** - Prowlarr OR Jackett (user choice)
- **Download Client** - qBittorrent OR Transmission (user choice)

### Optional Services

- **Audible** - Metadata and discovery (web scraping, no credentials required)

## Development Phases

### Phase 1: Foundation & Setup ✅ COMPLETED

- [x] Project structure and Docker configuration
- [x] Database schema and models
- [x] Setup wizard
- [x] Authentication system
- [x] Configuration management

### Phase 2: Core User Features ✅ COMPLETED

- [x] Audiobook discovery and search
- [x] Request management
- [x] User dashboard
- [x] Status tracking

### Phase 3: Automation Engine ✅ COMPLETED

- [x] Indexer search and ranking
- [x] Download monitoring
- [x] File organization
- [x] Plex integration
- [x] Background job system

### Phase 4: Administrator Tools ✅ COMPLETED

- [x] Admin dashboard
- [x] Library management (via admin dashboard)
- [x] User management (basic)
- [x] Settings pages
- [x] System monitoring

### Phase 5: Enhanced Features (Post-MVP)

- [ ] Real-time WebSocket updates
- [ ] Advanced search and filters
- [ ] Personal library view

### Phase 6: Advanced Admin Features (Post-MVP)

- [ ] Statistics and analytics
- [ ] Notification system
- [ ] Quality profiles
- [ ] User quotas

## Known Issues & Limitations

*This section will be updated as development progresses.*

## Contributing Guidelines

1. Follow CLAUDE.md standards strictly
2. Update documentation before and after code changes
3. Maintain file size limits (300-400 lines max)
4. Add proper file headers with documentation links
5. Write clear commit messages
6. Test all changes thoroughly

## Resources

- [Product Requirements Document](../PRD.md) - Full feature specifications
- [Project Standards](../CLAUDE.md) - Development workflow and standards
- [Plex API Documentation](../PlexMediaServerAPIDocs.json) - Official Plex API reference
