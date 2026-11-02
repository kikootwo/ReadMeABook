/**
 * Component: Scheduler orphaned repeatable job tests (#222)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * A Bull repeatable job whose scheduled_jobs row is gone (database reset, row deleted
 * while Redis kept the schedule) fires forever. Startup removes it and leaves the
 * repeatable jobs of rows that exist alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({
  addRepeatableJob: vi.fn(),
  removeRepeatableJob: vi.fn(),
  getRepeatableJobs: vi.fn(),
  removeRepeatableJobByKey: vi.fn(),
}));
const notificationServiceMock = vi.hoisted(() => ({
  reEncryptUnprotectedBackends: vi.fn().mockResolvedValue(0),
  migrateStoredSecrets: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => log, forJob: () => log } }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/notification', () => ({ getNotificationService: () => notificationServiceMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const LIVE = {
  id: 'live-1',
  name: 'Recently Added Check',
  type: 'plex_recently_added_check',
  schedule: '*/5 * * * *',
  enabled: true,
  payload: {},
  lastRun: new Date(), // not overdue, so startup triggers nothing
};
const DISABLED = { ...LIVE, id: 'off-2', name: 'Library Scan', type: 'plex_library_scan', schedule: '0 */6 * * *', enabled: false };

const repeatable = (name: string, id: string | null, cron: string) => ({
  key: `${name}:${id ?? ''}::${cron}`,
  name,
  id,
  cron,
  every: 0,
  next: Date.now() + 60_000,
});

const LIVE_REPEAT = repeatable('plex_recently_added_check', 'scheduled-live-1', '*/5 * * * *');
const DISABLED_ROW_REPEAT = repeatable('plex_library_scan', 'scheduled-off-2', '0 */6 * * *');
const ORPHAN_REPEAT = repeatable('plex_recently_added_check', 'scheduled-06b538a9-gone', '*/5 * * * *');
const FOREIGN_REPEAT = repeatable('some_other_job', null, '0 0 * * *');

describe('scheduler startup: orphaned repeatable jobs (#222)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const rows = [LIVE, DISABLED];
    prismaMock.scheduledJob.findFirst.mockResolvedValue({ id: 'exists' }); // defaults already present
    prismaMock.scheduledJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.scheduledJob.findMany.mockImplementation(async (a?: { where?: { type?: { in?: string[] }; enabled?: boolean } }) => {
      if (a?.where?.type?.in) return []; // no deprecated jobs
      if (a?.where?.enabled === true) return rows.filter((r) => r.enabled);
      return rows;
    });
    jobQueueMock.addRepeatableJob.mockResolvedValue(undefined);
    jobQueueMock.removeRepeatableJobByKey.mockResolvedValue(undefined);
    jobQueueMock.getRepeatableJobs.mockResolvedValue([LIVE_REPEAT, DISABLED_ROW_REPEAT, ORPHAN_REPEAT, FOREIGN_REPEAT]);
  });

  it('removes a repeatable job whose schedule row is gone and keeps the ones whose row exists', async () => {
    const { SchedulerService } = await import('@/lib/services/scheduler.service');
    await new SchedulerService().start();

    expect(jobQueueMock.removeRepeatableJobByKey).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.removeRepeatableJobByKey).toHaveBeenCalledWith(ORPHAN_REPEAT.key);
    const logged = log.info.mock.calls.map((c) => String(c[0]));
    expect(logged.some((m) => m.includes('scheduled-06b538a9-gone'))).toBe(true);
    // The live schedule is still (re)scheduled as before
    expect(jobQueueMock.addRepeatableJob).toHaveBeenCalledWith(
      'plex_recently_added_check',
      { scheduledJobId: 'live-1' },
      '*/5 * * * *',
      'scheduled-live-1'
    );
  });

  it('keeps startup going when the repeatable job check fails', async () => {
    jobQueueMock.getRepeatableJobs.mockRejectedValue(new Error('redis down'));
    const { SchedulerService } = await import('@/lib/services/scheduler.service');

    await expect(new SchedulerService().start()).resolves.toBeUndefined();
    expect(jobQueueMock.removeRepeatableJobByKey).not.toHaveBeenCalled();
    expect(log.error.mock.calls.some((c) => String(c[0]).includes('orphaned repeatable'))).toBe(true);
  });
});
