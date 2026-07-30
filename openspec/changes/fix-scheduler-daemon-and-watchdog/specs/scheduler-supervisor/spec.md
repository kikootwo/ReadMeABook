## ADDED Requirements

### Requirement: Automatic Watchdog Scheduler Self-Healing
The system SHALL periodically inspect `scheduled_jobs` table every 5 minutes and automatically re-initialize any enabled job whose `last_run` timestamp is older than 1.5x its cron interval or 30 minutes.

#### Scenario: Stalled Cron Worker Auto-Recovery
- **WHEN** an in-memory cron listener crashes and a job's `last_run` timestamp exceeds 30 minutes
- **THEN** the internal watchdog detects the stalled state, re-subscribes Bull queue repeatable jobs, and executes catch-up processing automatically.

### Requirement: REST API & CLI Control Surface
The system SHALL expose HTTP API endpoints (`POST /api/scheduler/trigger`, `POST /api/scheduler/restart`, `GET /api/scheduler/status`) to inspect, trigger, or restart any scheduled job on demand.

#### Scenario: Manual API Job Triggering
- **WHEN** an administrator sends a `POST /api/scheduler/trigger` request with `{ "type": "retry_missing_torrents" }`
- **THEN** the system immediately enqueues and executes the `retry_missing_torrents` job and returns the Bull job ID.

### Requirement: Paginated Backlog Processing
The system SHALL process `awaiting_search` request retry backlogs in ordered paginated batches sorted by `lastSearchAt ASC NULLS FIRST`.

#### Scenario: Draining Large Request Backlog Without Starvation
- **WHEN** a retry job runs with >300 requests awaiting search
- **THEN** the processor iterates through all pending requests in 50-item batches in order of least recently searched, ensuring 100% backlog coverage.
