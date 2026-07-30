# Specification: High-Volume Bulk Ingestion

## ADDED Requirements

### Requirement: Asynchronous Bulk Import Batching
The system MUST handle bulk import requests of up to 5,000 items asynchronously via background Bull queue processing, returning HTTP 202 immediately.

#### Scenario: Async queueing of 3,000 items
- **GIVEN** an admin submitting a bulk import payload of 3,000 items
- **WHEN** `POST /api/admin/bulk-import/execute` is called
- **THEN** the system MUST respond with HTTP 202 Accepted and a tracking `jobId` within 2 seconds.

#### Scenario: Background chunked database insertion
- **GIVEN** a queued `bulk_import_batch` job with 3,000 items
- **WHEN** `bulk-import-batch` processor executes
- **THEN** it MUST insert audiobooks and requests in chunks of 100 with `skipDuplicates: true` and report progress updates.
