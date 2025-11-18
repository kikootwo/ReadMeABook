# Background Job System

**Status:** ✅ Implemented

Manages background job queue using Bull (Redis-backed) for async tasks: searching indexers, monitoring downloads, organizing files, scanning Plex.

## Detailed Event Logging

- **JobEvent table:** Stores timestamped event logs for all job operations
- **JobLogger utility:** (`src/lib/utils/job-logger.ts`) provides structured logging
- **Levels:** info, warn, error
- **Context:** Processor name (e.g., OrganizeFiles, FileOrganizer, MonitorDownload)
- **Metadata:** Optional JSON data for structured details
- **UI:** Admin logs page shows detailed event logs, job results, and errors

## Queue System: Bull + Redis

- Redis-backed for persistence
- Retry: 3 attempts, exponential backoff (2s, 4s, 8s)
- Priority: High (10), Medium (5), Low (1)
- Concurrency: 3 per job type
- Jobs survive app restarts
- Remove on complete: keep last 100
- Remove on fail: keep last 200
- MaxListeners: 20 on both Redis client and Bull queue (accommodates 12 job processors)

## Job Types

1. **search_indexers** - Search Prowlarr for torrents
2. **monitor_download** - Poll progress (10s intervals)
3. **organize_files** - Move to media library, set status to 'downloaded'
4. **scan_plex** - Full scan of Plex library, match 'downloaded' requests
5. **plex_recently_added_check** - Lightweight polling of recently added items (top 10)
6. **match_plex** - Fuzzy match to Plex item (deprecated - now handled by scan_plex)

## Special Behaviors

**monitor_download:**
- 3s initial delay before first check (avoids race condition with qBittorrent processing)
- Retry logic: 3 attempts with exponential backoff (500ms, 1s, 2s) for getTorrent failures
- Transient error handling: "torrent not found" errors don't mark request as failed during retries
- Request stays in "downloading" status during all retry attempts
- Only marks request as "failed" after all Bull retries (3 attempts) exhausted
- 10s delay between checks (prevents excessive logging)
- Only logs progress at 5% intervals or first 5%
- Auto-reschedules until complete/failed

**search_indexers:**
- No torrents found → 'awaiting_search' status (not failed)
- Allows automatic retry via scheduled job

**organize_files:**
- No audiobook files found → 'awaiting_import' status
- Tracks `import_attempts` (max 5 default)
- After max retries → 'warn' status for manual intervention
- Success → 'downloaded' status (green, waiting for Plex scan)
- No longer triggers immediate match_plex job

**scan_plex:**
- Scans Plex library and populates plex_library table
- After scan, checks for requests with status 'downloaded'
- Fuzzy matches downloaded requests against Plex library (70% threshold)
- Matched requests → 'available' status with plexGuid linked

## Job Payloads

All payloads now include `jobId` (database job ID) automatically added by the job queue service.

```typescript
// search_indexers
{jobId: string, requestId: string, audiobook: {id, title, author}}

// monitor_download
{jobId: string, requestId: string, downloadHistoryId: string, downloadClientId: string, downloadClient: 'qbittorrent'|'transmission'}

// organize_files
{jobId: string, requestId: string, audiobookId: string, downloadPath: string, targetPath: string}

// scan_plex
{jobId: string, libraryId: string, partial?: boolean, path?: string}

// match_plex
{jobId: string, requestId: string, audiobookId: string, title: string, author: string}
```

## Using JobLogger in Processors

```typescript
import { createJobLogger } from '../utils/job-logger';

export async function processOrganizeFiles(payload: OrganizeFilesPayload) {
  const { jobId, requestId, audiobookId } = payload;

  // Create logger
  const logger = jobId ? createJobLogger(jobId, 'OrganizeFiles') : null;

  // Log events
  await logger?.info('Processing request');
  await logger?.warn('Warning message', { metadata: 'optional' });
  await logger?.error('Error occurred');

  // Pass to utilities
  const organizer = getFileOrganizer();
  await organizer.organize(path, metadata,
    logger ? { jobId, context: 'FileOrganizer' } : undefined
  );
}
```

## Scheduled Job Tracking

**Timer-triggered scheduled jobs** automatically:
- Create Job records in database (via `ensureJobRecord()`)
- Update `lastRun` timestamp in `scheduled_jobs` table
- Generate JobEvent logs with full context
- Display in system logs page

**Manual-triggered jobs** (via "Trigger Now" button):
- Go through `triggerJobNow()` → job queue methods → `addJob()`
- Update `lastRun` timestamp in scheduler service
- Create Job records with full tracking

## Event Handling

```typescript
queue.on('completed', async (job, result) => {
  await updateJobStatus(job.id, 'completed', result);
});

queue.on('failed', async (job, error) => {
  await updateJobStatus(job.id, 'failed', null, error.message);
});

queue.on('stalled', async (job) => {
  await updateJobStatus(job.id, 'stalled');
});
```

## Concurrency Settings

- **search_indexers:** 3 (avoid overwhelming indexers)
- **monitor_download:** 5 (lightweight API calls)
- **organize_files:** 2 (I/O intensive)
- **scan_plex:** 1 (only one scan at a time)
- **match_plex:** 3 (CPU bound)

## Fixed Issues ✅

- ✅ Monitor job logging excessively (~500x/s) → 10s delay
- ✅ No retry for missing torrents → 'awaiting_search' status
- ✅ No retry for failed imports → 'awaiting_import' + max retries
- ✅ MaxListenersExceededWarning → increased maxListeners to 20 on both Redis client and Bull queue
- ✅ Race condition causing "error" status on new downloads → 3s initial delay + retry with exponential backoff
- ✅ Transient failures marking requests as "failed" prematurely → Distinguish transient vs permanent errors, only mark failed after all retries exhausted
- ✅ Plex search error (400) immediately after file organization → Changed workflow: organize_files sets 'downloaded' status, scan_plex job handles matching during scheduled scans
- ✅ System logs page incomplete and missing detailed events → Added JobEvent table, JobLogger utility, comprehensive event logging with timestamps and metadata
- ✅ Scheduled jobs triggered by timer not appearing in system logs → Added ensureJobRecord() to create Job records for timer-triggered scheduled jobs
- ✅ Scheduled jobs triggered by timer not updating lastRun timestamp → ensureJobRecord() now updates lastRun for timer-triggered jobs

## API Endpoints

**GET /api/admin/job-status/:id**
- Get execution status of a specific job by database job ID
- Returns: job status (pending, active, completed, failed, stuck)
- Used by setup wizard to poll job completion
- Requires admin auth

## Tech Stack

- Bull (npm)
- Redis (ioredis)
- PostgreSQL (jobs table for history)
