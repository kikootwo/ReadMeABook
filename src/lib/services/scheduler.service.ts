/**
 * Component: Recurring Jobs Scheduler Service
 * Documentation: documentation/backend/services/scheduler.md
 */

import { getJobQueueService, ScanPlexPayload } from './job-queue.service';
import { prisma } from '../db';

export type ScheduledJobType = 'plex_library_scan' | 'plex_recently_added_check' | 'audible_refresh' | 'retry_missing_torrents' | 'retry_failed_imports' | 'cleanup_seeded_torrents' | 'monitor_rss_feeds';

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
    console.log('[Scheduler] Initializing scheduler service...');

    // Create default jobs if they don't exist
    await this.ensureDefaultJobs();

    // Load and schedule all enabled jobs
    await this.scheduleAllJobs();

    // Check and trigger overdue jobs
    await this.triggerOverdueJobs();

    console.log('[Scheduler] Scheduler service started');
  }

  /**
   * Ensure default jobs exist in database
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
        schedule: '0 0 * * *', // Daily at midnight
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
    ];

    for (const defaultJob of defaults) {
      const existing = await prisma.scheduledJob.findFirst({
        where: { type: defaultJob.type },
      });

      if (!existing) {
        await prisma.scheduledJob.create({
          data: defaultJob,
        });
        console.log(`[Scheduler] Created default job: ${defaultJob.name} (disabled by default)`);
      }
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

    console.log(`[Scheduler] Scheduled ${jobs.length} jobs`);
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
      console.log(`[Scheduler] Job scheduled: ${job.name} (${job.schedule})`);
    } catch (error) {
      console.error(`[Scheduler] Failed to schedule job ${job.name}:`, error);
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
      console.log(`[Scheduler] Job unscheduled: ${job.name}`);
    } catch (error) {
      console.error(`[Scheduler] Failed to unschedule job ${job.name}:`, error);
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
      case 'cleanup_seeded_torrents':
        bullJobId = await this.triggerCleanupSeededTorrents(job);
        break;
      case 'monitor_rss_feeds':
        bullJobId = await this.triggerMonitorRssFeeds(job);
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

    console.log(`[Scheduler] Job "${job.name}" triggered with Bull job ID: ${bullJobId}`);

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
        console.error('[ScanLibrary] Error:', errorMsg);
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
        console.error('[ScanLibrary] Error:', errorMsg);
        throw new Error(errorMsg);
      }

      libraryId = job.payload?.libraryId || plexConfig.plex_audiobook_library_id;
    }

    console.log(`[ScanLibrary] Triggering ${backendMode} library scan for library: ${libraryId}`);

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
    console.log('[Scheduler] Checking for overdue jobs...');

    const jobs = await prisma.scheduledJob.findMany({
      where: { enabled: true },
    });

    for (const job of jobs) {
      try {
        if (this.isJobOverdue(job)) {
          console.log(`[Scheduler] Job "${job.name}" is overdue, triggering now...`);
          await this.triggerJobNow(job.id);
        }
      } catch (error) {
        console.error(`[Scheduler] Failed to trigger overdue job "${job.name}":`, error);
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
      console.warn(`[Scheduler] Could not parse interval for job "${job.name}", skipping`);
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
    console.warn(`[Scheduler] Unknown cron pattern "${cronExpression}", defaulting to 24 hours`);
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
}

// Singleton instance
let schedulerService: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!schedulerService) {
    schedulerService = new SchedulerService();
  }
  return schedulerService;
}
