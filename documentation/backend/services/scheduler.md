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
- Admin Jobs page shows per-job descriptions inline; startup auto-renames legacy "Plex *" job names to neutral defaults (type-gated, exact-literal match only)

## Scheduled Jobs

1. **plex_library_scan** - Default: every 6 hours, full library scan, disabled by default (enable after setup)
2. **plex_recently_added_check** - Default: every 5 minutes, lightweight polling of top 10 recently added items, enabled by default
3. **audible_refresh** - Default: daily midnight, fetches 200 popular + 200 new releases, stores with rankings, disabled by default
4. **retry_missing_torrents** - Default: daily 02:00 (staggered — see Schedule Staggering), processes union of `awaiting_search` ∪ `awaiting_release` (limit 50), handles both audiobook and ebook requests. Bidirectional transitions: `awaiting_search` → `awaiting_release` when release date is future + `indexer.skip_unreleased` ON; `awaiting_release` → `awaiting_search` + run search when release date has passed or setting OFF. Sole owner of these transitions. **Stale-`searching` reaper:** before the main pass, resets any request stuck in `searching` with `updatedAt` older than `SEARCHING_STALE_MINUTES` (30) → `awaiting_search` (`updateMany`), so orphans from a stalled/crashed search job (where the `job-queue` `failed` safety net never fired, e.g. hard restart mid-job) self-heal and get re-queued in the same pass. Returns `reclaimed` count. Enabled by default.
5. **retry_failed_imports** - Default: every 6 hours, re-attempts 'awaiting_import' status (limit 50), enabled by default
6. **find_missing_ebooks** - Default: daily 03:00 (staggered — see Schedule Staggering), scans `downloaded` ∪ `available` audiobook requests (limit 50) for missing ebook companions and triggers the existing ebook fetch flow (`addSearchEbookJob`). Gated by `ebook_auto_grab_enabled` AND at least one ebook source enabled (`ebook_annas_archive_enabled` or `ebook_indexer_search_enabled`; legacy `ebook_sidecar_enabled` accepted as Anna's fallback). Skips ebook children in-flight (`pending`, `awaiting_approval`, `searching`, `downloading`, `processing`, `awaiting_search`, `awaiting_release`) or `cancelled`. Retries `failed`/`warn` children up to **5 lifetime auto-retries** per audiobook, tracked in `Request.ebookAutoRetryCount` (nullable; processor-private — manual "Fetch Ebook" never reads/writes it). Per-candidate writes are wrapped in `prisma.$transaction` for race-safety with concurrent auto-grab; counter rolls back if `addSearchEbookJob` throws. Enabled by default. Returns `{ scanned, gapsFound, triggered, created, retried, skippedInFlight, skippedCancelled, skippedCapHit }`.
7. **cleanup_seeded_torrents** - Default: every 30 mins, deletes torrents after seeding requirements met. Respects per-indexer `seedingTimeMinutes` AND `ratioLimit` (BOTH required when set; `0` disables that criterion; both `0` = never cleaned up). Undefined ratio with `ratioLimit > 0` = not met (safe-deny). Enabled by default.
8. **monitor_rss_feeds** - Default: every 15 mins, checks RSS feeds from enabled indexers, matches against `awaiting_search` requests (audiobook and ebook, limit 100). Query is unchanged — release-date gate is applied AFTER a match is found: if matched book is unreleased + `indexer.skip_unreleased` ON, the match is skipped and request status is NOT mutated (retry job owns transitions). Enabled by default.

## Schedule Staggering (anti-thundering-herd)

Daily heavy jobs are spread across early-morning hours so they don't all fire at `0 0` and freeze the single Node event loop (a ~5min freeze expires every Bull job lock → mass "stalled" failures → searches orphaned in `searching`). Defaults: `audible_refresh` **00:00** (heaviest, runs alone), `check_watched_lists` **01:00**, `retry_missing_torrents` **02:00**, `find_missing_ebooks` **03:00**. Set in `scheduler.service.ts` `ensureDefaultJobs`. **Note:** `ensureDefaultJobs` only creates jobs that don't exist — changing these defaults does NOT migrate existing installs' schedules (update those rows in the DB or via the Jobs UI).

## Bull Lock / Stall Tolerance

Queue `settings` (`job-queue.service.ts`): `lockDuration: 120000` (2min), `lockRenewTime: 60000`, `stalledInterval: 60000`, `maxStalledCount: 2`. Bull defaults (30s lock, 1 stall) falsely fail long external searches (ebook via byparr runs 60-130s+) as stalled. Paired with `search_ebook` concurrency **1** (serialized against the single byparr/Cloudflare solver) to keep the solver responsive and the event loop unblocked.

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
1. Fetch 200 popular + 200 new releases (multi-page scraping)
2. Download and cache cover thumbnails locally (stored in `/app/cache/thumbnails`)
3. Wipe and re-populate `AudibleCacheCategory` entries with reserved IDs (`__popular__`, `__new_releases__`) and user-configured category IDs
4. Upsert book metadata in `AudibleCache`, ranked entries in `AudibleCacheCategory`
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
- ✅ No ratio-based seeding policy → added per-indexer `ratioLimit` (AND-semantics with `seedingTimeMinutes`; `0` disables; undefined client ratio = safe-deny)
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
