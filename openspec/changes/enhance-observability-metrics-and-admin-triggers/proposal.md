# Proposal: Enterprise Observability, Structured Logging, Prometheus Metrics, and Task Triggers

## Why
Currently, ReadMeABook lacks centralized metrics and structured logging. When background tasks or indexer searches fail, administrators must manually execute `docker logs` or query PostgreSQL to diagnose stuck requests or queue bottlenecks. Furthermore, the Web UI lacks buttons and API endpoints to manually trigger specific maintenance tasks (such as retrying backlog, scanning completed folders, or restarting the background scheduler).

## What Changes
1. **Structured JSON Logging & Correlation IDs:** Standardize all application and worker logger calls (`RMABLogger`) to emit structured JSON logs containing `timestamp`, `level`, `component`, `correlationId`, `requestId`, and `durationMs`.
2. **Prometheus / OpenTelemetry Metrics Endpoint:** Expose `GET /api/metrics` returning Prometheus-formatted metrics:
   - Queue gauges: `rmab_bull_queue_jobs{status="waiting|active|completed|failed"}`
   - Request gauges: `rmab_requests_total{status="..."}`
   - Indexer counters: `rmab_indexer_searches_total{indexer="...", result="success|failure"}`
   - Scheduler gauge: `rmab_scheduled_job_last_run_timestamp_seconds{job="..."}`
3. **Web Admin Maintenance & Trigger Center:** Add an "Operations & Maintenance" section in the Admin Dashboard with interactive UI trigger buttons for all background tasks and instant health checks.

## Capabilities

### User Capabilities
- Administrators can view real-time system metrics, queue depths, and indexer response statistics in Prometheus format or Web Admin Dashboard.
- Administrators can trigger any background maintenance job (backlog retry, completed folder scan, library refresh, scheduler restart) with a single click in the UI.

### System Capabilities
- All background log entries contain request correlation IDs for end-to-end tracing across search, download, and file organization stages.
- Observability platforms (Grafana, Datadog, Prometheus) can scrape ReadMeABook metrics via `/api/metrics`.

## Impact & Non-Goals
- **Impact:** Delivers production-grade observability, end-to-end tracing, and full Web UI control over all background tasks.
- **Non-Goals:** Does not require an external APM server to run; `/api/metrics` is exposed natively by ReadMeABook.
