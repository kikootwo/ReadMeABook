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
        name: 'Plex Recently Added Check',
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
    const { getAudibleService } = await import('../integrations/audible.service');
    const { getThumbnailCacheService } = await import('./thumbnail-cache.service');
    const audibleService = getAudibleService();
    const thumbnailCache = getThumbnailCacheService();

    console.log('[AudibleRefresh] Starting Audible data refresh...');

    // Clear previous popular/new-release flags for fresh data
    await prisma.audibleCache.updateMany({
      where: {
        OR: [
          { isPopular: true },
          { isNewRelease: true },
        ],
      },
      data: {
        isPopular: false,
        isNewRelease: false,
        popularRank: null,
        newReleaseRank: null,
      },
    });
    console.log('[AudibleRefresh] Cleared previous popular/new-release flags in audible_cache');

    // Fetch popular and new releases - 200 items each
    const popular = await audibleService.getPopularAudiobooks(200);
    const newReleases = await audibleService.getNewReleases(200);

    console.log(`[AudibleRefresh] Fetched ${popular.length} popular, ${newReleases.length} new releases from Audible`);

    // Persist to audible_cache - pure Audible metadata, no matching
    let popularSaved = 0;
    let newReleasesSaved = 0;
    const syncTime = new Date();

    for (let i = 0; i < popular.length; i++) {
      const audiobook = popular[i];
      try {
        // Cache thumbnail if coverArtUrl exists
        let cachedCoverPath: string | null = null;
        if (audiobook.coverArtUrl) {
          cachedCoverPath = await thumbnailCache.cacheThumbnail(audiobook.asin, audiobook.coverArtUrl);
        }

        await prisma.audibleCache.upsert({
          where: { asin: audiobook.asin },
          create: {
            asin: audiobook.asin,
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            cachedCoverPath: cachedCoverPath,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            isPopular: true,
            popularRank: i + 1,
            lastSyncedAt: syncTime,
          },
          update: {
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            cachedCoverPath: cachedCoverPath,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            isPopular: true,
            popularRank: i + 1,
            lastSyncedAt: syncTime,
          },
        });

        popularSaved++;
      } catch (error) {
        console.error(`[AudibleRefresh] Failed to save popular audiobook ${audiobook.title}:`, error);
      }
    }

    for (let i = 0; i < newReleases.length; i++) {
      const audiobook = newReleases[i];
      try {
        // Cache thumbnail if coverArtUrl exists
        let cachedCoverPath: string | null = null;
        if (audiobook.coverArtUrl) {
          cachedCoverPath = await thumbnailCache.cacheThumbnail(audiobook.asin, audiobook.coverArtUrl);
        }

        await prisma.audibleCache.upsert({
          where: { asin: audiobook.asin },
          create: {
            asin: audiobook.asin,
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            cachedCoverPath: cachedCoverPath,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            isNewRelease: true,
            newReleaseRank: i + 1,
            lastSyncedAt: syncTime,
          },
          update: {
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator,
            description: audiobook.description,
            coverArtUrl: audiobook.coverArtUrl,
            cachedCoverPath: cachedCoverPath,
            durationMinutes: audiobook.durationMinutes,
            releaseDate: audiobook.releaseDate ? new Date(audiobook.releaseDate) : null,
            rating: audiobook.rating ? audiobook.rating : null,
            genres: audiobook.genres || [],
            isNewRelease: true,
            newReleaseRank: i + 1,
            lastSyncedAt: syncTime,
          },
        });

        newReleasesSaved++;
      } catch (error) {
        console.error(`[AudibleRefresh] Failed to save new release ${audiobook.title}:`, error);
      }
    }

    console.log(`[AudibleRefresh] Saved ${popularSaved} popular and ${newReleasesSaved} new releases to audible_cache`);
    console.log('[AudibleRefresh] Matching will happen at query time when displaying books');

    // Cleanup unused thumbnails
    console.log('[AudibleRefresh] Cleaning up unused thumbnails...');
    const allActiveAsins = await prisma.audibleCache.findMany({
      select: { asin: true },
    });
    const activeAsinSet = new Set(allActiveAsins.map(item => item.asin));
    const deletedCount = await thumbnailCache.cleanupUnusedThumbnails(activeAsinSet);
    console.log(`[AudibleRefresh] Cleanup complete: ${deletedCount} unused thumbnails removed`);

    return 'audible-refresh-' + Date.now();
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

  /**
   * Trigger retry for requests awaiting torrent search
   */
  private async triggerRetryMissingTorrents(job: any): Promise<string> {
    console.log('[RetryMissingTorrents] Starting retry job for requests awaiting search...');

    // Find all requests in awaiting_search status
    const requests = await prisma.request.findMany({
      where: {
        status: 'awaiting_search',
      },
      include: {
        audiobook: true,
      },
      take: 50, // Limit to 50 requests per run
    });

    console.log(`[RetryMissingTorrents] Found ${requests.length} requests awaiting search`);

    if (requests.length === 0) {
      return `retry-missing-torrents-${Date.now()}-no-requests`;
    }

    // Trigger search job for each request
    const jobQueue = getJobQueueService();
    let triggered = 0;

    for (const request of requests) {
      try {
        await jobQueue.addSearchJob(request.id, {
          id: request.audiobook.id,
          title: request.audiobook.title,
          author: request.audiobook.author,
        });
        triggered++;
        console.log(`[RetryMissingTorrents] Triggered search for request ${request.id}: ${request.audiobook.title}`);
      } catch (error) {
        console.error(`[RetryMissingTorrents] Failed to trigger search for request ${request.id}:`, error);
      }
    }

    console.log(`[RetryMissingTorrents] Triggered ${triggered}/${requests.length} search jobs`);

    return `retry-missing-torrents-${Date.now()}-${triggered}`;
  }

  /**
   * Trigger retry for requests awaiting import
   */
  private async triggerRetryFailedImports(job: any): Promise<string> {
    console.log('[RetryFailedImports] Starting retry job for requests awaiting import...');

    // Find all requests in awaiting_import status
    const requests = await prisma.request.findMany({
      where: {
        status: 'awaiting_import',
      },
      include: {
        audiobook: true,
        downloadHistory: {
          where: { selected: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      take: 50, // Limit to 50 requests per run
    });

    console.log(`[RetryFailedImports] Found ${requests.length} requests awaiting import`);

    if (requests.length === 0) {
      return `retry-failed-imports-${Date.now()}-no-requests`;
    }

    // Trigger organize job for each request
    const jobQueue = getJobQueueService();
    let triggered = 0;

    for (const request of requests) {
      try {
        // Get the download path from the most recent download history
        const downloadHistory = request.downloadHistory[0];

        if (!downloadHistory || !downloadHistory.downloadClientId) {
          console.warn(`[RetryFailedImports] No download history found for request ${request.id}, skipping`);
          continue;
        }

        // Get download path from qBittorrent
        const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
        const qbt = await getQBittorrentService();
        const torrent = await qbt.getTorrent(downloadHistory.downloadClientId);
        const downloadPath = `${torrent.save_path}/${torrent.name}`;

        await jobQueue.addOrganizeJob(
          request.id,
          request.audiobook.id,
          downloadPath,
          `/media/audiobooks/${request.audiobook.author}/${request.audiobook.title}`
        );
        triggered++;
        console.log(`[RetryFailedImports] Triggered organize job for request ${request.id}: ${request.audiobook.title}`);
      } catch (error) {
        console.error(`[RetryFailedImports] Failed to trigger organize for request ${request.id}:`, error);
      }
    }

    console.log(`[RetryFailedImports] Triggered ${triggered}/${requests.length} organize jobs`);

    return `retry-failed-imports-${Date.now()}-${triggered}`;
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
    console.log('[CleanupSeededTorrents] Starting cleanup job for seeded torrents...');

    // Get indexer configuration with per-indexer seeding times
    const { getConfigService } = await import('./config.service');
    const configService = getConfigService();
    const indexersConfigStr = await configService.get('prowlarr_indexers');

    if (!indexersConfigStr) {
      console.log('[CleanupSeededTorrents] No indexer configuration found, skipping');
      return 'cleanup-seeded-torrents-' + Date.now() + '-no-config';
    }

    const indexersConfig = JSON.parse(indexersConfigStr);

    // Create a map of indexer name to config for quick lookup
    const indexerConfigMap = new Map<string, any>();
    for (const indexer of indexersConfig) {
      indexerConfigMap.set(indexer.name, indexer);
    }

    console.log(`[CleanupSeededTorrents] Loaded configuration for ${indexerConfigMap.size} indexers`);

    // Find all completed requests that have download history
    const completedRequests = await prisma.request.findMany({
      where: {
        status: 'completed',
      },
      include: {
        downloadHistory: {
          where: {
            selected: true,
            downloadStatus: 'completed',
          },
          orderBy: { completedAt: 'desc' },
          take: 1,
        },
      },
      take: 100, // Limit to 100 requests per run
    });

    console.log(`[CleanupSeededTorrents] Found ${completedRequests.length} completed requests to check`);

    let cleaned = 0;
    let skipped = 0;
    let noConfig = 0;

    for (const request of completedRequests) {
      try {
        const downloadHistory = request.downloadHistory[0];

        if (!downloadHistory || !downloadHistory.downloadClientId || !downloadHistory.indexerName) {
          continue;
        }

        // Get the indexer name from download history
        const indexerName = downloadHistory.indexerName;

        // Find matching indexer configuration by name
        const seedingConfig = indexerConfigMap.get(indexerName);

        // If no config found or seeding time is 0 (unlimited), skip
        if (!seedingConfig) {
          console.log(`[CleanupSeededTorrents] No configuration found for indexer ${indexerName}, skipping`);
          noConfig++;
          continue;
        }

        if (seedingConfig.seedingTimeMinutes === 0) {
          console.log(`[CleanupSeededTorrents] Indexer ${indexerName} has unlimited seeding, skipping`);
          noConfig++;
          continue;
        }

        const seedingTimeSeconds = seedingConfig.seedingTimeMinutes * 60;

        // Get torrent info from qBittorrent to check seeding time
        const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
        const qbt = await getQBittorrentService();

        let torrent;
        try {
          torrent = await qbt.getTorrent(downloadHistory.downloadClientId);
        } catch (error) {
          // Torrent might already be deleted, skip
          console.log(`[CleanupSeededTorrents] Torrent ${downloadHistory.downloadClientId} not found in qBittorrent, skipping`);
          continue;
        }

        // Check if seeding time requirement is met
        const actualSeedingTime = torrent.seeding_time || 0;
        const hasMetRequirement = actualSeedingTime >= seedingTimeSeconds;

        if (!hasMetRequirement) {
          const remaining = Math.ceil((seedingTimeSeconds - actualSeedingTime) / 60);
          console.log(`[CleanupSeededTorrents] Torrent ${torrent.name} (${indexerName}) needs ${remaining} more minutes of seeding`);
          skipped++;
          continue;
        }

        console.log(`[CleanupSeededTorrents] Torrent ${torrent.name} (${indexerName}) has met seeding requirement (${Math.floor(actualSeedingTime / 60)}/${seedingConfig.seedingTimeMinutes} minutes)`);

        // Delete torrent and files from qBittorrent
        await qbt.deleteTorrent(downloadHistory.downloadClientId, true); // true = delete files

        console.log(`[CleanupSeededTorrents] Deleted torrent and files for request ${request.id}`);
        cleaned++;
      } catch (error) {
        console.error(`[CleanupSeededTorrents] Failed to cleanup request ${request.id}:`, error);
      }
    }

    console.log(`[CleanupSeededTorrents] Cleanup complete: ${cleaned} torrents cleaned, ${skipped} still seeding, ${noConfig} unlimited`);

    return `cleanup-seeded-torrents-${Date.now()}-cleaned:${cleaned}-skipped:${skipped}-unlimited:${noConfig}`;
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
