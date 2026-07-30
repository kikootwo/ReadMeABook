# Design: Resilient Scheduler Daemon, In-Container Watchdog, and API Control Surface

## Architectural Overview

```
 ┌─────────────────────────────────────────────────────────┐
 │                   Next.js Web Server                    │
 │  ┌─────────────────┐ ┌────────────────┐ ┌─────────────┐ │
 │  │ /api/scheduler  │ │ /api/requests  │ │ Web Admin   │ │
 │  │ Control API     │ │ API            │ │ UI          │ │
 │  └────────┬────────┘ └────────────────┘ └─────────────┘ │
 └───────────┼─────────────────────────────────────────────┘
             │
 ┌───────────▼─────────────────────────────────────────────┐
 │            Background Scheduler Supervisor              │
 │  ┌───────────────────┐       ┌──────────────────────┐   │
 │  │ Internal Watchdog │ ◄───► │ ScheduledJob Registry│   │
 │  │ (stale check 5m)  │       │ (PostgreSQL)         │   │
 │  └────────┬──────────┘       └──────────┬───────────┘   │
 └───────────┼─────────────────────────────┼───────────────┘
             │                             │
 ┌───────────▼─────────────────────────────▼───────────────┐
 │                  Bull Queue / Redis                     │
 │  ┌───────────────────────────────────────────────────┐  │
 │  │ Repeatable Jobs Queue (Audiobook & Ebook workers) │  │
 │  └───────────────────────────────────────────────────┘  │
 └─────────────────────────────────────────────────────────┘
```

## Detailed Component Specifications

### 1. Scheduler Supervisor & Self-Healing Watchdog (`src/lib/services/scheduler.service.ts`)
- **Heartbeat & Stalled Detection:** Every 5 minutes, an internal interval checks `scheduled_jobs` table. A job is classified as **stalled** if `enabled = true` and `NOW() - last_run > max(cron_interval * 1.5, 30 minutes)`.
- **Automatic Recovery Loop:** If any job is stalled, `SchedulerService.recoverStalledJobs()` re-creates repeatable jobs in Bull queue and triggers immediate catch-up execution.
- **Process Lifecycle Guard:** Unhandled promise rejections or error events in background job processors will log the exception with correlation ID and reset the specific job handler without terminating the global scheduler loop.

### 2. REST API Control Surface (`src/app/api/scheduler/...`)
- `GET /api/scheduler/status`: Returns current status of all 10 scheduled jobs, `last_run` timestamps, `next_run` projections, and watchdog health status.
- `POST /api/scheduler/trigger`: Accepts `{ type: ScheduledJobType }` to trigger immediate execution of any scheduled job.
- `POST /api/scheduler/restart`: Re-initializes `SchedulerService` instance and re-subscribes all Bull queue repeatable job listeners.

### 3. Paginated Retry Processor (`src/lib/processors/retry-missing-torrents.processor.ts`)
- Replaces un-ordered `take: 50` query with deterministic chunking:
  ```typescript
  const BATCH_SIZE = 50;
  const requests = await prisma.request.findMany({
    where: { status: 'awaiting_search', deletedAt: null },
    orderBy: { lastSearchAt: 'asc' },
    take: BATCH_SIZE
  });
  ```
- Continuously processes batches until `awaiting_search` backlog is drained or configured rate limits are reached.

## Verification & Test Plan
1. **Watchdog Test:** Simulate a crash of Bull repeatable job listener by flushing Redis keys. Verify watchdog detects stalled status within 5 minutes and automatically reschedules jobs.
2. **API Control Test:** Call `POST /api/scheduler/trigger` for `retry_missing_torrents`. Verify job ID is returned and job executes synchronously/asynchronously.
3. **Paginated Backlog Test:** Seed database with 200 requests. Verify processor iterates through all 200 items in ordered 50-item batches without skipping older requests.
