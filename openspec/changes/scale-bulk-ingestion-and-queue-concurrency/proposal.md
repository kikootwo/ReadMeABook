# Proposal: Scale Bulk Ingestion and Queue Concurrency

## Executive Summary
This proposal ensures that ReadMeABook can gracefully ingest, search, and fulfill high-volume bulk imports of 3,000+ books in a single action without hitting HTTP gateway timeouts, database connection pool exhaustion, or indexer socket rate limits.

## Problem Statement
- **HTTP Gateway Timeouts on Bulk Import:** `POST /api/admin/bulk-import/execute` and Goodreads/Hardcover shelf sync process requests synchronously inside a single HTTP request loop. Importing 3,000 items in a single HTTP call causes 504 Gateway Timeouts and database lock contention.
- **Audnexus API Rate Limit Flooding:** Fetching metadata for 3,000 unknown ASINs synchronously in an HTTP loop triggers HTTP 429 rate limit bans from Audnexus.
- **Backlog Processing Capacity:** Without chunked batching and asynchronous queueing, adding 3,000 requests chokes Next.js HTTP workers.

## Proposed Changes
1. **Async Batch Bulk Import Queue (`bulk_import` Bull Job):**
   - Refactor `POST /api/admin/bulk-import/execute` to accept bulk payloads, immediately enqueue a `bulk_import_batch` job into Redis Bull queue, and return `202 Accepted` with a progress tracking `jobId`.
2. **Chunked Prisma Ingestion (Chunks of 100):**
   - Create `src/lib/processors/bulk-import-batch.processor.ts` to process items in 100-item chunks using Prisma `createMany` with `skipDuplicates: true`.
3. **Audnexus & Prowlarr Rate Limit Ceiling:**
   - Throttle metadata enrichment through Bull queue rate limiter (`max: 10, duration: 1000`) so 3,000 items are smoothly processed over ~5 minutes.
4. **Progress Polling API (`GET /api/admin/bulk-import/status/[jobId]`):**
   - Provide real-time progress percentage (e.g. `45% complete - 1,350 / 3,000 queued`).

## User Impact & Value
- **Scalability to 3,000+ Books:** Admins can import massive library catalogs, CSVs, or author bibliographies in 1 click with zero timeouts or crashes.
- **Graceful Progress Feedback:** Users see live percentage progress updates in the UI.
