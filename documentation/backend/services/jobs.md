# Background Job System

**Status:** ⏳ In Development

Manages background job queue using Bull (Redis-backed) for async tasks: searching indexers, monitoring downloads, organizing files, scanning Plex.

## Queue System: Bull + Redis

- Redis-backed for persistence
- Retry: 3 attempts, exponential backoff (2s, 4s, 8s)
- Priority: High (10), Medium (5), Low (1)
- Concurrency: 3 per job type
- Jobs survive app restarts
- Remove on complete: keep last 100
- Remove on fail: keep last 200

## Job Types

1. **search_indexers** - Search Prowlarr for torrents
2. **monitor_download** - Poll progress (10s intervals)
3. **organize_files** - Move to media library
4. **scan_plex** - Trigger Plex scan
5. **match_plex** - Fuzzy match to Plex item

## Special Behaviors

**monitor_download:**
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

## Job Payloads

```typescript
// search_indexers
{requestId: string, audiobook: {id, title, author}}

// monitor_download
{requestId: string, downloadHistoryId: string, downloadClientId: string, downloadClient: 'qbittorrent'|'transmission'}

// organize_files
{requestId: string, audiobookId: string, downloadPath: string, targetPath: string}

// scan_plex
{libraryId: string, partial?: boolean, path?: string}

// match_plex
{requestId: string, audiobookId: string, title: string, author: string}
```

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

## Tech Stack

- Bull (npm)
- Redis (ioredis)
- PostgreSQL (jobs table for history)
