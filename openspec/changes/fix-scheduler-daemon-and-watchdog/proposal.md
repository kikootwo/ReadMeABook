# Proposal: Resilient Scheduler Daemon, In-Container Watchdog, and API Control Surface

## Why
In the current Next.js architecture, `SchedulerService.start()` runs in-memory inside the web application process, initialized only once during container boot (`/api/init`). When Next.js worker threads encounter unhandled promise rejections, network timeouts (such as Prowlarr 60s timeouts), or memory pressure, the background Bull/Redis cron timer listeners crash silently. While Next.js continues serving HTTP pages and returning `200 OK` on `/api/health`, all 10 scheduled jobs (`retry_missing_torrents`, `monitor_rss_feeds`, `recently_added_check`, `library_scan`, `retry_failed_imports`) stall indefinitely.

During production operations, this caused scheduled job execution to freeze for 9+ hours until external intervention manually pinged `/api/init`.

## What Changes
1. **Decoupled Worker/Scheduler Supervisor:** Decouple scheduled job processing and Bull queue workers into a dedicated, self-healing background supervisor process or persistent worker loop.
2. **Self-Healing Internal Watchdog:** Implement an internal health supervisor that periodically checks `scheduled_jobs.last_run` timestamps in PostgreSQL. If any enabled scheduled job is detected as stalled (>1.5x its cron interval or >30 minutes), the supervisor automatically re-subscribes queue listeners and re-executes overdue jobs without requiring external triggers.
3. **API & CLI Control Surface:** Expose REST endpoints (`POST /api/scheduler/trigger`, `POST /api/scheduler/restart`, `GET /api/scheduler/health`) and CLI commands so every scheduled job can be independently triggered, paused, resumed, or inspected.
4. **Ordered & Paginated Retry Processor:** Update `retry-missing-torrents.processor.ts` to query pending requests in ordered batches (`orderBy: { lastSearchAt: 'asc' }`) so backlog items are never starved.

## Capabilities

### User Capabilities
- Administrators can view live cron scheduler status, last run timestamps, and next scheduled run times in the web UI.
- Administrators can trigger any scheduled job immediately via web UI button or REST API call.
- Administrators can restart or re-initialize the background scheduler runtime on demand.

### System Capabilities
- The system automatically detects stalled cron timers within 10 minutes and self-heals without downtime or manual intervention.
- Scheduled job execution status and errors are persisted in PostgreSQL with correlation IDs for full auditability.

## Impact & Non-Goals
- **Impact:** Eliminates silent cron scheduler freezing, guarantees 100% backlog request retry coverage, and makes all background jobs API-triggerable.
- **Non-Goals:** Does not replace Redis or Bull queue with a different queue engine; leverages existing Bull/Redis infrastructure with improved supervisor lifecycle management.
