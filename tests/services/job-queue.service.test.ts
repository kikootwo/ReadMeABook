/**
 * Component: Job Queue Service Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

const processorsMock = vi.hoisted(() => ({
  processSearchIndexers: vi.fn().mockResolvedValue('ok'),
  processDownloadTorrent: vi.fn().mockResolvedValue('ok'),
  processMonitorDownload: vi.fn().mockResolvedValue('ok'),
  processOrganizeFiles: vi.fn().mockResolvedValue('ok'),
  processScanPlex: vi.fn().mockResolvedValue('ok'),
  processMatchPlex: vi.fn().mockResolvedValue('ok'),
  processPlexRecentlyAddedCheck: vi.fn().mockResolvedValue('ok'),
  processMonitorRssFeeds: vi.fn().mockResolvedValue('ok'),
  processAudibleRefresh: vi.fn().mockResolvedValue('ok'),
  processRetryMissingTorrents: vi.fn().mockResolvedValue('ok'),
  processRetryFailedImports: vi.fn().mockResolvedValue('ok'),
  processCleanupSeededTorrents: vi.fn().mockResolvedValue('ok'),
  processSyncShelves: vi.fn().mockResolvedValue('ok'),
  // Ebook processors
  processSearchEbook: vi.fn().mockResolvedValue('ok'),
  processStartDirectDownload: vi.fn().mockResolvedValue('ok'),
  processMonitorDirectDownload: vi.fn().mockResolvedValue('ok'),
}));

const queueMock = vi.hoisted(() => ({
  on: vi.fn(),
  process: vi.fn(),
  add: vi.fn(),
  getJobCounts: vi.fn(),
  getActive: vi.fn(),
  getJob: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  close: vi.fn(),
  removeRepeatable: vi.fn(),
  getRepeatableJobs: vi.fn(),
  setMaxListeners: vi.fn(),
}));

const redisMock = vi.hoisted(() => ({
  setMaxListeners: vi.fn(),
  disconnect: vi.fn(),
}));

const QueueConstructor = vi.hoisted(() =>
  vi.fn(function Queue() {
    return queueMock;
  })
);

const RedisConstructor = vi.hoisted(() =>
  vi.fn(function Redis() {
    return redisMock;
  })
);

vi.mock('bull', () => ({
  default: QueueConstructor,
}));

vi.mock('ioredis', () => ({
  default: RedisConstructor,
}));

vi.mock('@/lib/processors/search-indexers.processor', () => ({
  processSearchIndexers: processorsMock.processSearchIndexers,
}));

vi.mock('@/lib/processors/download-torrent.processor', () => ({
  processDownloadTorrent: processorsMock.processDownloadTorrent,
}));

vi.mock('@/lib/processors/monitor-download.processor', () => ({
  processMonitorDownload: processorsMock.processMonitorDownload,
}));

vi.mock('@/lib/processors/organize-files.processor', () => ({
  processOrganizeFiles: processorsMock.processOrganizeFiles,
}));

vi.mock('@/lib/processors/scan-plex.processor', () => ({
  processScanPlex: processorsMock.processScanPlex,
}));

vi.mock('@/lib/processors/match-plex.processor', () => ({
  processMatchPlex: processorsMock.processMatchPlex,
}));

vi.mock('@/lib/processors/plex-recently-added.processor', () => ({
  processPlexRecentlyAddedCheck: processorsMock.processPlexRecentlyAddedCheck,
}));

vi.mock('@/lib/processors/monitor-rss-feeds.processor', () => ({
  processMonitorRssFeeds: processorsMock.processMonitorRssFeeds,
}));

vi.mock('@/lib/processors/audible-refresh.processor', () => ({
  processAudibleRefresh: processorsMock.processAudibleRefresh,
}));

vi.mock('@/lib/processors/retry-missing-torrents.processor', () => ({
  processRetryMissingTorrents: processorsMock.processRetryMissingTorrents,
}));

vi.mock('@/lib/processors/retry-failed-imports.processor', () => ({
  processRetryFailedImports: processorsMock.processRetryFailedImports,
}));

vi.mock('@/lib/processors/cleanup-seeded-torrents.processor', () => ({
  processCleanupSeededTorrents: processorsMock.processCleanupSeededTorrents,
}));

vi.mock('@/lib/processors/sync-shelves.processor', () => ({
  processSyncShelves: processorsMock.processSyncShelves,
}));

// Ebook processors
vi.mock('@/lib/processors/search-ebook.processor', () => ({
  processSearchEbook: processorsMock.processSearchEbook,
}));

vi.mock('@/lib/processors/direct-download.processor', () => ({
  processStartDirectDownload: processorsMock.processStartDirectDownload,
  processMonitorDirectDownload: processorsMock.processMonitorDirectDownload,
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

describe('JobQueueService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueMock.add.mockReset();
    queueMock.getJobCounts.mockReset();
    queueMock.getJob.mockReset();
    queueMock.getActive.mockReset();
    queueMock.process.mockReset();
    queueMock.on.mockReset();
    queueMock.getRepeatableJobs.mockReset();
    prismaMock.job.create.mockReset();
    prismaMock.job.update.mockReset();
    prismaMock.job.updateMany.mockReset();
    prismaMock.job.findUnique.mockReset();
    prismaMock.job.findFirst.mockReset();
    prismaMock.job.findMany.mockReset();
    prismaMock.scheduledJob.update.mockReset();
    prismaMock.request.update.mockReset();
    prismaMock.downloadHistory.update.mockReset();
  });

  it('adds search jobs with priority and stores Bull job ID', async () => {
    prismaMock.job.create.mockResolvedValue({ id: 'job-1' });
    queueMock.add.mockResolvedValue({ id: 'bull-1' });
    prismaMock.job.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const jobId = await service.addSearchJob('req-1', {
      id: 'ab-1',
      title: 'Title',
      author: 'Author',
      asin: 'ASIN1',
    });

    expect(jobId).toBe('job-1');
    expect(prismaMock.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: 'req-1',
          type: 'search_indexers',
          priority: 10,
        }),
      })
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      'search_indexers',
      expect.objectContaining({ jobId: 'job-1', requestId: 'req-1' }),
      expect.objectContaining({ priority: 10 })
    );
    expect(prismaMock.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { bullJobId: 'bull-1' },
    });
  });

  it('adds download jobs with expected priority', async () => {
    prismaMock.job.create.mockResolvedValue({ id: 'job-2' });
    queueMock.add.mockResolvedValue({ id: 'bull-2' });
    prismaMock.job.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    await service.addDownloadJob('req-1', { id: 'ab-1', title: 'Title', author: 'Author' }, { hash: 'hash' } as any);

    expect(queueMock.add).toHaveBeenCalledWith(
      'download_torrent',
      expect.objectContaining({ requestId: 'req-1', jobId: 'job-2' }),
      expect.objectContaining({ priority: 9 })
    );
  });

  it('adds monitor jobs with delay in milliseconds', async () => {
    prismaMock.job.create.mockResolvedValue({ id: 'job-3' });
    queueMock.add.mockResolvedValue({ id: 'bull-3' });
    prismaMock.job.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    await service.addMonitorJob('req-2', 'hist-1', 'client-1', 'qbittorrent', 15);

    expect(queueMock.add).toHaveBeenCalledWith(
      'monitor_download',
      expect.objectContaining({ requestId: 'req-2', jobId: 'job-3' }),
      expect.objectContaining({ priority: 5, delay: 15000 })
    );
  });

  it('adds organize jobs with target path payload', async () => {
    prismaMock.job.create.mockResolvedValue({ id: 'job-4' });
    queueMock.add.mockResolvedValue({ id: 'bull-4' });
    prismaMock.job.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    await service.addOrganizeJob('req-3', 'ab-3', '/downloads/book', '/media/book');

    expect(queueMock.add).toHaveBeenCalledWith(
      'organize_files',
      expect.objectContaining({ requestId: 'req-3', targetPath: '/media/book', jobId: 'job-4' }),
      expect.objectContaining({ priority: 8 })
    );
  });

  it('adds plex and scheduled jobs with expected priorities', async () => {
    const jobIds = ['job-5', 'job-6', 'job-7', 'job-8', 'job-9', 'job-10', 'job-11', 'job-12'];
    jobIds.forEach((id) => prismaMock.job.create.mockResolvedValueOnce({ id }));
    queueMock.add.mockResolvedValue({ id: 'bull' });
    prismaMock.job.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();

    await service.addPlexScanJob('lib-1', true, '/path');
    await service.addPlexRecentlyAddedJob('sched-1');
    await service.addMonitorRssFeedsJob('sched-2');
    await service.addAudibleRefreshJob('sched-3');
    await service.addRetryMissingTorrentsJob('sched-4');
    await service.addRetryFailedImportsJob('sched-5');
    await service.addCleanupSeededTorrentsJob('sched-6');

    expect(queueMock.add.mock.calls[0][0]).toBe('scan_plex');
    expect(queueMock.add.mock.calls[0][2].priority).toBe(7);
    expect(queueMock.add.mock.calls[0][1]).toEqual(expect.objectContaining({ libraryId: 'lib-1', partial: true, path: '/path' }));

    expect(queueMock.add.mock.calls[1][0]).toBe('plex_recently_added_check');
    expect(queueMock.add.mock.calls[1][2].priority).toBe(8);

    expect(queueMock.add.mock.calls[2][0]).toBe('monitor_rss_feeds');
    expect(queueMock.add.mock.calls[2][2].priority).toBe(8);

    expect(queueMock.add.mock.calls[3][0]).toBe('audible_refresh');
    expect(queueMock.add.mock.calls[3][2].priority).toBe(9);

    expect(queueMock.add.mock.calls[4][0]).toBe('retry_missing_torrents');
    expect(queueMock.add.mock.calls[4][2].priority).toBe(7);

    expect(queueMock.add.mock.calls[5][0]).toBe('retry_failed_imports');
    expect(queueMock.add.mock.calls[5][2].priority).toBe(7);

    expect(queueMock.add.mock.calls[6][0]).toBe('cleanup_seeded_torrents');
    expect(queueMock.add.mock.calls[6][2].priority).toBe(10);
  });

  it('returns queue stats with safe defaults', async () => {
    queueMock.getJobCounts.mockResolvedValue({ waiting: 2, active: 1 });

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const stats = await service.getQueueStats();

    expect(stats).toEqual({
      waiting: 2,
      active: 1,
      completed: 0,
      failed: 0,
      delayed: 0,
    });
  });

  it('returns a single job by ID', async () => {
    prismaMock.job.findUnique.mockResolvedValue({ id: 'job-10' });

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const job = await service.getJob('job-10');

    expect(prismaMock.job.findUnique).toHaveBeenCalledWith({ where: { id: 'job-10' } });
    expect(job).toEqual({ id: 'job-10' });
  });

  it('returns jobs for a request ordered by createdAt', async () => {
    prismaMock.job.findMany.mockResolvedValue([{ id: 'job-11' }]);

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const jobs = await service.getJobsByRequest('req-10');

    expect(prismaMock.job.findMany).toHaveBeenCalledWith({
      where: { requestId: 'req-10' },
      orderBy: { createdAt: 'desc' },
    });
    expect(jobs).toEqual([{ id: 'job-11' }]);
  });

  it('retries a failed job and resets metadata', async () => {
    prismaMock.job.findUnique.mockResolvedValue({ id: 'job-1', bullJobId: 'bull-1' });
    queueMock.getJob.mockResolvedValue({ retry: vi.fn() });
    prismaMock.job.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    await service.retryJob('job-1');

    expect(queueMock.getJob).toHaveBeenCalledWith('bull-1');
    expect(prismaMock.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        status: 'pending',
        attempts: 0,
        errorMessage: null,
        stackTrace: null,
      },
    });
  });

  it('throws when retrying an unknown job', async () => {
    prismaMock.job.findUnique.mockResolvedValue(null);

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();

    await expect(service.retryJob('missing')).rejects.toThrow('Job not found');
  });

  it('cancels jobs and removes Bull entry', async () => {
    prismaMock.job.findUnique.mockResolvedValue({ id: 'job-2', bullJobId: 'bull-2' });
    queueMock.getJob.mockResolvedValue({ remove: vi.fn() });
    prismaMock.job.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    await service.cancelJob('job-2');

    expect(queueMock.getJob).toHaveBeenCalledWith('bull-2');
    expect(prismaMock.job.update).toHaveBeenCalledWith({
      where: { id: 'job-2' },
      data: { status: 'cancelled' },
    });
  });

  it('adds and removes repeatable jobs', async () => {
    queueMock.add.mockResolvedValue({});
    queueMock.removeRepeatable.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    await service.addRepeatableJob('audible_refresh', { scheduledJobId: 'sched-1' }, '0 0 * * *', 'scheduled-1');
    await service.removeRepeatableJob('audible_refresh', '0 0 * * *', 'scheduled-1');

    expect(queueMock.add).toHaveBeenCalledWith(
      'audible_refresh',
      { scheduledJobId: 'sched-1' },
      { repeat: { cron: '0 0 * * *' }, jobId: 'scheduled-1' }
    );
    expect(queueMock.removeRepeatable).toHaveBeenCalledWith('audible_refresh', {
      cron: '0 0 * * *',
      jobId: 'scheduled-1',
    });
  });

  it('creates job records for timer-triggered jobs', async () => {
    prismaMock.job.findFirst.mockResolvedValue(null);
    prismaMock.job.create.mockResolvedValue({ id: 'job-3' });
    prismaMock.scheduledJob.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const payload = await (service as any).ensureJobRecord(
      { id: 'bull-3', data: { scheduledJobId: 'sched-3' } },
      'audible_refresh'
    );

    expect(prismaMock.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bullJobId: 'bull-3',
          type: 'audible_refresh',
        }),
      })
    );
    expect(prismaMock.scheduledJob.update).toHaveBeenCalledWith({
      where: { id: 'sched-3' },
      data: { lastRun: expect.any(Date) },
    });
    expect(payload.jobId).toBe('job-3');
  });

  it('returns existing job IDs for scheduled jobs already in the database', async () => {
    prismaMock.job.findFirst.mockResolvedValue({ id: 'job-4' });
    prismaMock.scheduledJob.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const payload = await (service as any).ensureJobRecord(
      { id: 'bull-4', data: { scheduledJobId: 'sched-4' } },
      'cleanup_seeded_torrents'
    );

    expect(payload.jobId).toBe('job-4');
    expect(prismaMock.scheduledJob.update).toHaveBeenCalledWith({
      where: { id: 'sched-4' },
      data: { lastRun: expect.any(Date) },
    });
  });

  it('returns payload unchanged when jobId already exists', async () => {
    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const payload = await (service as any).ensureJobRecord(
      { id: 'bull-5', data: { jobId: 'job-5' } },
      'audible_refresh'
    );

    expect(payload.jobId).toBe('job-5');
    expect(prismaMock.job.findFirst).not.toHaveBeenCalled();
  });

  it('updates job metadata on lifecycle events', async () => {
    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const updateSpy = vi.spyOn(service as any, 'updateJobInDatabase').mockResolvedValue(undefined);

    const handlers = Object.fromEntries(queueMock.on.mock.calls.map(([event, handler]) => [event, handler]));

    await handlers.active({ id: 'bull-10' });
    await handlers.completed({ id: 'bull-10' }, { ok: true });
    await handlers.stalled({ id: 'bull-10' });

    expect(updateSpy).toHaveBeenCalledWith('bull-10', 'active');
    expect(updateSpy).toHaveBeenCalledWith('bull-10', 'completed', { ok: true });
    expect(updateSpy).toHaveBeenCalledWith('bull-10', 'stuck');
  });

  it('marks monitor download failures and updates request status', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    new JobQueueService();

    const handlers = Object.fromEntries(queueMock.on.mock.calls.map(([event, handler]) => [event, handler]));
    await handlers.failed(
      {
        id: 'bull-11',
        name: 'monitor_download',
        data: { requestId: 'req-1', downloadHistoryId: 'hist-1' },
        attemptsMade: 3,
      },
      new Error('Monitor failed')
    );

    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hist-1' },
        data: expect.objectContaining({ downloadStatus: 'failed' }),
      })
    );
  });

  it('updates database fields for completed jobs', async () => {
    prismaMock.job.updateMany.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    await (service as any).updateJobInDatabase('bull-12', 'completed', { result: true }, 'err', 'stack');

    expect(prismaMock.job.updateMany).toHaveBeenCalledWith({
      where: { bullJobId: 'bull-12' },
      data: expect.objectContaining({
        status: 'completed',
        result: { result: true },
        errorMessage: 'err',
        stackTrace: 'stack',
      }),
    });
  });

  it('sets startedAt when jobs become active', async () => {
    prismaMock.job.updateMany.mockResolvedValue({});

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    await (service as any).updateJobInDatabase('bull-13', 'active');

    expect(prismaMock.job.updateMany).toHaveBeenCalledWith({
      where: { bullJobId: 'bull-13' },
      data: expect.objectContaining({
        status: 'active',
        startedAt: expect.any(Date),
      }),
    });
  });

  it('swallows database errors when updating job status', async () => {
    prismaMock.job.updateMany.mockRejectedValue(new Error('db down'));

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();

    await expect((service as any).updateJobInDatabase('bull-14', 'completed')).resolves.toBeUndefined();
  });

  it('registers processors for supported job types', async () => {
    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    new JobQueueService();

    const jobTypes = queueMock.process.mock.calls.map(([type]) => type);
    expect(jobTypes).toContain('search_indexers');
    expect(jobTypes).toContain('download_torrent');
    expect(jobTypes).toContain('monitor_download');
    expect(jobTypes).toContain('audible_refresh');
  });

  it('invokes processor handlers for registered jobs', async () => {
    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    new JobQueueService();

    const handlers = queueMock.process.mock.calls.map((call) => call[2] || call[1]);
    for (const handler of handlers) {
      await handler({ id: 'bull-processor', data: { jobId: 'job-processor', scheduledJobId: 'sched-1' } });
    }

    expect(processorsMock.processSearchIndexers).toHaveBeenCalled();
    expect(processorsMock.processDownloadTorrent).toHaveBeenCalled();
    expect(processorsMock.processMonitorDownload).toHaveBeenCalled();
    expect(processorsMock.processOrganizeFiles).toHaveBeenCalled();
    expect(processorsMock.processScanPlex).toHaveBeenCalled();
    expect(processorsMock.processPlexRecentlyAddedCheck).toHaveBeenCalled();
    expect(processorsMock.processMonitorRssFeeds).toHaveBeenCalled();
    expect(processorsMock.processAudibleRefresh).toHaveBeenCalled();
    expect(processorsMock.processRetryMissingTorrents).toHaveBeenCalled();
    expect(processorsMock.processRetryFailedImports).toHaveBeenCalled();
    expect(processorsMock.processCleanupSeededTorrents).toHaveBeenCalled();
    expect(processorsMock.processSyncShelves).toHaveBeenCalled();
  });

  it('returns repeatable jobs from the queue', async () => {
    queueMock.getRepeatableJobs.mockResolvedValue([{ key: 'job-1' }]);

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const jobs = await service.getRepeatableJobs();

    expect(queueMock.getRepeatableJobs).toHaveBeenCalled();
    expect(jobs).toEqual([{ key: 'job-1' }]);
  });

  it('returns active jobs from prisma using Bull job IDs', async () => {
    queueMock.getActive.mockResolvedValue([{ id: 'bull-20' }, { id: 'bull-21' }]);
    prismaMock.job.findMany.mockResolvedValue([{ id: 'job-20' }]);

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const jobs = await service.getActiveJobs();

    expect(prismaMock.job.findMany).toHaveBeenCalledWith({
      where: { bullJobId: { in: ['bull-20', 'bull-21'] } },
    });
    expect(jobs).toEqual([{ id: 'job-20' }]);
  });

  it('returns failed jobs with limit', async () => {
    prismaMock.job.findMany.mockResolvedValue([{ id: 'job-30' }]);

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();
    const jobs = await service.getFailedJobs(10);

    expect(prismaMock.job.findMany).toHaveBeenCalledWith({
      where: { status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    expect(jobs).toEqual([{ id: 'job-30' }]);
  });

  it('throws when cancelling unknown jobs', async () => {
    prismaMock.job.findUnique.mockResolvedValue(null);

    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();

    await expect(service.cancelJob('missing')).rejects.toThrow('Job not found');
  });

  it('pauses and resumes the queue', async () => {
    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();

    await service.pauseQueue();
    await service.resumeQueue();

    expect(queueMock.pause).toHaveBeenCalled();
    expect(queueMock.resume).toHaveBeenCalled();
  });

  it('closes the queue and disconnects redis', async () => {
    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();

    await service.close();

    expect(queueMock.close).toHaveBeenCalled();
    expect(redisMock.disconnect).toHaveBeenCalled();
  });
});
