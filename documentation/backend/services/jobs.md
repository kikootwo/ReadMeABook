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

**check_watched_lists:** scheduled run (no payload ASIN) checks every watched series and author; a targeted run (payload `userId` + `seriesAsin` or `authorAsin`, queued when a watch is added) runs only that series or author, never the user's other watched lists (#429). See [features/watched-lists.md](../../features/watched-lists.md).

**backfill_requester_tags:** queued only by the ABS settings PUT on a saved off → on change of `audiobookshelf.tag_requester`; attempts 1, at most one waiting or active (`addBackfillRequesterTagsJob`). Tags every eligible available request's ABS item; result counts in the job record. See [features/requester-tags.md](../../features/requester-tags.md).

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
- **Client reports `failed`** (#332, `client-failure.ts`): automatic grab + release fault → block, request `searching`, next automatic search (`clientFailures` + 1, Bull `jobId` `next-release-<historyId>`), at most 3 grabs in a row; hand-picked/ebook grabs and not-the-release's-fault failures → `failed`; an older download never changes the request; a second run of the same failure (Bull rerun after a cut) changes nothing an earlier run did (`already_handled`), but queues the search when the earlier run was cut before it. Its "search already queued" check (`jobs` row or `hasBullJob()`) applies to automatic runs only. **Window left:** two runs at the same moment (stalled-lock rerun while the first still runs) both pass the check; Bull drops the second add, so the only effect is one extra "Trying another release" notification. Requester text carries a short reason, never the client's own text. Rule table: [release-blocklist.md](../../admin-features/release-blocklist.md#next-release-after-a-client-failure-332)
- Every re-queue (progress, save-path wait, connection back-off) carries `clientFailures` when set (`requeueMonitor`)
- qBittorrent finished but still outside its save path: 30 s grace (5 re-checks), then one `warn` and organize from the incomplete folder (#520, [qbittorrent.md](../../phase3/qbittorrent.md#completion--relocation-grace))
- **Cancelled/deleted requests** (`src/lib/utils/request-stop-guard.ts`):
  - Guarded writes are one conditional `updateMany` (`where: { id, deletedAt: null, status: { not: 'cancelled' } }`); 0 rows → leave the request alone. No request id → writes nothing (an unfiltered `updateMany` would hit every row)
  - Guarded sites:
    - `search_indexers`: `searching` claim (0 rows → no search), both `awaiting_search` writes (0 rows → not re-queued for the scheduled re-search jobs) and its `failed` write
    - `download_torrent`: `downloading` claim (0 rows → nothing added to the client) and its permanent-error `failed` write
    - `monitor_download`: each poll first reads the request (cancelled, soft-deleted or missing → stop: no client call, no write, no re-queue); re-checked before queuing `organize_files`; client-failure branch (`searching` or `failed`) and PATH 3 `failed` writes (0 rows → no blocklist entry, no search, no `request_error`)
    - `organize_files`: audiobook and ebook `processing` claim (0 rows → not imported)
    - `job-queue.service.ts` `failed` handlers for `monitor_download` (history `failed` only when the request row was written) and `download_torrent`
    - `download_torrent`: after creating its row, a cancel that landed during the add runs the cancel's download step (no monitor job)
    - `start_direct_download`: `downloading`, `processing` and `failed` writes (0 rows → nothing downloaded / not imported)
  - Not guarded: the other status writes in the download, monitor and organize processors (e.g. organize `failed`/`warn`/`downloaded`), `search_ebook`
  - Cancelling stops the download: RMAB's own partial download is removed, a finished one seeds first ([request-cancel.md](../../admin-features/request-cancel.md)); the monitor never writes over a row recorded `removed`

**search_indexers:**
- No torrents found → 'awaiting_search' status (not failed)
- Allows automatic retry via scheduled job
- Upstream release-date gate: 4 enqueue sites (`request-creator.service`, `retry-missing-torrents.processor`, `monitor-rss-feeds.processor`, `bookdate/swipe/route`) check `shouldSkipAutoSearch` against `indexer.skip_unreleased`; gated requests are created/kept in `awaiting_release` and `addSearchJob` is not called. Manual search bypasses the gate, and so does the next-release search after a client failure (`client-failure.ts`, #332: the book was already grabbed).
- Next-release search (`clientFailures` > 0) that finds nothing usable with every indexer search answered → `failed` "Download failed; no other release found: …" + one `request_error` (not `awaiting_search`). Every grab it queues carries `clientFailures` (`?? 0`). When it throws, or its grab (`download_torrent`) fails, on Bull's last attempt (`isLastAttempt`: the queue passes `attemptsMade` and `opts.attempts` to both processors) → one closing `request_error`.

**organize_files:**
- No audiobook files found → 'awaiting_import' status
- Tracks `import_attempts` (max 5 default)
- After max retries → 'warn' status for manual intervention
- Success → 'downloaded' status (green, waiting for Plex scan)
- Chapter merge progress (#216): saved on `request.progress` at most every 10 s while the merge's ffmpeg runs (0-99), back to 100 before any status write; app init resets `processing` rows below 100 after a restart. See [chapter-merging.md](../../features/chapter-merging.md#merge-progress-216)
- No longer triggers immediate match_plex job

**scan_plex:**
- Full library scan (Plex/Audiobookshelf) and populates plex_library table
- Checks all non-terminal request statuses for matches (excludes: available, cancelled)
- Fuzzy matches via ASIN/ISBN/title/author (70% threshold)
- Matched requests → 'available' status with plexGuid/absItemId linked
- Clears errorMessage and retry counters on match
- Use case: Manual library imports automatically complete stuck requests
- ABS: items without ASIN → ABS match → ASIN from the response stored before request matching (#287, [file-hash-matching.md](../../fixes/file-hash-matching.md#asin-read-back-287))
- Request matching (step 6) is `matchRequestsToLibrary` (`src/lib/services/library/match-requests.ts`), shared with the recently-added check; ABS: stores `plex_library.file_path`, and a `downloaded` request RMAB delivered links to the item holding its folder by path or files hash first (#284); requests go `available` by compare-and-set (one notification per request); then `followLibraryAsins` (ABS) sets `audiobooks.library_asin` from the linked item's current ASIN (#325a; the recently-added check only for books linked to the items it listed); stale removal and the orphan reset clear it with `abs_item_id`. ABS covers are cached as `<hash>-<ASIN>.<ext>` and fetched again under the new name when the item's ASIN changes (`library-cover.ts`)

**plex_recently_added_check:**
- Polls recently added items (top 10) every 5 minutes
- Matches all non-terminal request statuses against new library items
- Same matching logic as scan_plex (ASIN priority, fuzzy fallback)
- Clears error state and retry counters on match
- ABS: same match + ASIN read-back as scan_plex (shared `matchItemsWithoutAsin`), same request matching and #284 link (shared `matchRequestsToLibrary`)

## Job Payloads

All payloads now include `jobId` (database job ID) automatically added by the job queue service.

```typescript
// search_indexers
{jobId: string, requestId: string, audiobook: {id, title, author, asin?}, clientFailures?: number}

// download_torrent (clientFailures: automatic grabs only, #332)
{jobId: string, requestId: string, audiobook: {id, title, author}, torrent, alternateTorrents?, clientFailures?: number}

// monitor_download (clientFailures absent = hand-picked)
{jobId: string, requestId: string, downloadHistoryId: string, downloadClientId: string, downloadClient: DownloadClientType, lastProgress?, stallCount?, pathWaitCount?, connectionFailureCount?, clientFailures?: number}

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

- Every jobs-table write from these handlers goes through `JobActivityTracker.trackWrite` so the shutdown can flush them
- `active` (local event) also gets the handler's promise: `JobActivityTracker.trackActive` counts the job as running in this process until it settles (`src/lib/services/job-activity-tracker.ts`)
- A `failed` event with a null job (removed before the stall check read it) is ignored

## Shutdown and Cut Jobs

- **Stop:** the app shutdown coordinator (see [unified.md](../../deployment/unified.md#shutdown-sequence)) uses `getJobQueueService().shutdownTarget()` (peeked, never created): local pause without waiting → `whenCurrentJobsFinished` until 3.5 s → `close()` only when nothing runs → flush job-row writes → the service's own Redis client disconnects. Jobs still running are logged `left for retry on next start` and rerun from the start after the restart; with jobs left the queue is not closed and Bull's Redis connections end with the process
- **Stopping flag** (`src/lib/utils/process-stopping.ts`, on globalThis): a `JobQueueService` constructed after the signal starts no processors
- **Bull defaults** (no `settings` passed): lockDuration 30 s, stalledInterval 30 s, **maxStalledCount 1**. A job left active by a dead process returns to `wait` 30-60 s after the next start (`stalled` event, row `stuck`) and reruns with `attemptsMade` unchanged. A **second** cut fails it with `job stalled more than allowable limit`, ignoring attempts/backoff
- **Stall-limit failure** (`src/lib/services/job-stall-failure.ts`, only that error, job and `requestId` present, one conditional `updateMany`):
  - `organize_files`, client download, request `processing` → `awaiting_import` (+1 `importAttempts`, `lastImportAt`; `warn` at `maxImportRetries`); `retry_failed_imports` picks it up
  - `organize_files`, manual/bulk import (`!downloadHistoryId && typeof cleanupSource === 'boolean'`), request `processing` → `failed`, "Import from <path> was interrupted when the app stopped. Run the import again."
  - `start_direct_download`, job's `downloadHistoryId` = request's latest `selected` download, request `downloading` → `failed` + that download history row `failed` (never over a row recorded `removed`, same rule as `monitor_download`)
  - Skipped while an `organize_files`/`start_direct_download` job for the same request still runs in this process (event loop blocked past the lock)
- **Not handled:** a cut during source cleanup after the request reached `downloaded` reruns and can report a failure for an imported book (audiobooks heal at the next library scan); a cut chapter merge's `concat_<ts>.txt` and `chapters_<ts>.txt` stay in `/tmp/readmeabook` even after the rerun succeeds (each run uses new timestamped names and removes only its own; a few hundred bytes per cut, in the container layer); `.tmp` tag copies and `.rmab-partial-*` when a job never reruns

## Concurrency Settings

- **Registered with 2:** search_indexers, download_torrent, monitor_download, organize_files, send_notification, search_ebook, start_direct_download, monitor_direct_download
- **Registered with 1:** scan_plex, plex_library_scan, plex_recently_added_check, monitor_rss_feeds, audible_refresh, retry_missing_torrents, retry_failed_imports, find_missing_ebooks, cleanup_seeded_torrents, sync_reading_shelves, check_watched_lists, backfill_requester_tags
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
- ✅ Container stop cut running jobs at once and a job cut twice left its request `processing`/`downloading` forever (#540) → shutdown drain + stall-limit failure handler (see [Shutdown and Cut Jobs](#shutdown-and-cut-jobs))

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
