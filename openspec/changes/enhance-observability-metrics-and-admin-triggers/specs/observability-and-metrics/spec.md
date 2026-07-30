## ADDED Requirements

### Requirement: Structured JSON Logging with Correlation IDs
The system SHALL format all log output as JSON objects containing `timestamp`, `level`, `component`, `message`, and `correlationId`.

#### Scenario: Logging Background Worker Execution
- **WHEN** a background worker executes a search or file organization job
- **THEN** log messages emit valid JSON strings containing the job's `correlationId` and `requestId`.

### Requirement: Native Prometheus Metrics Endpoint
The system SHALL expose a `GET /api/metrics` endpoint formatted according to Prometheus text exposition standards.

#### Scenario: Scraping Application Health Metrics
- **WHEN** a monitoring system fetches `GET /api/metrics`
- **THEN** the system returns HTTP 200 with queue length gauges, request status breakdown counts, and cron job freshness timestamps.

### Requirement: Web Admin Operations Center & One-Click Maintenance Triggers
The system SHALL provide an Operations & Maintenance dashboard in the Web UI with one-click trigger buttons for all background jobs.

#### Scenario: Manually Triggering Completed Download Scan
- **WHEN** an administrator clicks "Scan Completed Downloads" in the Admin Operations Dashboard
- **THEN** the system sends a `POST /api/scheduler/trigger` request and displays a confirmation toast with the generated job ID.
