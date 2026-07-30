# Tasks: Scale Bulk Ingestion and Queue Concurrency

- [ ] 1. Create `src/lib/processors/bulk-import-batch.processor.ts` for chunked background ingestion <!-- id: task-1-bulk-batch-processor -->
- [ ] 2. Update `src/app/api/admin/bulk-import/execute/route.ts` to return HTTP 202 and delegate to Bull queue for >50 items <!-- id: task-2-async-bulk-execute-api -->
- [ ] 3. Create unit test suite `tests/processors/bulk-import-batch.processor.test.ts` <!-- id: task-3-bulk-batch-unit-test -->
