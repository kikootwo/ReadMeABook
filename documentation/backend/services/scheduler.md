# Recurring Jobs Scheduler

**Status:** ✅ Implemented

Manages recurring/scheduled jobs providing automated tasks (Plex scans, Audible refresh) with scheduled (cron) execution and manual triggering.

## Recent Updates

- Config validation before job execution
- Audible refresh persists to database
- Enhanced error handling with clear messages
- Schedule editing UI with toast notifications

## Scheduled Jobs

1. **plex_library_scan** - Default: every 6 hours, disabled by default (enable after setup)
2. **audible_refresh** - Default: daily midnight, fetches 200 popular + 200 new releases, stores with rankings, disabled by default
3. **retry_missing_torrents** - Default: daily midnight, re-searches 'awaiting_search' status (limit 50), enabled by default
4. **retry_failed_imports** - Default: every 6 hours, re-attempts 'awaiting_import' status (limit 50), enabled by default
5. **cleanup_seeded_torrents** - Default: every 30 mins, deletes torrents after seeding requirements met, respects `seeding_time_minutes` config (0 = never), enabled by default

## Architecture: Bull + Cron

- Repeatable jobs with cron expressions
- Manual trigger capability
- Job persistence and retry logic
- Admin UI management

## Cron Expressions

```
* * * * *
│ │ │ │ └─ day of week (0-7)
│ │ │ └─── month (1-12)
│ │ └───── day of month (1-31)
│ └─────── hour (0-23)
└───────── minute (0-59)
```

**Examples:**
- `0 */6 * * *` - Every 6 hours
- `0 0 * * *` - Daily midnight
- `*/30 * * * *` - Every 30 mins

## API Endpoints

**GET /api/admin/jobs** - Get all scheduled jobs (admin auth)

**POST /api/admin/jobs** - Create job (admin auth)
```json
{
  "name": "Daily Audible Refresh",
  "type": "audible_refresh",
  "schedule": "0 0 * * *",
  "enabled": true
}
```

**PUT /api/admin/jobs/:id** - Update job (admin auth)

**DELETE /api/admin/jobs/:id** - Delete job (admin auth)

**POST /api/admin/jobs/:id/trigger** - Manually trigger job (admin auth)

**GET /api/admin/jobs/:id/history?limit=50** - Job execution history (admin auth)

## Data Model

```typescript
interface ScheduledJob {
  id: string;
  name: string;
  type: JobType;
  schedule: string; // cron
  enabled: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  payload: any;
}
```

## Audible Refresh Processor

**Implementation:**
1. Clear previous `isPopular`/`isNewRelease` flags
2. Fetch 200 popular + 200 new releases (multi-page scraping)
3. Store/update in DB with category flags and rankings (`popularRank`, `newReleaseRank`)
4. Record sync timestamp (`lastAudibleSync`)
5. Perform fuzzy matching (70% threshold) against Plex library
6. Set `plexGuid` when match found (with duplicate protection)
7. Update `availabilityStatus` to 'available' or 'unknown'

**Duplicate PlexGuid Handling:** Since `plexGuid` has UNIQUE constraint, only first match gets assigned to prevent violations.

## Fixed Issues ✅

- ✅ Jobs running without config validation
- ✅ Default alert() popups → toast notifications
- ✅ No UI for editing schedules → added edit modal
- ✅ Audible data not persisting → saves to database
- ✅ Download progress logging ~500x/s → 10s delay
- ✅ Requests failing permanently (no torrents) → retry system with 'awaiting_search'
- ✅ Requests failing permanently (no files) → retry system with max 5 retries + 'warn' status
- ✅ Failed requests blocking re-requests → allow re-requesting failed/warn/cancelled
- ✅ Files deleted immediately → kept until seeding requirements met
- ✅ No seeding time config → added `seeding_time_minutes`

## Tech Stack

- Bull repeatable jobs
- PostgreSQL (scheduled_jobs table)
- Bull/Redis infrastructure
