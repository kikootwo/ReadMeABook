/**
 * Component: Job Queue Service
 * Documentation: documentation/backend/services/jobs.md
 */

import Queue, { Job as BullJob, JobOptions } from 'bull';
import Redis from 'ioredis';
import { prisma } from '../db';
import { TorrentResult } from '../utils/ranking-algorithm';

export type JobType =
  | 'search_indexers'
  | 'download_torrent'
  | 'monitor_download'
  | 'organize_files'
  | 'scan_plex'
  | 'match_plex'
  | 'plex_library_scan'
  | 'plex_recently_added_check'
  | 'audible_refresh'
  | 'retry_missing_torrents'
  | 'retry_failed_imports'
  | 'cleanup_seeded_torrents'
  | 'monitor_rss_feeds';

export interface JobPayload {
  jobId?: string; // Database job ID (added automatically by addJob)
  [key: string]: any;
}

export interface SearchIndexersPayload extends JobPayload {
  requestId: string;
  audiobook: {
    id: string;
    title: string;
    author: string;
  };
}

export interface DownloadTorrentPayload extends JobPayload {
  requestId: string;
  audiobook: {
    id: string;
    title: string;
    author: string;
  };
  torrent: TorrentResult;
}

export interface MonitorDownloadPayload extends JobPayload {
  requestId: string;
  downloadHistoryId: string;
  downloadClientId: string;
  downloadClient: 'qbittorrent' | 'transmission';
}

export interface OrganizeFilesPayload extends JobPayload {
  requestId: string;
  audiobookId: string;
  downloadPath: string;
  targetPath: string;
}

export interface ScanPlexPayload extends JobPayload {
  libraryId?: string;
  partial?: boolean;
  path?: string;
}

export interface MatchPlexPayload extends JobPayload {
  requestId: string;
  audiobookId: string;
  title: string;
  author: string;
}

export interface PlexRecentlyAddedPayload extends JobPayload {
  scheduledJobId?: string;
}

export interface MonitorRssFeedsPayload extends JobPayload {
  scheduledJobId?: string;
}

export interface AudibleRefreshPayload extends JobPayload {
  scheduledJobId?: string;
}

export interface RetryMissingTorrentsPayload extends JobPayload {
  scheduledJobId?: string;
}

export interface RetryFailedImportsPayload extends JobPayload {
  scheduledJobId?: string;
}

export interface CleanupSeededTorrentsPayload extends JobPayload {
  scheduledJobId?: string;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export class JobQueueService {
  private queue: Queue.Queue;
  private redis: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    // Create Redis client
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    // Increase max listeners to accommodate all job processors (12 total)
    this.redis.setMaxListeners(20);

    // Create Bull queue
    this.queue = new Queue('audiobook-jobs', redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });

    // Increase max listeners to accommodate all job processors (12 total)
    this.queue.setMaxListeners(20);

    this.setupEventHandlers();
    this.startProcessors();
  }

  /**
   * Setup event handlers for job lifecycle
   */
  private setupEventHandlers(): void {
    this.queue.on('completed', async (job: BullJob, result: any) => {
      console.log(`Job ${job.id} completed:`, result);
      await this.updateJobInDatabase(job.id as string, 'completed', result);
    });

    this.queue.on('failed', async (job: BullJob, error: Error) => {
      console.error(`Job ${job.id} failed:`, error.message);
      await this.updateJobInDatabase(
        job.id as string,
        'failed',
        null,
        error.message,
        error.stack
      );

      // Handle permanent failures for specific job types after all retries exhausted
      if (job.name === 'monitor_download' && job.data) {
        const payload = job.data as MonitorDownloadPayload;
        console.error(`[MonitorDownload] Job permanently failed for request ${payload.requestId} after ${job.attemptsMade} attempts`);

        // Update request status to failed (only happens after all retries exhausted)
        try {
          await prisma.request.update({
            where: { id: payload.requestId },
            data: {
              status: 'failed',
              errorMessage: error.message || 'Failed to monitor download after multiple retries',
              updatedAt: new Date(),
            },
          });

          // Update download history
          if (payload.downloadHistoryId) {
            await prisma.downloadHistory.update({
              where: { id: payload.downloadHistoryId },
              data: {
                downloadStatus: 'failed',
                downloadError: error.message || 'Failed to monitor download',
              },
            });
          }
        } catch (updateError) {
          console.error('[MonitorDownload] Failed to update request/download status:', updateError);
        }
      }
    });

    this.queue.on('stalled', async (job: BullJob) => {
      console.warn(`Job ${job.id} stalled`);
      await this.updateJobInDatabase(job.id as string, 'stuck');
    });

    this.queue.on('active', async (job: BullJob) => {
      await this.updateJobInDatabase(job.id as string, 'active');
    });

    this.queue.on('error', (error: Error) => {
      console.error('Queue error:', error);
    });
  }

  /**
   * Start job processors for each job type
   */
  private startProcessors(): void {
    // Search indexers processor
    this.queue.process('search_indexers', 3, async (job: BullJob<SearchIndexersPayload>) => {
      const { processSearchIndexers } = await import('../processors/search-indexers.processor');
      return await processSearchIndexers(job.data);
    });

    // Download torrent processor
    this.queue.process('download_torrent', 3, async (job: BullJob<DownloadTorrentPayload>) => {
      const { processDownloadTorrent } = await import('../processors/download-torrent.processor');
      return await processDownloadTorrent(job.data);
    });

    // Monitor download processor
    this.queue.process('monitor_download', 5, async (job: BullJob<MonitorDownloadPayload>) => {
      const { processMonitorDownload } = await import('../processors/monitor-download.processor');
      return await processMonitorDownload(job.data);
    });

    // Organize files processor
    this.queue.process('organize_files', 2, async (job: BullJob<OrganizeFilesPayload>) => {
      const { processOrganizeFiles } = await import('../processors/organize-files.processor');
      return await processOrganizeFiles(job.data);
    });

    // Scan Plex processor
    this.queue.process('scan_plex', 1, async (job: BullJob<ScanPlexPayload>) => {
      const { processScanPlex } = await import('../processors/scan-plex.processor');
      return await processScanPlex(job.data);
    });

    // Match Plex processor
    this.queue.process('match_plex', 3, async (job: BullJob<MatchPlexPayload>) => {
      const { processMatchPlex } = await import('../processors/match-plex.processor');
      return await processMatchPlex(job.data);
    });

    // Scheduled job processors
    this.queue.process('plex_library_scan', 1, async (job: BullJob) => {
      // plex_library_scan is just an alias for scan_plex
      const { processScanPlex } = await import('../processors/scan-plex.processor');
      const payloadWithJobId = await this.ensureJobRecord(job, 'plex_library_scan');
      return await processScanPlex(payloadWithJobId);
    });

    this.queue.process('plex_recently_added_check', 1, async (job: BullJob<PlexRecentlyAddedPayload>) => {
      const { processPlexRecentlyAddedCheck } = await import('../processors/plex-recently-added.processor');
      const payloadWithJobId = await this.ensureJobRecord(job, 'plex_recently_added_check');
      return await processPlexRecentlyAddedCheck(payloadWithJobId);
    });

    this.queue.process('monitor_rss_feeds', 1, async (job: BullJob<MonitorRssFeedsPayload>) => {
      const { processMonitorRssFeeds } = await import('../processors/monitor-rss-feeds.processor');
      const payloadWithJobId = await this.ensureJobRecord(job, 'monitor_rss_feeds');
      return await processMonitorRssFeeds(payloadWithJobId);
    });

    this.queue.process('audible_refresh', 1, async (job: BullJob<AudibleRefreshPayload>) => {
      const { processAudibleRefresh } = await import('../processors/audible-refresh.processor');
      const payloadWithJobId = await this.ensureJobRecord(job, 'audible_refresh');
      return await processAudibleRefresh(payloadWithJobId);
    });

    this.queue.process('retry_missing_torrents', 1, async (job: BullJob<RetryMissingTorrentsPayload>) => {
      const { processRetryMissingTorrents } = await import('../processors/retry-missing-torrents.processor');
      const payloadWithJobId = await this.ensureJobRecord(job, 'retry_missing_torrents');
      return await processRetryMissingTorrents(payloadWithJobId);
    });

    this.queue.process('retry_failed_imports', 1, async (job: BullJob<RetryFailedImportsPayload>) => {
      const { processRetryFailedImports } = await import('../processors/retry-failed-imports.processor');
      const payloadWithJobId = await this.ensureJobRecord(job, 'retry_failed_imports');
      return await processRetryFailedImports(payloadWithJobId);
    });

    this.queue.process('cleanup_seeded_torrents', 1, async (job: BullJob<CleanupSeededTorrentsPayload>) => {
      const { processCleanupSeededTorrents } = await import('../processors/cleanup-seeded-torrents.processor');
      const payloadWithJobId = await this.ensureJobRecord(job, 'cleanup_seeded_torrents');
      return await processCleanupSeededTorrents(payloadWithJobId);
    });
  }

  /**
   * Ensure a database Job record exists for scheduled jobs
   * If jobId is already in payload (manual trigger), return as-is
   * Otherwise, create a Job record for timer-triggered scheduled jobs
   * Also updates the lastRun timestamp for timer-triggered scheduled jobs
   */
  private async ensureJobRecord(job: BullJob, jobType: JobType): Promise<any> {
    const payload = job.data;

    // If jobId already exists (manual trigger via addJob), return payload as-is
    if (payload.jobId) {
      return payload;
    }

    // Check if a Job record already exists for this Bull job
    const existingJob = await prisma.job.findFirst({
      where: { bullJobId: job.id as string },
    });

    if (existingJob) {
      // Update lastRun for the scheduled job if this is a timer-triggered job
      if (payload.scheduledJobId) {
        await prisma.scheduledJob.update({
          where: { id: payload.scheduledJobId },
          data: { lastRun: new Date() },
        }).catch(err => {
          console.error(`[JobQueue] Failed to update lastRun for scheduled job ${payload.scheduledJobId}:`, err);
        });
      }
      return { ...payload, jobId: existingJob.id };
    }

    // Create a new Job record for this scheduled job
    const dbJob = await prisma.job.create({
      data: {
        bullJobId: job.id as string,
        requestId: payload.requestId || null,
        type: jobType,
        status: 'pending',
        priority: 0,
        payload,
        maxAttempts: 3,
      },
    });

    // Update lastRun for the scheduled job if this is a timer-triggered job
    if (payload.scheduledJobId) {
      await prisma.scheduledJob.update({
        where: { id: payload.scheduledJobId },
        data: { lastRun: new Date() },
      }).catch(err => {
        console.error(`[JobQueue] Failed to update lastRun for scheduled job ${payload.scheduledJobId}:`, err);
      });
    }

    return { ...payload, jobId: dbJob.id };
  }

  /**
   * Update job status in database
   */
  private async updateJobInDatabase(
    bullJobId: string,
    status: string,
    result?: any,
    errorMessage?: string,
    stackTrace?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (status === 'active') {
        updateData.startedAt = new Date();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completedAt = new Date();
      }

      if (result) {
        updateData.result = result;
      }

      if (errorMessage) {
        updateData.errorMessage = errorMessage;
      }

      if (stackTrace) {
        updateData.stackTrace = stackTrace;
      }

      await prisma.job.updateMany({
        where: { bullJobId },
        data: updateData,
      });
    } catch (error) {
      console.error('Failed to update job in database:', error);
    }
  }

  /**
   * Add a job to the queue
   */
  private async addJob(
    type: JobType,
    payload: JobPayload,
    options?: JobOptions
  ): Promise<string> {
    // First create the database job record
    const dbJob = await prisma.job.create({
      data: {
        bullJobId: null, // Will be updated after Bull job is created
        requestId: payload.requestId || null,
        type,
        status: 'pending',
        priority: options?.priority || 0,
        payload,
        maxAttempts: options?.attempts || 3,
      },
    });

    // Add jobId to payload so processors can access it
    const payloadWithJobId = { ...payload, jobId: dbJob.id };

    // Create Bull job
    const bullJob = await this.queue.add(type, payloadWithJobId, options);

    // Update database job with Bull job ID
    await prisma.job.update({
      where: { id: dbJob.id },
      data: { bullJobId: bullJob.id as string },
    });

    return dbJob.id;
  }

  /**
   * Add search indexers job
   */
  async addSearchJob(requestId: string, audiobook: { id: string; title: string; author: string }): Promise<string> {
    return await this.addJob(
      'search_indexers',
      {
        requestId,
        audiobook,
      } as SearchIndexersPayload,
      {
        priority: 10, // High priority for user-initiated requests
      }
    );
  }

  /**
   * Add download torrent job
   */
  async addDownloadJob(
    requestId: string,
    audiobook: { id: string; title: string; author: string },
    torrent: TorrentResult
  ): Promise<string> {
    return await this.addJob(
      'download_torrent',
      {
        requestId,
        audiobook,
        torrent,
      } as DownloadTorrentPayload,
      {
        priority: 9, // High priority - download selected torrent
      }
    );
  }

  /**
   * Add monitor download job
   */
  async addMonitorJob(
    requestId: string,
    downloadHistoryId: string,
    downloadClientId: string,
    downloadClient: 'qbittorrent' | 'transmission',
    delaySeconds: number = 0
  ): Promise<string> {
    return await this.addJob(
      'monitor_download',
      {
        requestId,
        downloadHistoryId,
        downloadClientId,
        downloadClient,
      } as MonitorDownloadPayload,
      {
        priority: 5, // Medium priority
        delay: delaySeconds * 1000, // Convert seconds to milliseconds
      }
    );
  }

  /**
   * Add organize files job
   */
  async addOrganizeJob(
    requestId: string,
    audiobookId: string,
    downloadPath: string,
    targetPath: string
  ): Promise<string> {
    return await this.addJob(
      'organize_files',
      {
        requestId,
        audiobookId,
        downloadPath,
        targetPath,
      } as OrganizeFilesPayload,
      {
        priority: 8,
      }
    );
  }

  /**
   * Add Plex scan job
   */
  async addPlexScanJob(libraryId: string, partial?: boolean, path?: string): Promise<string> {
    return await this.addJob(
      'scan_plex',
      {
        libraryId,
        partial,
        path,
      } as ScanPlexPayload,
      {
        priority: 7,
      }
    );
  }

  /**
   * Add Plex match job
   */
  async addPlexMatchJob(
    requestId: string,
    audiobookId: string,
    title: string,
    author: string
  ): Promise<string> {
    return await this.addJob(
      'match_plex',
      {
        requestId,
        audiobookId,
        title,
        author,
      } as MatchPlexPayload,
      {
        priority: 6,
      }
    );
  }

  /**
   * Add Plex recently added check job
   */
  async addPlexRecentlyAddedJob(scheduledJobId?: string): Promise<string> {
    return await this.addJob(
      'plex_recently_added_check',
      {
        scheduledJobId,
      } as PlexRecentlyAddedPayload,
      {
        priority: 8,
      }
    );
  }

  /**
   * Add RSS feed monitoring job
   */
  async addMonitorRssFeedsJob(scheduledJobId?: string): Promise<string> {
    return await this.addJob(
      'monitor_rss_feeds',
      {
        scheduledJobId,
      } as MonitorRssFeedsPayload,
      {
        priority: 8,
      }
    );
  }

  /**
   * Add Audible refresh job
   */
  async addAudibleRefreshJob(scheduledJobId?: string): Promise<string> {
    return await this.addJob(
      'audible_refresh',
      {
        scheduledJobId,
      } as AudibleRefreshPayload,
      {
        priority: 9,
      }
    );
  }

  /**
   * Add retry missing torrents job
   */
  async addRetryMissingTorrentsJob(scheduledJobId?: string): Promise<string> {
    return await this.addJob(
      'retry_missing_torrents',
      {
        scheduledJobId,
      } as RetryMissingTorrentsPayload,
      {
        priority: 7,
      }
    );
  }

  /**
   * Add retry failed imports job
   */
  async addRetryFailedImportsJob(scheduledJobId?: string): Promise<string> {
    return await this.addJob(
      'retry_failed_imports',
      {
        scheduledJobId,
      } as RetryFailedImportsPayload,
      {
        priority: 7,
      }
    );
  }

  /**
   * Add cleanup seeded torrents job
   */
  async addCleanupSeededTorrentsJob(scheduledJobId?: string): Promise<string> {
    return await this.addJob(
      'cleanup_seeded_torrents',
      {
        scheduledJobId,
      } as CleanupSeededTorrentsPayload,
      {
        priority: 10,
      }
    );
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<any | null> {
    return await prisma.job.findUnique({
      where: { id: jobId },
    });
  }

  /**
   * Get all jobs for a request
   */
  async getJobsByRequest(requestId: string): Promise<any[]> {
    return await prisma.job.findMany({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    const counts = await this.queue.getJobCounts();
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
  }

  /**
   * Get active jobs
   */
  async getActiveJobs(): Promise<any[]> {
    const bullJobs = await this.queue.getActive();
    const jobIds = bullJobs.map((j) => j.id as string);

    return await prisma.job.findMany({
      where: {
        bullJobId: { in: jobIds },
      },
    });
  }

  /**
   * Get failed jobs
   */
  async getFailedJobs(limit: number = 50): Promise<any[]> {
    return await prisma.job.findMany({
      where: { status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<void> {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Job not found');
    }

    if (job.bullJobId) {
      const bullJob = await this.queue.getJob(job.bullJobId);
      if (bullJob) {
        await bullJob.retry();
      }
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'pending',
        attempts: 0,
        errorMessage: null,
        stackTrace: null,
      },
    });
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Job not found');
    }

    if (job.bullJobId) {
      const bullJob = await this.queue.getJob(job.bullJobId);
      if (bullJob) {
        await bullJob.remove();
      }
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'cancelled' },
    });
  }

  /**
   * Pause the queue
   */
  async pauseQueue(): Promise<void> {
    await this.queue.pause();
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    await this.queue.resume();
  }

  /**
   * Close queue connection (for graceful shutdown)
   */
  async close(): Promise<void> {
    await this.queue.close();
    this.redis.disconnect();
  }

  /**
   * Add a repeatable job with cron schedule
   */
  async addRepeatableJob(
    jobType: string,
    payload: JobPayload,
    cronExpression: string,
    jobId: string
  ): Promise<void> {
    await this.queue.add(jobType, payload, {
      repeat: {
        cron: cronExpression,
      },
      jobId,
    });
    console.log(`[JobQueue] Added repeatable job: ${jobType} with cron ${cronExpression}`);
  }

  /**
   * Remove a repeatable job
   */
  async removeRepeatableJob(
    jobType: string,
    cronExpression: string,
    jobId: string
  ): Promise<void> {
    await this.queue.removeRepeatable(jobType, {
      cron: cronExpression,
      jobId,
    });
    console.log(`[JobQueue] Removed repeatable job: ${jobType}`);
  }

  /**
   * Get all repeatable jobs
   */
  async getRepeatableJobs(): Promise<any[]> {
    return await this.queue.getRepeatableJobs();
  }
}

// Singleton instance
let jobQueueService: JobQueueService | null = null;

export function getJobQueueService(): JobQueueService {
  if (!jobQueueService) {
    jobQueueService = new JobQueueService();
  }
  return jobQueueService;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (jobQueueService) {
    console.log('Closing job queue...');
    await jobQueueService.close();
  }
});
