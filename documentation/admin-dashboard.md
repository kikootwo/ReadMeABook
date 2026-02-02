# Admin Dashboard

**Status:** ✅ Implemented

Comprehensive overview of system metrics, active requests, download monitoring, and quick access to settings.

## Sections

- **Metrics:** Total requests, active downloads, completed/failed requests, total users, system health
- **Requests Awaiting Approval:** Grid of requests pending admin approval (approve/deny buttons, auto-refresh)
- **Active Downloads:** Real-time table with title, progress, speed, ETA
- **Request Management:** Full-featured table with filtering, sorting, pagination
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

**GET /api/admin/requests** (Paginated)
- Query params: `page`, `pageSize` (10|25|50|100), `search`, `status`, `userId`, `sortBy`, `sortOrder`
- Returns: `requests[]`, `total`, `page`, `pageSize`, `totalPages`
- Sorting: createdAt (default), completedAt, title, user, status
- Filtering: by status, by user, text search (title/author)

**GET /api/admin/requests/recent** (Legacy)
- Request ID, title, user, status, created/completed dates
- Limited to 50 entries, no filtering

**GET /api/admin/requests/pending-approval**
- Requests with status 'awaiting_approval', includes audiobook + user details
- Returns: requests array, count

**POST /api/admin/requests/[id]/approve**
- Action: 'approve' (set status to 'pending', trigger search) or 'deny' (set status to 'denied')
- Validates request is in 'awaiting_approval' status

**GET /api/admin/users**
- User ID, Plex ID, username, email, role, avatar, created/updated dates, last login, request count, autoApproveRequests

**PUT /api/admin/users/[id]**
- Update user role (user/admin), autoApproveRequests (true/false/null)
- Prevents self-demotion

**GET /api/admin/settings/auto-approve**
- Get global auto-approve setting (boolean)

**PATCH /api/admin/settings/auto-approve**
- Update global auto-approve setting (boolean)

**GET /api/admin/logs**
- Query params: page, limit, status, type
- Returns: Job logs with request/audiobook/user details, pagination info
- Filters: status (all/pending/active/completed/failed/delayed/stuck), type (all job types)

## Request Management Features

- **Filter Bar:**
  - Text search (title/author, 300ms debounce)
  - Status dropdown (all statuses)
  - User dropdown (all users)
  - Clear filters button
- **Sortable Columns:** Click headers to sort by title, user, status, requested, completed
- **Pagination:** Page navigation, page size selector (10/25/50/100), results count
- **URL State:** Filters/sort/page stored in URL query params (shareable, bookmarkable)
- **Actions:** Delete, cancel, manual search, fetch ebook (via dropdown)

## Features

- Auto-refresh every 10 seconds (SWR)
- Back to Home button in header
- Admin role required
- Real-time progress updates
- **Requests Awaiting Approval Section:**
  - Only visible when pending approval requests exist
  - Grid layout (3 columns on desktop)
  - Book cards with cover, title, author, user info, timestamp
  - Approve (green) and Deny (red) buttons
  - Loading states during approval/denial actions
  - Toast notifications for success/errors
  - Mutates pending-approval, recent requests, metrics caches on action

## Navigation

- `/admin/jobs` - Scheduled jobs management (trigger, edit schedule, enable/disable)
- `/admin/settings` - System settings (Plex, Prowlarr, paths)
- `/admin/users` - User management (view users, change roles)
- `/admin/logs` - System logs (view job history, errors, filter by status/type)

## User Management Features

- List all users with avatar, email, role, request count, last login, autoApproveRequests
- Edit user roles (user/admin)
- Cannot change own role (security)
- Shows request count per user
- Role badges (purple for admin, gray for user)
- **Global Auto-Approve Toggle:**
  - Checkbox at top: "Auto-approve all requests by default"
  - Updates Configuration.auto_approve_requests
- **Per-User Auto-Approve Control:**
  - Dropdown: Use Global (null), Always Auto-Approve (true), Always Require Approval (false)
  - Updates User.autoApproveRequests
  - Shows effective setting (considers global + per-user)

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
