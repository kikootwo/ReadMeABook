# Recurring Jobs Scheduler

**Status:** ✅ Implemented

Manages recurring/scheduled jobs providing automated tasks (Plex scans, Audible refresh) with scheduled (cron) execution and manual triggering.

## Recent Updates

- Config validation before job execution
- Audible refresh persists to database
- Enhanced error handling with clear messages
- Schedule editing UI with toast notifications
- Human-friendly schedule descriptions and editor (preset/custom/advanced modes)
- Real-time cron expression preview

## Scheduled Jobs

1. **plex_library_scan** - Default: every 6 hours, full library scan, disabled by default (enable after setup)
2. **plex_recently_added_check** - Default: every 5 minutes, lightweight polling of top 10 recently added items, enabled by default
3. **audible_refresh** - Default: daily midnight, fetches 200 popular + 200 new releases, stores with rankings, disabled by default
4. **retry_missing_torrents** - Default: daily midnight, re-searches 'awaiting_search' status (limit 50), enabled by default
5. **retry_failed_imports** - Default: every 6 hours, re-attempts 'awaiting_import' status (limit 50), enabled by default
6. **cleanup_seeded_torrents** - Default: every 30 mins, deletes torrents after seeding requirements met, respects `seeding_time_minutes` config (0 = never), enabled by default
7. **monitor_rss_feeds** - Default: every 15 mins, checks RSS feeds from enabled indexers, matches against 'awaiting_search' requests (limit 100), triggers search jobs for matches, enabled by default

## Architecture: Bull + Cron

- Repeatable jobs with cron expressions (Bull's built-in scheduler)
- Manual trigger capability
- Job persistence and retry logic
- Admin UI management
- Automatic scheduling/unscheduling when jobs enabled/disabled
- Schedule updates handled by unscheduling old job and scheduling new one

## Human-Friendly Scheduling UI

**Three Modes:**
1. **Common Schedules** - Preset options (every 15min, hourly, daily, weekly, monthly)
2. **Custom Schedule** - Visual builder with dropdowns for minutes/hours/daily/weekly/monthly
3. **Advanced (Cron)** - Raw cron expression for power users

**Features:**
- Human-readable display: "Every 6 hours" instead of "0 */6 * * *"
- Real-time preview of cron expressions
- Visual schedule builder (no cron knowledge required)
- Cron validation before saving
- Shows both human text and cron expression in job list

**Utility Functions** (`src/lib/utils/cron.ts`):
- `cronToHuman(cron)` - Converts cron to readable text
- `customScheduleToCron(schedule)` - Builds cron from visual inputs (auto-converts 24+ hour intervals to daily)
- `cronToCustomSchedule(cron)` - Parses cron to visual inputs
- `isValidCron(cron)` - Validates cron expression

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

## Implementation Details

**Scheduler Service (`scheduler.service.ts`):**
- `start()`: Initializes scheduler, creates default jobs, schedules all enabled jobs
- `scheduleJob()`: Adds job to Bull as repeatable job with cron expression
- `unscheduleJob()`: Removes repeatable job from Bull
- `updateScheduledJob()`: Unschedules old job, updates DB, schedules new job if enabled
- `deleteScheduledJob()`: Unschedules job before deleting from DB

**Job Queue Service (`job-queue.service.ts`):**
- `addRepeatableJob()`: Registers job type with Bull's repeat scheduler
- `removeRepeatableJob()`: Removes job from Bull's repeat scheduler
- Processors for each scheduled job type call `scheduler.triggerJobNow()`
- `setMaxListeners(20)`: Set on both Redis client and Bull queue to accommodate 12 job processors (6 regular + 6 scheduled)

**Flow:**
1. App starts → `scheduler.start()` → schedules all enabled jobs
2. Bull triggers job at cron time → processor calls `triggerJobNow()`
3. `triggerJobNow()` executes job-specific logic (Plex scan, Audible refresh, etc.)
4. Updates `lastRun` timestamp in database

## Audible Refresh Processor

**Implementation:**
1. Clear previous `isPopular`/`isNewRelease` flags
2. Fetch 200 popular + 200 new releases (multi-page scraping)
3. Download and cache cover thumbnails locally (stored in `/app/cache/thumbnails`)
4. Store/update in DB with category flags, rankings (`popularRank`, `newReleaseRank`), and cached cover paths
5. Record sync timestamp (`lastAudibleSync`)
6. Clean up unused thumbnails (removes covers for audiobooks no longer in cache)
7. Perform fuzzy matching (70% threshold) against Plex library
8. Set `plexGuid` when match found (with duplicate protection)
9. Update `availabilityStatus` to 'available' or 'unknown'

**Duplicate PlexGuid Handling:** Since `plexGuid` has UNIQUE constraint, only first match gets assigned to prevent violations.

**Thumbnail Caching:** Downloads cover images from Audible and stores them locally to reduce external requests. Cached thumbnails are served via `/api/cache/thumbnails/[filename]` endpoint. Unused thumbnails are automatically cleaned up after each sync.

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
- ✅ Scheduled jobs not running on schedule → implemented Bull repeatable jobs with cron scheduling
- ✅ MaxListenersExceededWarning → increased maxListeners to 20 on both Redis client and Bull queue
- ✅ Cron expressions not user-friendly → added human-readable descriptions and visual schedule builder
- ✅ Scheduled jobs triggered by timer not appearing in system logs → Job records now created automatically for timer-triggered jobs
- ✅ Scheduled jobs triggered by timer not updating lastRun timestamp → Job queue now updates lastRun when processing timer-triggered jobs
- ✅ Daily cron patterns at non-midnight hours not recognized → Fixed `getIntervalFromCron` to parse any daily time (e.g., "0 4 * * *")
- ✅ "Every 24 hours" interval validation error → Auto-converts 24+ hour intervals to daily schedule (0 0 * * *)

## Tech Stack

- Bull repeatable jobs
- PostgreSQL (scheduled_jobs table)
- Bull/Redis infrastructure
