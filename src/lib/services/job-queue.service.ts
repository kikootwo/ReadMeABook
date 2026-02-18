/**
 * Component: Job Queue Service
 * Documentation: documentation/backend/services/jobs.md
 */

import Queue, { Job as BullJob, JobOptions } from 'bull';
import Redis from 'ioredis';
import { prisma } from '../db';
import { TorrentResult } from '../utils/ranking-algorithm';
import { DownloadClientType } from '../interfaces/download-client.interface';
import { RMABLogger } from '../utils/logger';
import type { NotificationEvent } from '@/lib/constants/notification-events';

const logger = RMABLogger.create('JobQueue');

export type JobType =
  | 'search_indexers'
  | 'download_torrent'
  | 'monitor_download'
  | 'organize_files'
  | 'scan_plex'
  | 'plex_library_scan'
  | 'plex_recently_added_check'
  | 'audible_refresh'
  | 'retry_missing_torrents'
  | 'retry_failed_imports'
  | 'cleanup_seeded_torrents'
  | 'monitor_rss_feeds'
  | 'sync_goodreads_shelves'
  | 'send_notification'
  // Ebook-specific job types
  | 'search_ebook'
  | 'start_direct_download'
  | 'monitor_direct_download';

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
    asin?: string; // Optional ASIN for runtime-based size scoring
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
  downloadClient: DownloadClientType;
  lastProgress?: number;  // Previous poll's progress (0-100) for stall detection
  stallCount?: number;    // Consecutive polls with no progress change (drives backoff)
}

export interface OrganizeFilesPayload extends JobPayload {
  requestId: string;
  audiobookId: string;
  downloadPath: string;
  targetPath?: string; // Optional - not used by processor (reads from database config)
}

export interface ScanPlexPayload extends JobPayload {
  libraryId?: string;
  partial?: boolean;
  path?: string;
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

export interface SyncGoodreadsShelvesPayload extends JobPayload {
  scheduledJobId?: string;
  shelfId?: string;
  maxLookupsPerShelf?: number;
}

// Ebook-specific payload interfaces
export interface SearchEbookPayload extends JobPayload {
  requestId: string;
  audiobook: {
    id: string;
    title: string;
    author: string;
    asin?: string; // ASIN for Anna's Archive search (best match)
  };
  preferredFormat?: string; // epub, pdf, mobi, azw3 (default: from config)
}

export interface EbookSearchResult {
  md5: string;
  title: string;
  author: string;
  format: string;
  fileSize?: number;
  downloadUrls: string[]; // Slow download URLs from Anna's Archive
  source: 'annas_archive'; // For future indexer support
  score: number; // Ranking score (for future multi-source ranking)
}

export interface StartDirectDownloadPayload extends JobPayload {
  requestId: string;
  downloadHistoryId: string;
  downloadUrl: string;
  targetFilename: string;
  expectedSize?: number;
}

export interface MonitorDirectDownloadPayload extends JobPayload {
  requestId: string;
  downloadHistoryId: string;
  downloadId: string; // Internal tracking ID
  targetPath: string; // Full path to the downloading file
  expectedSize?: number;
}

export interface SendNotificationPayload extends JobPayload {
  event: NotificationEvent;
  requestId?: string;
  issueId?: string;
  title: string;
  author: string;
  userName: string;
  message?: string;
  requestType?: string; // 'audiobook' | 'ebook' — drives type-specific notification titles
  timestamp: Date;
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
      logger.info(`Job ${job.id} completed`, { result });
      await this.updateJobInDatabase(job.id as string, 'completed', result);
    });

    this.queue.on('failed', async (job: BullJob, error: Error) => {
      logger.error(`Job ${job.id} failed`, { error: error.message });
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
        logger.error(`MonitorDownload job permanently failed for request ${payload.requestId} after ${job.attemptsMade} attempts`);

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
          logger.error('Failed to update request/download status', { error: updateError instanceof Error ? updateError.message : String(updateError) });
        }
      }
    });

    this.queue.on('stalled', async (job: BullJob) => {
      logger.warn(`Job ${job.id} stalled`);
      await this.updateJobInDatabase(job.id as string, 'stuck');
    });

    this.queue.on('active', async (job: BullJob) => {
      await this.updateJobInDatabase(job.id as string, 'active');
    });

    this.queue.on('error', (error: Error) => {
      logger.error('Queue error', { error: error.message });
    });
  }

  /**
   * Start job processors for each job type
   */
  private startProcessors(): void {
    // Search indexers processor
    this.queue.process('search_indexers', 2, async (job: BullJob<SearchIndexersPayload>) => {
      const { processSearchIndexers } = await import('../processors/search-indexers.processor');
      return await processSearchIndexers(job.data);
    });

    // Download torrent processor
    this.queue.process('download_torrent', 2, async (job: BullJob<DownloadTorrentPayload>) => {
      const { processDownloadTorrent } = await import('../processors/download-torrent.processor');
      return await processDownloadTorrent(job.data);
    });

    // Monitor download processor
    this.queue.process('monitor_download', 2, async (job: BullJob<MonitorDownloadPayload>) => {
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

    this.queue.process('sync_goodreads_shelves', 1, async (job: BullJob<SyncGoodreadsShelvesPayload>) => {
      const { processSyncGoodreadsShelves } = await import('../processors/sync-goodreads-shelves.processor');
      const payloadWithJobId = await this.ensureJobRecord(job, 'sync_goodreads_shelves');
      return await processSyncGoodreadsShelves(payloadWithJobId);
    });

    // Send notification processor
    this.queue.process('send_notification', 2, async (job: BullJob<SendNotificationPayload>) => {
      const { processSendNotification } = await import('../processors/send-notification.processor');
      return await processSendNotification(job.data);
    });

    // Ebook-specific processors
    this.queue.process('search_ebook', 2, async (job: BullJob<SearchEbookPayload>) => {
      const { processSearchEbook } = await import('../processors/search-ebook.processor');
      return await processSearchEbook(job.data);
    });

    this.queue.process('start_direct_download', 2, async (job: BullJob<StartDirectDownloadPayload>) => {
      const { processStartDirectDownload } = await import('../processors/direct-download.processor');
      return await processStartDirectDownload(job.data);
    });

    this.queue.process('monitor_direct_download', 2, async (job: BullJob<MonitorDirectDownloadPayload>) => {
      const { processMonitorDirectDownload } = await import('../processors/direct-download.processor');
      return await processMonitorDirectDownload(job.data);
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
          logger.error(`Failed to update lastRun for scheduled job ${payload.scheduledJobId}`, { error: err instanceof Error ? err.message : String(err) });
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
        logger.error(`Failed to update lastRun for scheduled job ${payload.scheduledJobId}`, { error: err instanceof Error ? err.message : String(err) });
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
      logger.error('Failed to update job in database', { error: error instanceof Error ? error.message : String(error) });
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
  async addSearchJob(requestId: string, audiobook: { id: string; title: string; author: string; asin?: string }): Promise<string> {
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
    downloadClient: DownloadClientType,
    delaySeconds: number = 0,
    lastProgress?: number,
    stallCount?: number
  ): Promise<string> {
    return await this.addJob(
      'monitor_download',
      {
        requestId,
        downloadHistoryId,
        downloadClientId,
        downloadClient,
        lastProgress,
        stallCount,
      } as MonitorDownloadPayload,
      {
        priority: 5, // Medium priority
        delay: delaySeconds * 1000, // Convert seconds to milliseconds
      }
    );
  }

  /**
   * Add organize files job
   * Note: targetPath parameter is deprecated and unused (reads from database config instead)
   */
  async addOrganizeJob(
    requestId: string,
    audiobookId: string,
    downloadPath: string,
    targetPath?: string
  ): Promise<string> {
    return await this.addJob(
      'organize_files',
      {
        requestId,
        audiobookId,
        downloadPath,
        targetPath, // Not used by processor
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
   * Add sync Goodreads shelves job
   */
  async addSyncGoodreadsShelvesJob(scheduledJobId?: string, shelfId?: string, maxLookupsPerShelf?: number): Promise<string> {
    return await this.addJob(
      'sync_goodreads_shelves',
      {
        scheduledJobId,
        shelfId,
        maxLookupsPerShelf,
      } as SyncGoodreadsShelvesPayload,
      {
        priority: 7,
      }
    );
  }

  // =========================================================================
  // EBOOK-SPECIFIC JOB METHODS
  // =========================================================================

  /**
   * Add search ebook job (Anna's Archive search)
   */
  async addSearchEbookJob(
    requestId: string,
    audiobook: { id: string; title: string; author: string; asin?: string },
    preferredFormat?: string
  ): Promise<string> {
    return await this.addJob(
      'search_ebook',
      {
        requestId,
        audiobook,
        preferredFormat,
      } as SearchEbookPayload,
      {
        priority: 10, // High priority for user-initiated requests
      }
    );
  }

  /**
   * Add start direct download job (HTTP download for ebooks)
   */
  async addStartDirectDownloadJob(
    requestId: string,
    downloadHistoryId: string,
    downloadUrl: string,
    targetFilename: string,
    expectedSize?: number
  ): Promise<string> {
    return await this.addJob(
      'start_direct_download',
      {
        requestId,
        downloadHistoryId,
        downloadUrl,
        targetFilename,
        expectedSize,
      } as StartDirectDownloadPayload,
      {
        priority: 9, // High priority - download selected ebook
      }
    );
  }

  /**
   * Add monitor direct download job (tracks HTTP download progress)
   */
  async addMonitorDirectDownloadJob(
    requestId: string,
    downloadHistoryId: string,
    downloadId: string,
    targetPath: string,
    expectedSize?: number,
    delaySeconds: number = 0
  ): Promise<string> {
    return await this.addJob(
      'monitor_direct_download',
      {
        requestId,
        downloadHistoryId,
        downloadId,
        targetPath,
        expectedSize,
      } as MonitorDirectDownloadPayload,
      {
        priority: 5, // Medium priority
        delay: delaySeconds * 1000,
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
   * Add notification job
   */
  async addNotificationJob(
    event: NotificationEvent,
    requestId: string,
    title: string,
    author: string,
    userName: string,
    message?: string,
    requestType?: string
  ): Promise<string> {
    logger.info(`Queueing notification: ${event}`, { requestId, title, userName });
    return await this.addJob(
      'send_notification',
      {
        event,
        // issue_reported passes an issue ID, not a request ID — omit from payload
        // so addJob doesn't try to create a FK to the requests table.
        // The ID is still available in the notification payload for display.
        requestId: event === 'issue_reported' ? undefined : requestId,
        title,
        author,
        userName,
        message,
        requestType,
        // Pass the original ID for notification display (e.g., Discord footer)
        ...(event === 'issue_reported' && { issueId: requestId }),
        timestamp: new Date(),
      } as SendNotificationPayload,
      {
        priority: 5, // Medium priority
      }
    );
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
    logger.info(`Added repeatable job: ${jobType} with cron ${cronExpression}`);
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
    logger.info(`Removed repeatable job: ${jobType}`);
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
    logger.info('Closing job queue...');
    await jobQueueService.close();
  }
});
