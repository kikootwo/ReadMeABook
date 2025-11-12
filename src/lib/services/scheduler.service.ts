/**
 * Component: Recurring Jobs Scheduler Service
 * Documentation: documentation/backend/services/scheduler.md
 */

import { getJobQueueService, ScanPlexPayload } from './job-queue.service';
import { prisma } from '../db';

export type ScheduledJobType = 'plex_library_scan' | 'audible_refresh';

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
        name: 'Plex Library Scan',
        type: 'plex_library_scan' as ScheduledJobType,
        schedule: '0 */6 * * *', // Every 6 hours
        enabled: false, // Start disabled until first setup is complete
        payload: {},
      },
      {
        name: 'Audible Data Refresh',
        type: 'audible_refresh' as ScheduledJobType,
        schedule: '0 0 * * *', // Daily at midnight
        enabled: false, // Start disabled until first setup is complete
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
    // Note: Bull repeatable jobs would be set up here
    // For now, we'll track in database and trigger manually
    console.log(`[Scheduler] Job scheduled: ${job.name} (${job.schedule})`);
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

    // Reschedule if needed
    if (job.enabled) {
      await this.scheduleJob(job);
    }

    return job;
  }

  /**
   * Delete scheduled job
   */
  async deleteScheduledJob(id: string): Promise<void> {
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
      case 'audible_refresh':
        bullJobId = await this.triggerAudibleRefresh(job);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    // Update last run time
    await prisma.scheduledJob.update({
      where: { id },
      data: { lastRun: new Date() },
    });

    return bullJobId;
  }

  /**
   * Trigger Plex library scan
   */
  private async triggerPlexScan(job: any): Promise<string> {
    const { getConfigService } = await import('./config.service');
    const configService = getConfigService();

    // Validate Plex configuration before triggering scan
    const plexConfig = await configService.getMany([
      'plex_url',
      'plex_token',
      'plex_audiobook_library_id',
    ]);

    const missingFields: string[] = [];
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
      console.error('[ScanPlex] Error:', errorMsg);
      throw new Error(errorMsg);
    }

    const libraryId = job.payload?.libraryId || plexConfig.plex_audiobook_library_id;

    const payload: ScanPlexPayload = {
      libraryId: libraryId || undefined,
    };

    return await this.jobQueue.addPlexScanJob(
      libraryId || '',
      payload.partial,
      payload.path
    );
  }

  /**
   * Trigger Audible data refresh
   */
  private async triggerAudibleRefresh(job: any): Promise<string> {
    const { getAudibleService } = await import('../integrations/audible.service');
    const { compareTwoStrings } = await import('string-similarity');
    const audibleService = getAudibleService();

    console.log('[AudibleRefresh] Starting Audible data refresh...');

    // Fetch popular and new releases
    const popular = await audibleService.getPopularAudiobooks(50);
    const newReleases = await audibleService.getNewReleases(50);

    console.log(`[AudibleRefresh] Fetched ${popular.length} popular, ${newReleases.length} new releases`);

    // Get all Plex audiobooks to check for matches
    const plexAudiobooks = await prisma.audiobook.findMany({
      where: {
        plexGuid: { not: null },
        availabilityStatus: 'available',
      },
      select: {
        id: true,
        title: true,
        author: true,
        plexGuid: true,
      },
    });

    console.log(`[AudibleRefresh] Found ${plexAudiobooks.length} audiobooks in Plex library for matching`);

    // Helper function to check if Audible book matches Plex book
    const findPlexMatch = (audibleTitle: string, audibleAuthor: string) => {
      for (const plexBook of plexAudiobooks) {
        const titleScore = compareTwoStrings(
          audibleTitle.toLowerCase(),
          plexBook.title.toLowerCase()
        );
        const authorScore = plexBook.author && audibleAuthor
          ? compareTwoStrings(audibleAuthor.toLowerCase(), plexBook.author.toLowerCase())
          : 0.5;

        const overallScore = titleScore * 0.7 + authorScore * 0.3;

        // Match threshold: 85% for Audible data (stricter than Plex scan)
        if (overallScore >= 0.85) {
          return plexBook.id;
        }
      }
      return null;
    };

    // Persist to database - upsert audiobooks to cache the data
    let popularSaved = 0;
    let newReleasesSaved = 0;
    let matchedToPlex = 0;

    for (const audiobook of popular) {
      try {
        // Check if this matches a Plex audiobook
        const plexMatchId = findPlexMatch(audiobook.title, audiobook.author);

        await prisma.audiobook.upsert({
          where: { audibleId: audiobook.asin },
          create: {
            audibleId: audiobook.asin,
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            availabilityStatus: plexMatchId ? 'available' : 'unknown',
            availableAt: plexMatchId ? new Date() : null,
          },
          update: {
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            // Only update availability if not already set
            ...(plexMatchId && {
              availabilityStatus: 'available',
              availableAt: new Date(),
            }),
          },
        });
        popularSaved++;
        if (plexMatchId) matchedToPlex++;
      } catch (error) {
        console.error(`[AudibleRefresh] Failed to save popular audiobook ${audiobook.title}:`, error);
      }
    }

    for (const audiobook of newReleases) {
      try {
        // Check if this matches a Plex audiobook
        const plexMatchId = findPlexMatch(audiobook.title, audiobook.author);

        await prisma.audiobook.upsert({
          where: { audibleId: audiobook.asin },
          create: {
            audibleId: audiobook.asin,
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            availabilityStatus: plexMatchId ? 'available' : 'unknown',
            availableAt: plexMatchId ? new Date() : null,
          },
          update: {
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            // Only update availability if not already set
            ...(plexMatchId && {
              availabilityStatus: 'available',
              availableAt: new Date(),
            }),
          },
        });
        newReleasesSaved++;
        if (plexMatchId) matchedToPlex++;
      } catch (error) {
        console.error(`[AudibleRefresh] Failed to save new release ${audiobook.title}:`, error);
      }
    }

    console.log(`[AudibleRefresh] Saved ${popularSaved} popular and ${newReleasesSaved} new releases to database`);
    console.log(`[AudibleRefresh] Matched ${matchedToPlex} Audible books to existing Plex library`);

    // Return a placeholder job ID since this doesn't use the Bull queue
    return `audible-refresh-${Date.now()}`;
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

    // Daily: "0 0 * * *"
    if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*') {
      return 24 * 60 * 60 * 1000; // 24 hours
    }

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

    // Weekly: "0 0 * * 0" (Sunday at midnight)
    if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '0') {
      return 7 * 24 * 60 * 60 * 1000; // 7 days
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
}

// Singleton instance
let schedulerService: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!schedulerService) {
    schedulerService = new SchedulerService();
  }
  return schedulerService;
}
