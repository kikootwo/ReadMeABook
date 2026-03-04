/**
 * Component: Scheduler Service Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

const jobQueueMock = vi.hoisted(() => ({
  addRepeatableJob: vi.fn(),
  removeRepeatableJob: vi.fn(),
  addPlexScanJob: vi.fn(),
  addPlexRecentlyAddedJob: vi.fn(),
  addAudibleRefreshJob: vi.fn(),
  addRetryMissingTorrentsJob: vi.fn(),
  addRetryFailedImportsJob: vi.fn(),
  addCleanupSeededTorrentsJob: vi.fn(),
  addMonitorRssFeedsJob: vi.fn(),
  addSyncGoodreadsShelvesJob: vi.fn(),
}));

const configServiceMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  getMany: vi.fn(),
}));

const notificationServiceMock = vi.hoisted(() => ({
  reEncryptUnprotectedBackends: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/services/notification', () => ({
  getNotificationService: () => notificationServiceMock,
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

describe('SchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.scheduledJob.findFirst.mockReset();
    prismaMock.scheduledJob.create.mockReset();
    prismaMock.scheduledJob.findMany.mockReset();
    prismaMock.scheduledJob.findUnique.mockReset();
    prismaMock.scheduledJob.update.mockReset();
    prismaMock.scheduledJob.delete.mockReset();
    configServiceMock.getBackendMode.mockReset();
    configServiceMock.getMany.mockReset();
  });

  it('initializes defaults and schedules enabled jobs', async () => {
    prismaMock.scheduledJob.findFirst.mockResolvedValue(null);
    prismaMock.scheduledJob.create.mockResolvedValue({});
    prismaMock.scheduledJob.findMany
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          name: 'Audible Data Refresh',
          type: 'audible_refresh',
          schedule: '0 0 * * *',
          enabled: true,
        },
      ])
      .mockResolvedValueOnce([]);

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    await service.start();

    expect(prismaMock.scheduledJob.create).toHaveBeenCalledTimes(9);
    expect(jobQueueMock.addRepeatableJob).toHaveBeenCalledWith(
      'audible_refresh',
      { scheduledJobId: 'job-1' },
      '0 0 * * *',
      'scheduled-job-1'
    );
  });

  it('rejects invalid cron expressions', async () => {
    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();

    await expect(
      service.createScheduledJob({
        name: 'Bad job',
        type: 'audible_refresh',
        schedule: 'bad',
      })
    ).rejects.toThrow('Invalid cron expression format');
  });

  it('creates and schedules enabled jobs', async () => {
    prismaMock.scheduledJob.create.mockResolvedValue({
      id: 'job-2',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: true,
      payload: {},
    });

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    await service.createScheduledJob({
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: true,
    });

    expect(jobQueueMock.addRepeatableJob).toHaveBeenCalledWith(
      'audible_refresh',
      { scheduledJobId: 'job-2' },
      '0 0 * * *',
      'scheduled-job-2'
    );
  });

  it('returns scheduled jobs and single jobs', async () => {
    prismaMock.scheduledJob.findMany.mockResolvedValue([{ id: 'job-2' }]);
    prismaMock.scheduledJob.findUnique.mockResolvedValue({ id: 'job-2' });

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    const jobs = await service.getScheduledJobs();
    const job = await service.getScheduledJob('job-2');

    expect(prismaMock.scheduledJob.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
    expect(prismaMock.scheduledJob.findUnique).toHaveBeenCalledWith({ where: { id: 'job-2' } });
    expect(jobs).toEqual([{ id: 'job-2' }]);
    expect(job).toEqual({ id: 'job-2' });
  });

  it('updates jobs and reschedules when enabled', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-3',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: true,
      payload: {},
    });
    prismaMock.scheduledJob.update.mockResolvedValue({
      id: 'job-3',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '*/15 * * * *',
      enabled: true,
      payload: {},
    });

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    await service.updateScheduledJob('job-3', { schedule: '*/15 * * * *' });

    expect(jobQueueMock.removeRepeatableJob).toHaveBeenCalledWith(
      'audible_refresh',
      '0 0 * * *',
      'scheduled-job-3'
    );
    expect(jobQueueMock.addRepeatableJob).toHaveBeenCalledWith(
      'audible_refresh',
      { scheduledJobId: 'job-3' },
      '*/15 * * * *',
      'scheduled-job-3'
    );
  });

  it('unschedules jobs when disabling updates', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-3b',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: true,
      payload: {},
    });
    prismaMock.scheduledJob.update.mockResolvedValue({
      id: 'job-3b',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: false,
      payload: {},
    });

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    await service.updateScheduledJob('job-3b', { enabled: false });

    expect(jobQueueMock.removeRepeatableJob).toHaveBeenCalledWith(
      'audible_refresh',
      '0 0 * * *',
      'scheduled-job-3b'
    );
    expect(jobQueueMock.addRepeatableJob).not.toHaveBeenCalled();
  });

  it('triggers Plex scan jobs with validated config', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-4',
      name: 'Library Scan',
      type: 'plex_library_scan',
      schedule: '0 */6 * * *',
      enabled: true,
      payload: {},
    });
    configServiceMock.getBackendMode.mockResolvedValue('plex');
    configServiceMock.getMany.mockResolvedValue({
      plex_url: 'http://plex',
      plex_token: 'token',
      plex_audiobook_library_id: 'lib-1',
    });
    jobQueueMock.addPlexScanJob.mockResolvedValue('bull-1');
    prismaMock.scheduledJob.update.mockResolvedValue({});

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    const jobId = await service.triggerJobNow('job-4');

    expect(jobId).toBe('bull-1');
    expect(jobQueueMock.addPlexScanJob).toHaveBeenCalledWith('lib-1', undefined, undefined);
    expect(prismaMock.scheduledJob.update).toHaveBeenCalledWith({
      where: { id: 'job-4' },
      data: {
        lastRun: expect.any(Date),
        lastRunJobId: 'bull-1',
      },
    });
  });

  it('triggers Audiobookshelf scans when configured', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-4b',
      name: 'Library Scan',
      type: 'plex_library_scan',
      schedule: '0 */6 * * *',
      enabled: true,
      payload: { libraryId: 'abs-lib' },
    });
    configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configServiceMock.getMany.mockResolvedValue({
      'audiobookshelf.server_url': 'http://abs',
      'audiobookshelf.api_token': 'token',
      'audiobookshelf.library_id': 'abs-lib-2',
    });
    jobQueueMock.addPlexScanJob.mockResolvedValue('bull-abs');
    prismaMock.scheduledJob.update.mockResolvedValue({});

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    const jobId = await service.triggerJobNow('job-4b');

    expect(jobId).toBe('bull-abs');
    expect(jobQueueMock.addPlexScanJob).toHaveBeenCalledWith('abs-lib', undefined, undefined);
  });

  it('throws on unknown scheduled job types', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-5',
      name: 'Mystery',
      type: 'unknown',
      schedule: '* * * * *',
      enabled: true,
      payload: {},
    });

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();

    await expect(service.triggerJobNow('job-5')).rejects.toThrow('Unknown job type');
  });

  it.each([
    ['plex_recently_added_check', 'addPlexRecentlyAddedJob'],
    ['audible_refresh', 'addAudibleRefreshJob'],
    ['retry_missing_torrents', 'addRetryMissingTorrentsJob'],
    ['retry_failed_imports', 'addRetryFailedImportsJob'],
    ['cleanup_seeded_torrents', 'addCleanupSeededTorrentsJob'],
    ['monitor_rss_feeds', 'addMonitorRssFeedsJob'],
    ['sync_goodreads_shelves', 'addSyncGoodreadsShelvesJob'],
  ])('triggers %s jobs with job queue', async (type, queueMethod) => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-type',
      name: 'Job',
      type,
      schedule: '* * * * *',
      enabled: true,
      payload: {},
    });
    (jobQueueMock as any)[queueMethod].mockResolvedValue('bull-type');
    prismaMock.scheduledJob.update.mockResolvedValue({});

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    const jobId = await service.triggerJobNow('job-type');

    expect(jobId).toBe('bull-type');
    expect((jobQueueMock as any)[queueMethod]).toHaveBeenCalledWith('job-type');
  });

  it('parses cron intervals for common patterns', async () => {
    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();

    expect((service as any).getIntervalFromCron('*/15 * * * *')).toBe(15 * 60 * 1000);
    expect((service as any).getIntervalFromCron('0 */6 * * *')).toBe(6 * 60 * 60 * 1000);
    expect((service as any).getIntervalFromCron('0 4 * * *')).toBe(24 * 60 * 60 * 1000);
    expect((service as any).getIntervalFromCron('0 4 * * 1')).toBe(7 * 24 * 60 * 60 * 1000);
    expect((service as any).getIntervalFromCron('invalid cron')).toBeNull();
  });

  it('does not schedule disabled jobs on creation', async () => {
    prismaMock.scheduledJob.create.mockResolvedValue({
      id: 'job-6',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: false,
      payload: {},
    });

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    await service.createScheduledJob({
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: false,
    });

    expect(jobQueueMock.addRepeatableJob).not.toHaveBeenCalled();
  });

  it('does not reschedule when updated job stays disabled', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-7',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: false,
      payload: {},
    });
    prismaMock.scheduledJob.update.mockResolvedValue({
      id: 'job-7',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 1 * * *',
      enabled: false,
      payload: {},
    });

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    await service.updateScheduledJob('job-7', { schedule: '0 1 * * *', enabled: false });

    expect(jobQueueMock.removeRepeatableJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addRepeatableJob).not.toHaveBeenCalled();
  });

  it('unschedules jobs when deleted', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-8',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: true,
      payload: {},
    });
    prismaMock.scheduledJob.delete.mockResolvedValue({});

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    await service.deleteScheduledJob('job-8');

    expect(jobQueueMock.removeRepeatableJob).toHaveBeenCalledWith(
      'audible_refresh',
      '0 0 * * *',
      'scheduled-job-8'
    );
    expect(prismaMock.scheduledJob.delete).toHaveBeenCalled();
  });

  it('deletes disabled jobs without unscheduling', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-8b',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '0 0 * * *',
      enabled: false,
      payload: {},
    });
    prismaMock.scheduledJob.delete.mockResolvedValue({});

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    await service.deleteScheduledJob('job-8b');

    expect(jobQueueMock.removeRepeatableJob).not.toHaveBeenCalled();
    expect(prismaMock.scheduledJob.delete).toHaveBeenCalled();
  });

  it('triggers overdue jobs based on lastRun and schedule', async () => {
    const overdueJob = {
      id: 'job-9',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '*/5 * * * *',
      enabled: true,
      payload: {},
      lastRun: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };

    prismaMock.scheduledJob.findMany.mockResolvedValueOnce([overdueJob]);

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    const triggerSpy = vi.spyOn(service, 'triggerJobNow').mockResolvedValue('bull-9');

    await (service as any).triggerOverdueJobs();

    expect(triggerSpy).toHaveBeenCalledWith('job-9');
  });

  it('logs and continues when overdue jobs fail to trigger', async () => {
    const overdueJob = {
      id: 'job-9b',
      name: 'Audible Data Refresh',
      type: 'audible_refresh',
      schedule: '*/5 * * * *',
      enabled: true,
      payload: {},
      lastRun: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };

    prismaMock.scheduledJob.findMany.mockResolvedValueOnce([overdueJob]);

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();
    const triggerSpy = vi.spyOn(service, 'triggerJobNow').mockRejectedValue(new Error('fail'));

    await expect((service as any).triggerOverdueJobs()).resolves.toBeUndefined();
    expect(triggerSpy).toHaveBeenCalledWith('job-9b');
  });
  it('identifies overdue jobs when lastRun is missing', async () => {
    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();

    const overdue = (service as any).isJobOverdue({
      name: 'No last run',
      schedule: '0 * * * *',
      lastRun: null,
    });

    expect(overdue).toBe(true);
  });

  it('returns false for unparseable cron intervals', async () => {
    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();

    const overdue = (service as any).isJobOverdue({
      name: 'Bad cron',
      schedule: 'bad',
      lastRun: new Date().toISOString(),
    });

    expect(overdue).toBe(false);
  });

  it('throws when Audiobookshelf scan configuration is missing', async () => {
    prismaMock.scheduledJob.findUnique.mockResolvedValue({
      id: 'job-10',
      name: 'Library Scan',
      type: 'plex_library_scan',
      schedule: '0 */6 * * *',
      enabled: true,
      payload: {},
    });
    configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configServiceMock.getMany.mockResolvedValue({
      'audiobookshelf.server_url': null,
      'audiobookshelf.api_token': null,
      'audiobookshelf.library_id': null,
    });

    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    const service = new SchedulerService();

    await expect(service.triggerJobNow('job-10')).rejects.toThrow('Audiobookshelf is not configured');
  });
});
