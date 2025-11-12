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
  | 'match_plex';

export interface JobPayload {
  [key: string]: any;
}

export interface SearchIndexersPayload {
  requestId: string;
  audiobook: {
    id: string;
    title: string;
    author: string;
  };
}

export interface DownloadTorrentPayload {
  requestId: string;
  audiobook: {
    id: string;
    title: string;
    author: string;
  };
  torrent: TorrentResult;
}

export interface MonitorDownloadPayload {
  requestId: string;
  downloadHistoryId: string;
  downloadClientId: string;
  downloadClient: 'qbittorrent' | 'transmission';
}

export interface OrganizeFilesPayload {
  requestId: string;
  audiobookId: string;
  downloadPath: string;
  targetPath: string;
}

export interface ScanPlexPayload {
  libraryId?: string;
  partial?: boolean;
  path?: string;
}

export interface MatchPlexPayload {
  requestId: string;
  audiobookId: string;
  title: string;
  author: string;
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
    const bullJob = await this.queue.add(type, payload, options);

    // Persist to database
    const dbJob = await prisma.job.create({
      data: {
        bullJobId: bullJob.id as string,
        requestId: payload.requestId || null,
        type,
        status: 'pending',
        priority: options?.priority || 0,
        payload,
        maxAttempts: options?.attempts || 3,
      },
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
    downloadClient: 'qbittorrent' | 'transmission'
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
