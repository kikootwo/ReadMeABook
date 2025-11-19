# Admin Dashboard

**Status:** ✅ Implemented

Comprehensive overview of system metrics, active requests, download monitoring, and quick access to settings.

## Sections

- **Metrics:** Total requests, active downloads, completed/failed requests, total users, system health
- **Active Downloads:** Real-time table with title, progress, speed, ETA
- **Recent Requests:** Last 50 with status and timestamps
- **Quick Actions:** Links to settings, users, scheduled jobs, system logs

## Data Sources

**GET /api/admin/metrics**
- Total requests (all time)
- Active downloads (status: 'downloading')
- Completed requests (status: 'downloaded' or 'available', last 30 days)
- Failed requests (status: 'failed', last 30 days)
- Total users
- System health indicators

**GET /api/admin/downloads/active**
- Request ID, title, progress %, speed, ETA, user

**GET /api/admin/requests/recent**
- Request ID, title, user, status, created/completed dates

**GET /api/admin/users**
- User ID, Plex ID, username, email, role, avatar, created/updated dates, last login, request count

**PUT /api/admin/users/[id]**
- Update user role (user/admin)
- Prevents self-demotion

**GET /api/admin/logs**
- Query params: page, limit, status, type
- Returns: Job logs with request/audiobook/user details, pagination info
- Filters: status (all/pending/active/completed/failed/delayed/stuck), type (all job types)

## Features

- Auto-refresh every 10 seconds (SWR)
- Back to Home button in header
- Admin role required
- Real-time progress updates

## Navigation

- `/admin/jobs` - Scheduled jobs management (trigger, edit schedule, enable/disable)
- `/admin/settings` - System settings (Plex, Prowlarr, paths)
- `/admin/users` - User management (view users, change roles)
- `/admin/logs` - System logs (view job history, errors, filter by status/type)

## User Management Features

- List all users with avatar, email, role, request count, last login
- Edit user roles (user/admin)
- Cannot change own role (security)
- Shows request count per user
- Role badges (purple for admin, gray for user)

## System Logs Features

- Real-time job monitoring (10s refresh)
- Filter by status (pending/active/completed/failed/delayed/stuck)
- Filter by job type (search_indexers/monitor_download/organize_files/scan_plex/match_plex)
- Shows related audiobook/user for request jobs
- Expandable error messages
- Duration calculation
- Attempt tracking (current/max)
- Pagination (50 logs per page)
- Shows Bull job ID

## Tech Stack

- React Server Components + SWR
- Tailwind CSS
- Prisma aggregations for metrics
- Database queries with indexing
