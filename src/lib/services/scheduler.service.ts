/**
 * Component: Recurring Jobs Scheduler Service
 * Documentation: documentation/backend/services/scheduler.md
 */

import { getJobQueueService, ScanPlexPayload } from './job-queue.service';
import { getNotificationService } from './notification';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';

const logger = RMABLogger.create('Scheduler');

// Legacy literal `name` values that older installs may still have in the DB.
// Each entry maps an exact stale literal to its current neutral default,
// type-gated so partial-matches to the word "Plex" can never be touched.
const STALE_NAME_REWRITES: ReadonlyArray<{
  type: string;
  staleName: string;
  neutralName: string;
}> = [
  { type: 'plex_library_scan', staleName: 'Plex Library Scan', neutralName: 'Library Scan' },
  { type: 'plex_recently_added_check', staleName: 'Plex Recently Added Check', neutralName: 'Recently Added Check' },
];

// Existing installs created these jobs on the old colliding `0 0 * * *` default,
// so they all fire at midnight and can freeze the single event loop (→ mass Bull
// "stalled" failures). Re-stagger them off midnight. Type-gated AND exact-schedule-
// gated: only rewrites a row still on the exact old default, so an admin who
// deliberately customized the time is never overridden. `audible_refresh` stays at
// midnight (heaviest, runs alone).
const LEGACY_MIDNIGHT_RESCHEDULES: ReadonlyArray<{
  type: string;
  from: string;
  to: string;
}> = [
  { type: 'check_watched_lists', from: '0 0 * * *', to: '0 1 * * *' },
  { type: 'retry_missing_torrents', from: '0 0 * * *', to: '0 2 * * *' },
  { type: 'find_missing_ebooks', from: '0 0 * * *', to: '0 3 * * *' },
];

export type ScheduledJobType = 'plex_library_scan' | 'plex_recently_added_check' | 'audible_refresh' | 'retry_missing_torrents' | 'retry_failed_imports' | 'find_missing_ebooks' | 'retry_unavailable_ebooks' | 'cleanup_seeded_torrents' | 'monitor_rss_feeds' | 'sync_reading_shelves' | 'check_watched_lists';

export interface ScheduledJob {
  id: string;
  name: string;
  type: string; // Changed from ScheduledJobType to string for Prisma compatibility
  schedule: string; // Cron expression
  enabled: boolean;
  payload: any;
  createdAt: Date;
  updatedAt: Date;
  lastRun: Date | null;
  lastRunJobId: string | null; // Bull queue job ID of most recent execution
  nextRun: Date | null;
}

export interface CreateScheduledJobDto {
  name: string;
  type: ScheduledJobType;
  schedule: string;
  enabled?: boolean;
  payload?: any;
}

export interface UpdateScheduledJobDto {
  name?: string;
  schedule?: string;
  enabled?: boolean;
  payload?: any;
}

export class SchedulerService {
  private jobQueue = getJobQueueService();

  /**
   * Initialize scheduler and set up default jobs if they don't exist
   */
  async start(): Promise<void> {
    logger.info('Initializing scheduler service...');

    // Re-encrypt any notification backends with plaintext sensitive fields
    try {
      await getNotificationService().reEncryptUnprotectedBackends();
    } catch (error) {
      logger.error('Failed to re-encrypt notification backends (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Clean up deprecated scheduled jobs
    await this.cleanupDeprecatedJobs();

    // Rewrite legacy literal names (e.g. "Plex Library Scan") to current neutral defaults
    await this.renameStaleJobNames();

    // Create default jobs if they don't exist
    await this.ensureDefaultJobs();

    // Re-stagger existing installs still on the legacy `0 0 * * *` default
    // (must run before scheduleAllJobs so the new times take effect this startup)
    await this.migrateLegacyMidnightSchedules();

    // Load and schedule all enabled jobs (works with whatever jobs exist in DB)
    await this.scheduleAllJobs();

    // Check and trigger overdue jobs
    await this.triggerOverdueJobs();

    logger.info('Scheduler service started');
  }

  /**
   * Ensure default jobs exist in database.
   * Each job is created independently so a single failure doesn't block the rest.
   */
  private async ensureDefaultJobs(): Promise<void> {
    const defaults = [
      {
        name: 'Library Scan',
        type: 'plex_library_scan' as ScheduledJobType,
        schedule: '0 */6 * * *', // Every 6 hours
        enabled: false, // Start disabled until first setup is complete
        payload: {},
      },
      {
        name: 'Recently Added Check',
        type: 'plex_recently_added_check' as ScheduledJobType,
        schedule: '*/5 * * * *', // Every 5 minutes
        enabled: true, // Enable by default for quick detection
        payload: {},
      },
      {
        name: 'Audible Data Refresh',
        type: 'audible_refresh' as ScheduledJobType,
        schedule: '0 0 * * *', // Daily at midnight
        enabled: false, // Start disabled until first setup is complete
        payload: {},
      },
      {
        name: 'Retry Missing Torrents Search',
        type: 'retry_missing_torrents' as ScheduledJobType,
        schedule: '0 2 * * *', // Daily at 02:00 — staggered off midnight to avoid event-loop freeze from concurrent heavy jobs
        enabled: true, // Enable by default
        payload: {},
      },
      {
        name: 'Retry Failed Imports',
        type: 'retry_failed_imports' as ScheduledJobType,
        schedule: '0 */6 * * *', // Every 6 hours
        enabled: true, // Enable by default
        payload: {},
      },
      {
        name: 'Find Missing Ebooks',
        type: 'find_missing_ebooks' as ScheduledJobType,
        schedule: '0 3 * * *', // Daily at 03:00 — staggered off midnight so the ebook-search burst doesn't pile onto audible_refresh/retry
        enabled: true, // Enable by default; gated by ebook_auto_grab_enabled + source-enablement at run time
        payload: {},
      },
      {
        name: 'Retry Unavailable Ebooks',
        type: 'retry_unavailable_ebooks' as ScheduledJobType,
        schedule: '0 4 * * 0', // Weekly Sunday at 04:00
        enabled: true, // Enable by default; only processes type='ebook' requests
        payload: {},
      },
      {
        name: 'Cleanup Seeded Torrents',
        type: 'cleanup_seeded_torrents' as ScheduledJobType,
        schedule: '*/30 * * * *', // Every 30 minutes
        enabled: true, // Enable by default
        payload: {},
      },
      {
        name: 'Monitor RSS Feeds',
        type: 'monitor_rss_feeds' as ScheduledJobType,
        schedule: '*/15 * * * *', // Every 15 minutes
        enabled: true, // Enable by default
        payload: {},
      },
      {
        name: 'Sync Reading Shelves',
        type: 'sync_reading_shelves' as ScheduledJobType,
        schedule: '0 */6 * * *', // Every 6 hours
        enabled: true, // Enable by default
        payload: {},
      },
      {
        name: 'Check Watched Lists',
        type: 'check_watched_lists' as ScheduledJobType,
        schedule: '0 1 * * *', // Daily at 01:00 — staggered off midnight to avoid event-loop freeze from concurrent heavy jobs
        enabled: true, // Enable by default
        payload: {},
      },
    ];

    let created = 0;
    let failed = 0;

    for (const defaultJob of defaults) {
      try {
        const existing = await prisma.scheduledJob.findFirst({
          where: { type: defaultJob.type },
        });

        if (!existing) {
          await prisma.scheduledJob.create({
            data: defaultJob,
          });
          created++;
          logger.info(`Created default job: ${defaultJob.name} (enabled: ${defaultJob.enabled})`);
        }
      } catch (error) {
        failed++;
        logger.error(`Failed to create default job: ${defaultJob.name}`, {
          type: defaultJob.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failed > 0) {
      logger.warn(`Default jobs: ${created} created, ${failed} failed — failed jobs will be retried on next restart`);
    } else if (created > 0) {
      logger.info(`Default jobs: ${created} created`);
    }
  }

  /**
   * Rewrite legacy literal `name` values to their current neutral defaults.
   * Type-gated on BOTH `name` and `type` exact-equals — admin-customized names
   * that happen to contain "Plex" are never touched.
   */
  private async renameStaleJobNames(): Promise<void> {
    try {
      for (const entry of STALE_NAME_REWRITES) {
        const result = await prisma.scheduledJob.updateMany({
          where: { name: entry.staleName, type: entry.type },
          data: { name: entry.neutralName },
        });
        if (result.count > 0) {
          logger.info(`Renamed scheduled job: "${entry.staleName}" → "${entry.neutralName}" (${result.count} row${result.count === 1 ? '' : 's'})`);
        }
      }
    } catch (error) {
      logger.error('Failed to rename stale scheduled job names', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Re-stagger jobs still on the legacy `0 0 * * *` default so they don't all
   * fire at midnight and freeze the event loop. Type-gated AND exact-schedule-
   * gated via the updateMany `where` — a customized schedule is never touched.
   */
  private async migrateLegacyMidnightSchedules(): Promise<void> {
    try {
      for (const entry of LEGACY_MIDNIGHT_RESCHEDULES) {
        const result = await prisma.scheduledJob.updateMany({
          where: { type: entry.type, schedule: entry.from },
          data: { schedule: entry.to },
        });
        if (result.count > 0) {
          logger.info(`Re-staggered ${entry.type}: ${entry.from} → ${entry.to} (${result.count} row${result.count === 1 ? '' : 's'})`);
        }
      }
    } catch (error) {
      logger.error('Failed to migrate legacy midnight schedules', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Remove any old jobs that are no longer supported
   */
  private async cleanupDeprecatedJobs(): Promise<void> {
    try {
      const deprecatedTypes = ['sync_goodreads_shelves'];

      const obsoleteJobs = await prisma.scheduledJob.findMany({
        where: { type: { in: deprecatedTypes } },
      });

      for (const job of obsoleteJobs) {
        if (job.enabled) {
          await this.unscheduleJob(job);
        }
        await prisma.scheduledJob.delete({ where: { id: job.id } });
        logger.info(`Removed deprecated scheduled job: ${job.name} (${job.type})`);
      }
    } catch (error) {
      logger.error('Failed to cleanup deprecated scheduled jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Schedule all enabled jobs
   */
  private async scheduleAllJobs(): Promise<void> {
    const jobs = await prisma.scheduledJob.findMany({
      where: { enabled: true },
    });

    for (const job of jobs) {
      await this.scheduleJob(job);
    }

    logger.info(`Scheduled ${jobs.length} jobs`);
  }

  /**
   * Schedule a single job using Bull's repeatable jobs
   */
  private async scheduleJob(job: any): Promise<void> {
    try {
      await this.jobQueue.addRepeatableJob(
        job.type,
        { scheduledJobId: job.id },
        job.schedule,
        `scheduled-${job.id}`
      );
      logger.info(`Job scheduled: ${job.name} (${job.schedule})`);
    } catch (error) {
      logger.error(`Failed to schedule job ${job.name}`, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Unschedule a job by removing it from Bull's repeatable jobs
   */
  private async unscheduleJob(job: any): Promise<void> {
    try {
      await this.jobQueue.removeRepeatableJob(
        job.type,
        job.schedule,
        `scheduled-${job.id}`
      );
      logger.info(`Job unscheduled: ${job.name}`);
    } catch (error) {
      logger.error(`Failed to unschedule job ${job.name}`, { error: error instanceof Error ? error.message : String(error) });
      // Don't throw - job might not exist in Bull yet
    }
  }

  /**
   * Get all scheduled jobs
   */
  async getScheduledJobs(): Promise<ScheduledJob[]> {
    return await prisma.scheduledJob.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get single scheduled job by ID
   */
  async getScheduledJob(id: string): Promise<ScheduledJob | null> {
    return await prisma.scheduledJob.findUnique({
      where: { id },
    });
  }

  /**
   * Create new scheduled job
   */
  async createScheduledJob(dto: CreateScheduledJobDto): Promise<ScheduledJob> {
    // Validate cron expression
    this.validateCronExpression(dto.schedule);

    const job = await prisma.scheduledJob.create({
      data: {
        name: dto.name,
        type: dto.type,
        schedule: dto.schedule,
        enabled: dto.enabled ?? true,
        payload: dto.payload || {},
      },
    });

    if (job.enabled) {
      await this.scheduleJob(job);
    }

    return job;
  }

  /**
   * Update scheduled job
   */
  async updateScheduledJob(
    id: string,
    dto: UpdateScheduledJobDto
  ): Promise<ScheduledJob> {
    if (dto.schedule) {
      this.validateCronExpression(dto.schedule);
    }

    // Get the old job to unschedule it
    const oldJob = await prisma.scheduledJob.findUnique({
      where: { id },
    });

    if (oldJob && oldJob.enabled) {
      await this.unscheduleJob(oldJob);
    }

    const job = await prisma.scheduledJob.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.schedule && { schedule: dto.schedule }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.payload && { payload: dto.payload }),
        updatedAt: new Date(),
      },
    });

    // Reschedule if enabled
    if (job.enabled) {
      await this.scheduleJob(job);
    }

    return job;
  }

  /**
   * Delete scheduled job
   */
  async deleteScheduledJob(id: string): Promise<void> {
    const job = await prisma.scheduledJob.findUnique({
      where: { id },
    });

    if (job && job.enabled) {
      await this.unscheduleJob(job);
    }

    await prisma.scheduledJob.delete({
      where: { id },
    });
  }

  /**
   * Manually trigger a job to run immediately
   */
  async triggerJobNow(id: string): Promise<string> {
    const job = await this.getScheduledJob(id);

    if (!job) {
      throw new Error('Scheduled job not found');
    }

    // Trigger the appropriate job type
    let bullJobId: string;

    switch (job.type) {
      case 'plex_library_scan':
        bullJobId = await this.triggerPlexScan(job);
        break;
      case 'plex_recently_added_check':
        bullJobId = await this.triggerPlexRecentlyAddedCheck(job);
        break;
      case 'audible_refresh':
        bullJobId = await this.triggerAudibleRefresh(job);
        break;
      case 'retry_missing_torrents':
        bullJobId = await this.triggerRetryMissingTorrents(job);
        break;
      case 'retry_failed_imports':
        bullJobId = await this.triggerRetryFailedImports(job);
        break;
      case 'find_missing_ebooks':
        bullJobId = await this.triggerFindMissingEbooks(job);
        break;
      case 'cleanup_seeded_torrents':
        bullJobId = await this.triggerCleanupSeededTorrents(job);
        break;
      case 'monitor_rss_feeds':
        bullJobId = await this.triggerMonitorRssFeeds(job);
        break;
      case 'sync_reading_shelves':
        bullJobId = await this.triggerSyncShelves(job);
        break;
      case 'check_watched_lists':
        bullJobId = await this.triggerCheckWatchedLists(job);
        break;
      case 'retry_unavailable_ebooks':
        bullJobId = await this.triggerRetryUnavailableEbooks(job);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    // Update last run time and store Bull job ID
    await prisma.scheduledJob.update({
      where: { id },
      data: {
        lastRun: new Date(),
        lastRunJobId: bullJobId,
      },
    });

    logger.info(`Job "${job.name}" triggered with Bull job ID: ${bullJobId}`);

    return bullJobId;
  }

  /**
   * Trigger library scan (Plex or Audiobookshelf based on backend mode)
   */
  private async triggerPlexScan(job: any): Promise<string> {
    const { getConfigService } = await import('./config.service');
    const configService = getConfigService();

    // Check backend mode
    const backendMode = await configService.getBackendMode();

    // Validate configuration based on backend mode
    let libraryId: string | null = null;
    const missingFields: string[] = [];

    if (backendMode === 'audiobookshelf') {
      const absConfig = await configService.getMany([
        'audiobookshelf.server_url',
        'audiobookshelf.api_token',
        'audiobookshelf.library_id',
      ]);

      if (!absConfig['audiobookshelf.server_url']) {
        missingFields.push('Audiobookshelf server URL');
      }
      if (!absConfig['audiobookshelf.api_token']) {
        missingFields.push('Audiobookshelf API token');
      }
      if (!absConfig['audiobookshelf.library_id']) {
        missingFields.push('Audiobookshelf library ID');
      }

      if (missingFields.length > 0) {
        const errorMsg = `Audiobookshelf is not configured. Missing: ${missingFields.join(', ')}. Please configure Audiobookshelf in the admin settings before running library scans.`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      libraryId = job.payload?.libraryId || absConfig['audiobookshelf.library_id'];
    } else {
      const plexConfig = await configService.getMany([
        'plex_url',
        'plex_token',
        'plex_audiobook_library_id',
      ]);

      if (!plexConfig.plex_url) {
        missingFields.push('Plex server URL');
      }
      if (!plexConfig.plex_token) {
        missingFields.push('Plex auth token');
      }
      if (!plexConfig.plex_audiobook_library_id) {
        missingFields.push('Plex audiobook library ID');
      }

      if (missingFields.length > 0) {
        const errorMsg = `Plex is not configured. Missing: ${missingFields.join(', ')}. Please configure Plex in the admin settings before running library scans.`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      libraryId = job.payload?.libraryId || plexConfig.plex_audiobook_library_id;
    }

    logger.info(`Triggering ${backendMode} library scan for library: ${libraryId}`);

    return await this.jobQueue.addPlexScanJob(
      libraryId || '',
      job.payload?.partial,
      job.payload?.path
    );
  }

  /**
   * Trigger Plex recently added check (lightweight polling)
   */
  private async triggerPlexRecentlyAddedCheck(job: any): Promise<string> {
    return await this.jobQueue.addPlexRecentlyAddedJob(job.id);
  }

  /**
   * Trigger Audible data refresh
   * Populates audible_cache table with popular/new-release audiobooks
   * Caches cover thumbnails locally
   * NO matching logic - that happens at query time
   */
  private async triggerAudibleRefresh(job: any): Promise<string> {
    return await this.jobQueue.addAudibleRefreshJob(job.id);
  }


  /**
   * Enable a scheduled job
   */
  async enableJob(id: string): Promise<void> {
    await this.updateScheduledJob(id, { enabled: true });
  }

  /**
   * Disable a scheduled job
   */
  async disableJob(id: string): Promise<void> {
    await this.updateScheduledJob(id, { enabled: false });
  }

  /**
   * Check for overdue jobs and trigger them
   */
  private async triggerOverdueJobs(): Promise<void> {
    logger.info('Checking for overdue jobs...');

    const jobs = await prisma.scheduledJob.findMany({
      where: { enabled: true },
    });

    for (const job of jobs) {
      try {
        if (this.isJobOverdue(job)) {
          logger.info(`Job "${job.name}" is overdue, triggering now...`);
          await this.triggerJobNow(job.id);

          // Stagger triggers to avoid connection pool burst on startup
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        logger.error(`Failed to trigger overdue job "${job.name}"`, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /**
   * Check if a job is overdue based on its schedule and last run time
   */
  private isJobOverdue(job: any): boolean {
    // If never run, consider it overdue
    if (!job.lastRun) {
      return true;
    }

    // Parse cron expression to get interval in milliseconds
    const intervalMs = this.getIntervalFromCron(job.schedule);
    if (!intervalMs) {
      logger.warn(`Could not parse interval for job "${job.name}", skipping`);
      return false;
    }

    // Calculate time since last run
    const timeSinceLastRun = Date.now() - new Date(job.lastRun).getTime();

    // Job is overdue if time since last run exceeds the interval
    return timeSinceLastRun >= intervalMs;
  }

  /**
   * Get interval in milliseconds from cron expression
   * Supports common patterns like "0 * * * *" (hourly), "0 *\/6 * * *" (every 6 hours), etc.
   */
  private getIntervalFromCron(cronExpression: string): number | null {
    const parts = cronExpression.split(' ');
    if (parts.length < 5) {
      return null;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Every N hours: "0 */N * * *"
    const hourMatch = hour.match(/^\*\/(\d+)$/);
    if (minute === '0' && hourMatch && dayOfMonth === '*' && month === '*') {
      const hours = parseInt(hourMatch[1], 10);
      return hours * 60 * 60 * 1000;
    }

    // Hourly: "0 * * * *"
    if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*') {
      return 60 * 60 * 1000; // 1 hour
    }

    // Every N minutes: "*/N * * * *"
    const minuteMatch = minute.match(/^\*\/(\d+)$/);
    if (minuteMatch && hour === '*' && dayOfMonth === '*' && month === '*') {
      const minutes = parseInt(minuteMatch[1], 10);
      return minutes * 60 * 1000;
    }

    // Weekly: "M H * * D" where D is day of week (0-7)
    if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
      const hourNum = parseInt(hour, 10);
      const minuteNum = parseInt(minute, 10);
      const dayNum = parseInt(dayOfWeek, 10);
      if (!isNaN(hourNum) && !isNaN(minuteNum) && !isNaN(dayNum)) {
        return 7 * 24 * 60 * 60 * 1000; // 7 days
      }
    }

    // Daily at specific time: "M H * * *" where H is 0-23, M is 0-59
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      const hourNum = parseInt(hour, 10);
      const minuteNum = parseInt(minute, 10);
      if (!isNaN(hourNum) && !isNaN(minuteNum) && hourNum >= 0 && hourNum <= 23 && minuteNum >= 0 && minuteNum <= 59) {
        return 24 * 60 * 60 * 1000; // 24 hours
      }
    }

    // For other patterns, return a conservative default (24 hours)
    logger.warn(`Unknown cron pattern "${cronExpression}", defaulting to 24 hours`);
    return 24 * 60 * 60 * 1000;
  }

  /**
   * Validate cron expression format
   */
  private validateCronExpression(expression: string): void {
    // Basic validation - check format
    const parts = expression.split(' ');
    if (parts.length < 5 || parts.length > 6) {
      throw new Error('Invalid cron expression format');
    }

    // Additional validation could be added here
    // For production, use a library like 'cron-parser'
  }

  /**
   * Trigger retry for requests awaiting torrent search
   */
  private async triggerRetryMissingTorrents(job: any): Promise<string> {
    return await this.jobQueue.addRetryMissingTorrentsJob(job.id);
  }

  /**
   * Trigger retry for requests awaiting import
   */
  private async triggerRetryFailedImports(job: any): Promise<string> {
    return await this.jobQueue.addRetryFailedImportsJob(job.id);
  }

  /**
   * Trigger find missing ebooks safety-net pass
   */
  private async triggerFindMissingEbooks(job: any): Promise<string> {
    return await this.jobQueue.addFindMissingEbooksJob(job.id);
  }

  private async triggerRetryUnavailableEbooks(job: any): Promise<string> {
    return await this.jobQueue.addRetryUnavailableEbooksJob(job.id);
  }

  /**
   * Trigger RSS feed monitoring
   */
  private async triggerMonitorRssFeeds(job: any): Promise<string> {
    return await this.jobQueue.addMonitorRssFeedsJob(job.id);
  }

  /**
   * Trigger cleanup of torrents that have met seeding requirements
   */
  private async triggerCleanupSeededTorrents(job: any): Promise<string> {
    return await this.jobQueue.addCleanupSeededTorrentsJob(job.id);
  }

  /**
   * Trigger Reading shelves sync
   */
  private async triggerSyncShelves(job: any): Promise<string> {
    return await this.jobQueue.addSyncShelvesJob(job.id);
  }

  /**
   * Trigger watched lists check (watched series + watched authors)
   */
  private async triggerCheckWatchedLists(job: any): Promise<string> {
    return await this.jobQueue.addCheckWatchedListsJob(job.id);
  }
}

// Singleton instance
let schedulerService: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!schedulerService) {
    schedulerService = new SchedulerService();
  }
  return schedulerService;
}
