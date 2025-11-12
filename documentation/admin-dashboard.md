# Admin Dashboard

## Current State

**Status:** In Development

The admin dashboard provides administrators with a comprehensive overview of system metrics, active requests, download monitoring, and quick access to settings.

## Design Architecture

### Why an Admin Dashboard?

**Requirements:**
- Administrators need visibility into system health and activity
- Real-time monitoring of active downloads and requests
- Quick access to common administrative tasks
- Metrics for understanding usage patterns
- Ability to identify and troubleshoot issues quickly

### Dashboard Sections

```
┌─────────────────────────────────────────────────────────┐
│                    Admin Dashboard                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐           │
│  │  Total    │  │  Active   │  │ Completed │           │
│  │ Requests  │  │ Downloads │  │  Requests │           │
│  └───────────┘  └───────────┘  └───────────┘           │
│                                                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐           │
│  │  Failed   │  │   Total   │  │  System   │           │
│  │ Requests  │  │   Users   │  │  Health   │           │
│  └───────────┘  └───────────┘  └───────────┘           │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Active Downloads                       │   │
│  │  ┌────────┬──────────┬────────┬────────────┐   │   │
│  │  │ Title  │ Progress │ Speed  │    ETA     │   │   │
│  │  ├────────┼──────────┼────────┼────────────┤   │   │
│  │  │ Book 1 │   45%    │ 5MB/s  │  10 mins   │   │   │
│  │  │ Book 2 │   12%    │ 3MB/s  │  25 mins   │   │   │
│  │  └────────┴──────────┴────────┴────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Recent Requests                        │   │
│  │  ┌────────┬──────────┬────────┬────────────┐   │   │
│  │  │ Title  │  User    │ Status │    Date    │   │   │
│  │  ├────────┼──────────┼────────┼────────────┤   │   │
│  │  │ Book 3 │  Alice   │ ✓ Done │  2h ago    │   │   │
│  │  │ Book 4 │   Bob    │ Failed │  5h ago    │   │   │
│  │  └────────┴──────────┴────────┴────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Quick Actions                          │   │
│  │  [Settings] [Users] [Library] [System Logs]     │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Implementation Details

### Component Structure

```
src/app/admin/
├── page.tsx                    # Main dashboard page
├── components/
│   ├── MetricCard.tsx         # Reusable metric display card
│   ├── ActiveDownloadsTable.tsx  # Real-time download monitoring
│   ├── RecentRequestsTable.tsx   # Recent requests list
│   └── QuickActions.tsx       # Quick action buttons
```

### Data Sources

**Metrics API:**
- `GET /api/admin/metrics` - System metrics summary
  - Total requests (all time)
  - Active downloads (current)
  - Completed requests (last 30 days)
  - Failed requests (last 30 days)
  - Total users
  - System health indicators

**Active Downloads API:**
- `GET /api/admin/downloads/active` - Currently downloading items
  - Request ID
  - Audiobook title
  - Progress percentage
  - Download speed
  - ETA
  - User who requested

**Recent Requests API:**
- `GET /api/admin/requests/recent` - Recent requests (last 50)
  - Request ID
  - Audiobook title
  - Requesting user
  - Status
  - Created date
  - Completed date (if applicable)

### Auto-Refresh

Dashboard data refreshes automatically every 10 seconds to show real-time updates:
- Active downloads update progress
- Metrics reflect latest counts
- New requests appear in recent list

## Tech Stack

**Frontend:**
- React Server Components for initial data load
- Client components with SWR for auto-refresh
- Tailwind CSS for styling
- Chart.js for future visualizations

**Backend:**
- Prisma aggregations for metrics
- Database queries with proper indexing
- Caching for expensive queries

## Dependencies

**Existing:**
- Database schema (requests, download_history, users)
- Authentication middleware
- Authorization (admin role check)

**New:**
- SWR for data fetching
- Dashboard layout components

## Usage Examples

### Metrics Display

```tsx
<MetricCard
  title="Total Requests"
  value={metrics.totalRequests}
  icon={<BookIcon />}
  trend="+12% from last month"
/>
```

### Active Downloads

```tsx
<ActiveDownloadsTable
  downloads={activeDownloads}
  refreshInterval={10000}
/>
```

### Recent Requests

```tsx
<RecentRequestsTable
  requests={recentRequests}
  onViewDetails={(id) => router.push(`/admin/requests/${id}`)}
/>
```

## Navigation

The admin dashboard includes navigation elements to improve usability:

- **Back to Home Button:** Located in the header, allows admins to quickly return to the main application homepage
- **Quick Actions:** Links to settings, users, library, and system logs
- **Jobs Management:** Link to /admin/jobs for managing recurring tasks

## Security

- Admin dashboard requires authenticated user with admin role
- Middleware checks user.role === 'admin' before allowing access
- API endpoints validate admin status
- Sensitive information (API keys, passwords) never exposed

## Related Pages

- **/admin/jobs** - Scheduled Jobs Management (see documentation/backend/services/scheduler.md)
- **/admin/settings** - Settings Management
- **/admin/users** - User Management
- **/admin/library** - Library Management
- **/admin/logs** - System Logs

## Future Enhancements

- Charts and graphs for historical trends
- Configurable refresh intervals
- Export reports to CSV
- System health alerts
- Resource usage monitoring (disk space, CPU, memory)
