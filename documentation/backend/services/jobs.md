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
- Concurrency: set per named processor and summed per queue by Bull, so not a per-type limit (see Concurrency Settings)
- Jobs survive app restarts
- Remove on complete: keep last 100
- Remove on fail: keep last 200
- MaxListeners: 20 on both Redis client and Bull queue (accommodates 12 job processors)

## Job Types

1. **search_indexers** - Search Prowlarr for torrents
2. **monitor_download** - Poll progress (10s intervals)
3. **organize_files** - Move to media library, set status to 'downloaded'
4. **scan_plex** - Full scan of library, match all non-terminal requests (excludes: available, cancelled)
5. **plex_recently_added_check** - Lightweight polling of recently added items, match all non-terminal requests
6. **match_plex** - Fuzzy match to Plex item (deprecated - now handled by scan_plex)

## Download Grab Fallback

- Automatic audiobook search passes every above-threshold release to `download_torrent` in ranked order.
- HTTP `429` and `5xx` responses while fetching a `.torrent`/`.nzb` from Prowlarr are source-grab failures, not download-client failures.
- `download_torrent` immediately tries the next ranked release; the successful candidate is the only one written to download history.
- If every ranked grab is temporarily unavailable, the job remains retryable under Bull's exponential backoff. The global failed handler marks the request failed only after all job attempts are exhausted.
- Manual selections carry no alternates and retain their explicit-release behavior.
- The history row records `addedByRmab` (false when the torrent was already in the client: never removed; [download-clients.md](../../phase3/download-clients.md#torrent-ownership-423)). A Bull retry after an add that succeeded finds RMAB's own torrent and records `false` (kept, a known leak).

## Special Behaviors

**cleanup_seeded_torrents:** pages through every candidate, strict probe, ownership check before any remove; see [scheduler.md](scheduler.md).

**monitor_download:**
- 3s initial delay before first check (avoids race condition with qBittorrent processing)
- Retry logic: 3 attempts with exponential backoff (500ms, 1s, 2s) for getTorrent failures
- Transient error handling: "torrent not found" errors don't mark request as failed during retries
- Request stays in "downloading" status during all retry attempts
- Only marks request as "failed" after all Bull retries (3 attempts) exhausted
- 10s delay between checks (prevents excessive logging)
- Only logs progress at 5% intervals or first 5%
- Auto-reschedules until complete/failed
- **Cancelled/deleted requests** (`src/lib/utils/request-stop-guard.ts`):
  - Guarded writes are one conditional `updateMany` (`where: { id, deletedAt: null, status: { not: 'cancelled' } }`); 0 rows → leave the request alone. No request id → writes nothing (an unfiltered `updateMany` would hit every row)
  - Guarded sites:
    - `search_indexers`: `searching` claim (0 rows → no search), both `awaiting_search` writes (0 rows → not re-queued for the scheduled re-search jobs) and its `failed` write
    - `download_torrent`: `downloading` claim (0 rows → nothing added to the client) and its permanent-error `failed` write
    - `monitor_download`: each poll first reads the request (cancelled, soft-deleted or missing → stop: no client call, no write, no re-queue); re-checked before queuing `organize_files`; client-failure branch and PATH 3 `failed` writes (0 rows → no blocklist entry, no `request_error`)
    - `organize_files`: audiobook and ebook `processing` claim (0 rows → not imported)
    - `job-queue.service.ts` `failed` handlers for `monitor_download` (history `failed` only when the request row was written) and `download_torrent`
  - Not guarded: the other status writes in the download, monitor and organize processors (e.g. organize `failed`/`warn`/`downloaded`), `search_ebook`, direct downloads
  - Cancelling leaves the download in the client (seeded cleanup skips cancelled requests); delete the request to remove it under the seeding rule

**search_indexers:**
- No torrents found → 'awaiting_search' status (not failed)
- Allows automatic retry via scheduled job
- Upstream release-date gate: 4 enqueue sites (`request-creator.service`, `retry-missing-torrents.processor`, `monitor-rss-feeds.processor`, `bookdate/swipe/route`) check `shouldSkipAutoSearch` against `indexer.skip_unreleased`; gated requests are created/kept in `awaiting_release` and `addSearchJob` is not called. Manual search bypasses the gate.

**organize_files:**
- No audiobook files found → 'awaiting_import' status
- Tracks `import_attempts` (max 5 default)
- After max retries → 'warn' status for manual intervention
- Success → 'downloaded' status (green, waiting for Plex scan)
- No longer triggers immediate match_plex job

**scan_plex:**
- Full library scan (Plex/Audiobookshelf) and populates plex_library table
- Checks all non-terminal request statuses for matches (excludes: available, cancelled)
- Fuzzy matches via ASIN/ISBN/title/author (70% threshold)
- Matched requests → 'available' status with plexGuid/absItemId linked
- Clears errorMessage and retry counters on match
- Use case: Manual library imports automatically complete stuck requests
- ABS: items without ASIN → ABS match → ASIN from the response stored before request matching (#287, [file-hash-matching.md](../../fixes/file-hash-matching.md#asin-read-back-287))

**plex_recently_added_check:**
- Polls recently added items (top 10) every 5 minutes
- Matches all non-terminal request statuses against new library items
- Same matching logic as scan_plex (ASIN priority, fuzzy fallback)
- Clears error state and retry counters on match
- ABS: same match + ASIN read-back as scan_plex (shared `matchItemsWithoutAsin`)

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

- **Registered with 2:** search_indexers, download_torrent, monitor_download, organize_files, send_notification, search_ebook, start_direct_download, monitor_direct_download
- **Registered with 1:** scan_plex, plex_library_scan, plex_recently_added_check, monitor_rss_feeds, audible_refresh, retry_missing_torrents, retry_failed_imports, find_missing_ebooks, cleanup_seeded_torrents, sync_reading_shelves, check_watched_lists
- **Not a per-type limit:** Bull 4.16.5 sums the concurrency of every named processor on the queue and any free worker takes any job type, so two jobs of one type can overlap (e.g. two scans; ASIN writes are idempotent per `plexGuid`)

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
