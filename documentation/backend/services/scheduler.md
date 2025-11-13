# Recurring Jobs Scheduler

## Current State

**Status:** Implemented ✅

This service manages recurring/scheduled jobs for the ReadMeABook application, providing automated tasks like Plex library scans and Audible data refreshes. It offers both scheduled (cron-like) execution and manual triggering via admin UI.

**Recent Updates:**
- Added configuration validation before job execution (prevents jobs from running with incomplete config)
- Audible refresh now persists data to database instead of just console logging
- Enhanced error handling with clear error messages about missing configuration
- Added schedule editing UI with professional toast notifications
- Jobs validate all required configuration fields before executing

## Design Architecture

### Why a Scheduler Service?

**Requirements:**
- Automated Plex library scans to detect new audiobooks
- Periodic Audible data refresh to cache popular/new releases
- Manual trigger capability for admin users
- Configurable schedules without code changes
- Job history and status tracking

### Architecture: Bull Queue + Cron-like Scheduling

**Why This Approach:**
- Leverages existing Bull queue infrastructure
- Repeatable jobs with cron expressions
- Manual trigger capability alongside scheduled execution
- Job persistence and retry logic built-in
- Admin UI for management

### Scheduled Job Types

1. **plex_library_scan** - Scan Plex library for new audiobooks
   - Default: Every 6 hours
   - Triggers full library refresh
   - Disabled by default (enable after initial setup)

2. **audible_refresh** - Cache Audible popular/new releases
   - Default: Every 24 hours (midnight)
   - Fetches 200 popular audiobooks and 200 new releases from Audible
   - Stores data in database with category flags and rankings
   - Enables database-first approach for homepage (no Audible API hits on page load)
   - Disabled by default (enable after initial setup)

3. **retry_missing_torrents** - Retry searches for requests with no torrents found
   - Default: Every 24 hours (midnight)
   - Re-searches all requests in 'awaiting_search' status
   - Enabled by default
   - Limits to 50 requests per run

4. **retry_failed_imports** - Retry imports for requests with no audiobook files found
   - Default: Every 6 hours
   - Re-attempts file organization for requests in 'awaiting_import' status
   - Enabled by default
   - Limits to 50 requests per run

5. **cleanup_seeded_torrents** - Clean up torrents after seeding requirements are met
   - Default: Every 30 minutes
   - Checks all completed requests for seeding time
   - Uses qBittorrent's actual seeding_time data
   - Only deletes torrents/files after configured seeding time is met
   - Respects seeding_time_minutes configuration (0 = unlimited, never cleanup)
   - Enabled by default

## Implementation Details

### Data Model

```typescript
interface ScheduledJob {
  id: string;
  name: string;
  type: JobType;
  schedule: string; // Cron expression
  enabled: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  payload: any;
}
```

### Cron Expressions

Standard cron syntax:
```
* * * * * *
│ │ │ │ │ │
│ │ │ │ │ └─── day of week (0-7, 0 or 7 is Sunday)
│ │ │ │ └───── month (1-12)
│ │ │ └─────── day of month (1-31)
│ │ └───────── hour (0-23)
│ └─────────── minute (0-59)
└───────────── second (0-59, optional)
```

**Common Patterns:**
- `0 */6 * * *` - Every 6 hours
- `0 0 * * *` - Daily at midnight
- `0 0 */12 * *` - Every 12 hours
- `*/30 * * * *` - Every 30 minutes

## Tech Stack

**Scheduler:** Bull repeatable jobs
**Storage:** PostgreSQL (scheduled_jobs table)
**Queue:** Existing Bull/Redis infrastructure

## Dependencies

- Bull queue service (job-queue.service.ts)
- Plex service for library scans
- Audible service for data refresh
- Configuration service for job settings
- Database for job definitions

## API Contracts

### Scheduler Service API

```typescript
interface SchedulerService {
  // Initialize scheduler
  start(): Promise<void>;

  // Job management
  getScheduledJobs(): Promise<ScheduledJob[]>;
  getScheduledJob(id: string): Promise<ScheduledJob | null>;
  createScheduledJob(job: CreateScheduledJobDto): Promise<ScheduledJob>;
  updateScheduledJob(id: string, updates: UpdateScheduledJobDto): Promise<ScheduledJob>;
  deleteScheduledJob(id: string): Promise<void>;

  // Execution
  triggerJobNow(id: string): Promise<string>; // Returns job ID
  enableJob(id: string): Promise<void>;
  disableJob(id: string): Promise<void>;

  // Status
  getJobHistory(id: string, limit?: number): Promise<JobRun[]>;
}
```

### DTOs

```typescript
interface CreateScheduledJobDto {
  name: string;
  type: JobType;
  schedule: string; // Cron expression
  enabled?: boolean;
  payload?: any;
}

interface UpdateScheduledJobDto {
  name?: string;
  schedule?: string;
  enabled?: boolean;
  payload?: any;
}

interface JobRun {
  id: string;
  scheduledJobId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: 'completed' | 'failed';
  result?: any;
  error?: string;
}
```

## API Endpoints

### GET /api/admin/jobs

**Description:** Get all scheduled jobs

**Auth Required:** Admin only

**Response:**
```json
{
  "jobs": [
    {
      "id": "uuid",
      "name": "Plex Library Scan",
      "type": "plex_library_scan",
      "schedule": "0 */6 * * *",
      "enabled": true,
      "lastRun": "2024-01-15T12:00:00Z",
      "nextRun": "2024-01-15T18:00:00Z"
    }
  ]
}
```

### POST /api/admin/jobs

**Description:** Create a new scheduled job

**Auth Required:** Admin only

**Request:**
```json
{
  "name": "Daily Audible Refresh",
  "type": "audible_refresh",
  "schedule": "0 0 * * *",
  "enabled": true
}
```

**Response:**
```json
{
  "job": {
    "id": "uuid",
    "name": "Daily Audible Refresh",
    "type": "audible_refresh",
    "schedule": "0 0 * * *",
    "enabled": true,
    "lastRun": null,
    "nextRun": "2024-01-16T00:00:00Z"
  }
}
```

### PUT /api/admin/jobs/:id

**Description:** Update scheduled job

**Auth Required:** Admin only

**Request:**
```json
{
  "schedule": "0 */12 * * *",
  "enabled": true
}
```

### DELETE /api/admin/jobs/:id

**Description:** Delete scheduled job

**Auth Required:** Admin only

### POST /api/admin/jobs/:id/trigger

**Description:** Manually trigger job execution

**Auth Required:** Admin only

**Response:**
```json
{
  "success": true,
  "jobId": "bull-job-id",
  "message": "Job triggered successfully"
}
```

### GET /api/admin/jobs/:id/history

**Description:** Get job execution history

**Auth Required:** Admin only

**Query Params:**
- `limit` (number, default: 50) - Max results

**Response:**
```json
{
  "history": [
    {
      "id": "uuid",
      "startedAt": "2024-01-15T12:00:00Z",
      "completedAt": "2024-01-15T12:05:23Z",
      "status": "completed",
      "result": {
        "scannedItems": 145,
        "newItems": 3
      }
    }
  ]
}
```

## Usage Examples

### Initialize Scheduler

```typescript
import { getSchedulerService } from './services/scheduler.service';

// Start scheduler on app startup
const scheduler = getSchedulerService();
await scheduler.start();
```

### Create Scheduled Job

```typescript
const job = await scheduler.createScheduledJob({
  name: 'Plex Library Scan',
  type: 'plex_library_scan',
  schedule: '0 */6 * * *', // Every 6 hours
  enabled: true,
  payload: {
    libraryId: '2',
  },
});
```

### Manually Trigger Job

```typescript
const jobId = await scheduler.triggerJobNow(scheduledJobId);
console.log(`Job ${jobId} triggered manually`);
```

### Update Job Schedule

```typescript
await scheduler.updateScheduledJob(jobId, {
  schedule: '0 */12 * * *', // Change to every 12 hours
});
```

## Job Processors

### Plex Library Scan Processor

```typescript
async function processPlexLibraryScan(payload: ScanPlexPayload) {
  const plexService = getPlexService();
  const configService = getConfigService();

  const libraryId = payload.libraryId ||
    await configService.get('plex_audiobook_library_id');

  await plexService.scanLibrary(serverUrl, authToken, libraryId);

  return {
    scannedAt: new Date(),
    libraryId,
  };
}
```

### Audible Refresh Processor

**Updated Implementation:** Fetches 200 items per category and stores with ranking

```typescript
async function processAudibleRefresh() {
  const audibleService = getAudibleService();

  // Clear previous popular/new-release flags
  await prisma.audiobook.updateMany({
    where: { OR: [{ isPopular: true }, { isNewRelease: true }] },
    data: {
      isPopular: false,
      isNewRelease: false,
      popularRank: null,
      newReleaseRank: null
    },
  });

  // Fetch 200 popular audiobooks and 200 new releases
  const popular = await audibleService.getPopularAudiobooks(200);
  const newReleases = await audibleService.getNewReleases(200);

  const syncTime = new Date();

  // Store popular audiobooks with ranking
  for (let i = 0; i < popular.length; i++) {
    await prisma.audiobook.upsert({
      where: { audibleId: audiobook.asin },
      create: {
        // ... full metadata ...
        isPopular: true,
        popularRank: i + 1,
        lastAudibleSync: syncTime,
      },
      update: {
        // ... metadata updates ...
        isPopular: true,
        popularRank: i + 1,
        lastAudibleSync: syncTime,
      },
    });
  }

  // Store new releases with ranking (same pattern)
  // ...

  return {
    popularCount: popular.length,
    newReleasesCount: newReleases.length,
    cachedAt: syncTime,
  };
}
```

**Key Features:**
- Clears previous category flags before refresh for clean slate
- Fetches 200 items per category (increased from 50) via multi-page scraping
- Stores rank position from Audible for proper ordering
- Records sync timestamp for freshness tracking
- Performs fuzzy matching (70% threshold) against Plex library
- Stores `plexGuid` when match is found (with duplicate checking)
- Updates `availabilityStatus` to 'available' or 'unknown' based on current Plex library state
- Prevents multiple Audible books from claiming the same `plexGuid` (unique constraint protection)
- This enables "In Your Library" badges on homepage without additional API calls

**Duplicate PlexGuid Handling:**
Since `plexGuid` has a UNIQUE constraint (one Plex item = one database record), when multiple Audible books match the same Plex audiobook (e.g., different editions, series books), only the first match gets the `plexGuid` assigned. Subsequent matches are skipped to prevent constraint violations.

## Error Handling

### Common Errors

**Invalid Cron Expression:**
```json
{
  "error": "ValidationError",
  "message": "Invalid cron expression: '* * * *'"
}
```

**Job Not Found:**
```json
{
  "error": "NotFoundError",
  "message": "Scheduled job not found"
}
```

**Job Execution Failed:**
```json
{
  "error": "JobExecutionError",
  "message": "Plex library scan failed: Connection timeout"
}
```

## Security Considerations

### Access Control

- Only admins can view, create, update, or delete scheduled jobs
- Job triggers logged with admin user ID
- Validate cron expressions to prevent abuse

### Resource Management

- Limit concurrent job executions
- Prevent overlapping executions of same job
- Rate limit manual triggers (max 1 per minute per job)

## Performance Considerations

### Optimization Strategies

- Cache Audible data in database, not memory
- Limit Plex scan to specific paths when possible
- Use job priorities to ensure critical tasks run first
- Implement job timeouts to prevent hanging

### Resource Limits

- Max 10 scheduled jobs per system
- Job execution timeout: 15 minutes
- Max history entries per job: 100 (auto-cleanup)

## Testing Strategy

### Unit Tests

- Cron expression parsing
- Job scheduling logic
- Enable/disable functionality
- Manual trigger flow

### Integration Tests

- Full job lifecycle (schedule → execute → complete)
- Multiple jobs running concurrently
- Job failure and retry logic
- Manual trigger interrupting scheduled execution

## Known Issues

**Fixed Issues:**
- ✅ Jobs running without configuration validation (Fixed: added validation before execution)
- ✅ Default alert() popups for job triggers (Fixed: replaced with toast notifications)
- ✅ No UI for editing schedules (Fixed: added edit modal)
- ✅ Audible data not persisting (Fixed: now saves to database)
- ✅ Download progress logging ~500 times/second (Fixed: added 10-second delay and reduced log frequency)
- ✅ Requests failing permanently when no torrents found (Fixed: added retry system with 'awaiting_search' status)
- ✅ Requests failing permanently when no files found (Fixed: added retry system with max 5 retries and 'warn' status)
- ✅ Failed requests blocking re-requests (Fixed: allow re-requesting failed/warn/cancelled requests)
- ✅ Files deleted immediately preventing seeding (Fixed: files kept until seeding requirements met)
- ✅ No seeding time configuration (Fixed: added seeding_time_minutes configuration)

**Current Issues:**
*None currently.*

## Future Enhancements

- **Multiple schedules per job** - Allow jobs to run on multiple schedules
- **Job dependencies** - Run job B after job A completes
- **Conditional execution** - Run jobs based on system state
- **Notification integration** - Alert on job failures
- **Job templates** - Pre-configured job definitions
- **Advanced scheduling** - "First Monday of month" patterns
- **Job chaining** - Auto-trigger related jobs on completion
