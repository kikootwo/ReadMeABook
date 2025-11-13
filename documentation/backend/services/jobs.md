# Background Job System

## Current State

**Status:** In Development

This service manages the background job queue using Bull (Redis-backed queue) for processing asynchronous tasks like searching indexers, monitoring downloads, organizing files, and scanning Plex library.

## Design Architecture

### Queue System: Bull + Redis

**Why Bull:**
- Redis-backed for persistence
- Built-in retry logic with exponential backoff
- Job prioritization
- Rate limiting and concurrency control
- Events for monitoring job lifecycle
- Supports delayed and scheduled jobs

### Job Types

1. **search_indexers** - Search configured indexers for audiobook torrents
2. **monitor_download** - Check download progress from download client
3. **organize_files** - Move completed downloads to media library
4. **scan_plex** - Trigger Plex library scan
5. **match_plex** - Fuzzy match audiobook to Plex library item

## Implementation Details

### Queue Configuration

```typescript
const queueConfig = {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 200      // Keep last 200 failed jobs
  }
};
```

### Job Priority Levels

- **High (10):** User-initiated actions (new requests)
- **Medium (5):** Monitoring jobs (download progress)
- **Low (1):** Maintenance tasks (old job cleanup)

### Job Processors

Each job type has a dedicated processor function that:
1. Validates job payload
2. Executes the task
3. Updates database records
4. Returns result or throws error for retry

### Retry Strategy

- Automatic retry with exponential backoff (2s, 4s, 8s)
- Maximum 3 attempts by default
- Failed jobs moved to "failed" queue for manual review
- Dead letter queue after max retries exceeded

### Special Job Behaviors

**monitor_download:**
- Runs with a 10-second delay between checks (prevents excessive logging)
- Only logs progress at 5% intervals or first 5%
- Automatically reschedules itself until download completes or fails

**search_indexers:**
- If no torrents found, moves request to 'awaiting_search' status instead of failing
- Allows automatic retry via scheduled job

**organize_files:**
- If no audiobook files found, moves request to 'awaiting_import' status
- Tracks import attempts (max 5 by default)
- After max retries, moves to 'warn' status for manual intervention

## Tech Stack

**Queue:** Bull (npm package)
**Storage:** Redis (ioredis client)
**Persistence:** Jobs table in PostgreSQL for history

## Dependencies

- Redis server running and accessible
- Configuration service for Redis URL
- Database for job history persistence
- All integration services (Plex, indexers, download clients)

## API Contracts

### Queue Service API

```typescript
interface JobQueueService {
  // Add jobs
  addSearchJob(requestId: string, audiobook: Audiobook): Promise<Job>;
  addMonitorJob(requestId: string, downloadHistoryId: string): Promise<Job>;
  addOrganizeJob(requestId: string, downloadPath: string): Promise<Job>;
  addPlexScanJob(libraryId: string): Promise<Job>;
  addPlexMatchJob(requestId: string, audiobookId: string): Promise<Job>;

  // Queue management
  getJob(jobId: string): Promise<Job | null>;
  getJobsByRequest(requestId: string): Promise<Job[]>;
  pauseQueue(queueName: string): Promise<void>;
  resumeQueue(queueName: string): Promise<void>;

  // Job control
  retryJob(jobId: string): Promise<void>;
  cancelJob(jobId: string): Promise<void>;

  // Monitoring
  getQueueStats(): Promise<QueueStats>;
  getActiveJobs(): Promise<Job[]>;
  getFailedJobs(limit?: number): Promise<Job[]>;
}
```

### Job Payloads

**search_indexers:**
```typescript
{
  requestId: string;
  audiobook: {
    id: string;
    title: string;
    author: string;
  };
}
```

**monitor_download:**
```typescript
{
  requestId: string;
  downloadHistoryId: string;
  downloadClientId: string;
  downloadClient: 'qbittorrent' | 'transmission';
}
```

**organize_files:**
```typescript
{
  requestId: string;
  audiobookId: string;
  downloadPath: string;
  targetPath: string;
}
```

**scan_plex:**
```typescript
{
  libraryId: string;
  partial?: boolean;
  path?: string;
}
```

**match_plex:**
```typescript
{
  requestId: string;
  audiobookId: string;
  title: string;
  author: string;
}
```

## Usage Examples

### Adding Jobs

```typescript
import { getJobQueueService } from './services/job-queue.service';

// Add search job when request is created
const jobQueue = getJobQueueService();
await jobQueue.addSearchJob(request.id, audiobook);

// Add monitor job when download starts
await jobQueue.addMonitorJob(request.id, downloadHistory.id);

// Chain jobs: organize → scan → match
await jobQueue.addOrganizeJob(request.id, downloadPath);
```

### Monitoring Jobs

```typescript
// Get all jobs for a request
const jobs = await jobQueue.getJobsByRequest(requestId);

// Check queue health
const stats = await jobQueue.getQueueStats();
console.log('Active jobs:', stats.active);
console.log('Waiting jobs:', stats.waiting);
console.log('Failed jobs:', stats.failed);

// Get failed jobs for admin review
const failedJobs = await jobQueue.getFailedJobs(50);
```

### Retry Failed Jobs

```typescript
// Retry a specific job
await jobQueue.retryJob(jobId);

// Retry all failed jobs for a request
const failedJobs = await jobQueue.getJobsByRequest(requestId);
for (const job of failedJobs.filter(j => j.status === 'failed')) {
  await jobQueue.retryJob(job.id);
}
```

## Event Handling

### Job Events

Bull emits events for job lifecycle:

```typescript
queue.on('completed', async (job, result) => {
  // Update database
  await updateJobStatus(job.id, 'completed', result);
});

queue.on('failed', async (job, error) => {
  // Log failure and update database
  await updateJobStatus(job.id, 'failed', null, error.message);
});

queue.on('stalled', async (job) => {
  // Handle stalled jobs (worker died)
  await updateJobStatus(job.id, 'stalled');
});
```

## Error Handling

### Common Errors

**Redis Connection Failed:**
```typescript
{
  error: 'QueueError',
  message: 'Cannot connect to Redis. Check REDIS_URL configuration.'
}
```

**Job Processing Failed:**
```typescript
{
  error: 'JobProcessingError',
  message: 'Failed to search indexers: Connection timeout',
  jobId: 'uuid',
  attempt: 2,
  maxAttempts: 3
}
```

**Invalid Payload:**
```typescript
{
  error: 'ValidationError',
  message: 'Invalid job payload: missing required field "requestId"'
}
```

## Performance Considerations

### Concurrency Settings

- **search_indexers:** 3 concurrent (avoid overwhelming indexers)
- **monitor_download:** 5 concurrent (lightweight API calls)
- **organize_files:** 2 concurrent (I/O intensive)
- **scan_plex:** 1 concurrent (only one scan at a time)
- **match_plex:** 3 concurrent (CPU bound)

### Rate Limiting

- Indexer searches: Max 10 per minute per indexer
- Download client polls: Max 30 per minute
- Plex API calls: Max 60 per minute

### Resource Management

- Redis memory limit: 256MB for job data
- Job TTL: Completed jobs expire after 7 days
- Failed jobs retained indefinitely for debugging

## Security Considerations

### Access Control

- Only backend services can add jobs
- Admin API can view/retry/cancel jobs
- Users can only see their own request jobs

### Data Sanitization

- Sanitize file paths to prevent path traversal
- Validate all external API responses
- Never log sensitive data (API keys, tokens)

## Testing Strategy

### Unit Tests

- Job payload validation
- Retry logic behavior
- Priority handling
- Event handlers

### Integration Tests

- Full job lifecycle (add → process → complete)
- Redis connection handling
- Database persistence
- Error recovery

### Load Tests

- 100 concurrent job additions
- Queue throughput under load
- Memory usage with 10,000 jobs

## Known Issues

**Fixed Issues:**
- ✅ Monitor download job logging excessively (~500 times/second) - Fixed with 10-second delay
- ✅ No retry mechanism for missing torrents - Fixed with 'awaiting_search' status
- ✅ No retry mechanism for failed imports - Fixed with 'awaiting_import' status and max retries

**Potential Issues:**
- Stalled jobs if worker crashes (need monitoring)
- Redis memory limits with many failed jobs
- Race conditions with multiple workers

## Future Enhancements

- **Job scheduler** - Cron-like scheduling for recurring tasks
- **Job chaining** - Automatic job dependencies
- **Web UI** - Bull Board for queue monitoring
- **Metrics** - Prometheus metrics export
- **Job priorities** - Dynamic priority adjustment based on wait time
- **Multiple queues** - Separate queues for different job types
- **Distributed workers** - Scale workers across multiple servers
