# Admin Dashboard

**Status:** ⏳ In Development

Comprehensive overview of system metrics, active requests, download monitoring, and quick access to settings.

## Sections

- **Metrics:** Total requests, active downloads, completed/failed requests, total users, system health
- **Active Downloads:** Real-time table with title, progress, speed, ETA
- **Recent Requests:** Last 50 with status and timestamps
- **Quick Actions:** Links to settings, users, library, system logs, jobs

## Data Sources

**GET /api/admin/metrics**
- Total requests (all time)
- Active downloads (current)
- Completed/failed requests (last 30 days)
- Total users
- System health indicators

**GET /api/admin/downloads/active**
- Request ID, title, progress %, speed, ETA, user

**GET /api/admin/requests/recent**
- Request ID, title, user, status, created/completed dates

## Features

- Auto-refresh every 10 seconds (SWR)
- Back to Home button in header
- Admin role required
- Real-time progress updates

## Navigation

- `/admin/jobs` - Scheduled jobs management
- `/admin/settings` - System settings
- `/admin/users` - User management
- `/admin/library` - Library management
- `/admin/logs` - System logs

## Tech Stack

- React Server Components + SWR
- Tailwind CSS
- Prisma aggregations for metrics
- Database queries with indexing
