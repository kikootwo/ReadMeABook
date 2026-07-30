# Design: Scale Bulk Ingestion and Queue Concurrency

## Architecture Overview

```mermaid
sequenceDiagram
    participant User as Admin UI
    participant API as POST /api/admin/bulk-import/execute
    participant Queue as Redis Bull Queue
    participant Worker as BulkImportBatch Worker
    participant DB as PostgreSQL

    User->>API: Submit 3,000 items
    API->>Queue: Add bulk_import_batch job
    API-->>User: 202 Accepted (jobId)
    loop Background Chunk Processing (Chunks of 100)
        Worker->>DB: prisma.audiobook.createMany(skipDuplicates)
        Worker->>DB: prisma.request.createMany(skipDuplicates)
        Worker->>Queue: Enqueue search_indexers jobs (Rate-limited 10/s)
    end
    User->>API: GET /api/admin/bulk-import/status/[jobId]
    API-->>User: 100% Complete
```

## Component Specification

### 1. `POST /api/admin/bulk-import/execute`
- Receives array of up to 5,000 items.
- Validates path safety roots.
- Returns `{ success: true, jobId, totalItems: 3000 }` with HTTP status 202.

### 2. `bulk-import-batch.processor.ts`
- Processes items in chunks of 100 using Prisma batch operations.
- Calls `jobQueue.addSearchJob` for each created request.
