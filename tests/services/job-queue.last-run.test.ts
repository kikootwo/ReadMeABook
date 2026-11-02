/**
 * Component: Job Queue lastRun update for a missing schedule row (#222)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * A timer-triggered job whose scheduled_jobs row is gone must not throw or log an
 * error on every run: one warning per schedule id, then quiet.
 */

import { Prisma } from '@/generated/prisma';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
const queueMock = vi.hoisted(() => ({
  on: vi.fn(),
  process: vi.fn(),
  add: vi.fn(),
  removeRepeatable: vi.fn(),
  removeRepeatableByKey: vi.fn(),
  getRepeatableJobs: vi.fn(),
  setMaxListeners: vi.fn(),
  close: vi.fn(),
}));
const redisMock = vi.hoisted(() => ({ setMaxListeners: vi.fn(), disconnect: vi.fn() }));

vi.mock('bull', () => ({ default: vi.fn(function Queue() { return queueMock; }) }));
vi.mock('ioredis', () => ({ default: vi.fn(function Redis() { return redisMock; }) }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => log, forJob: () => log } }));

/** ensureJobRecord is private; the timer-triggered path is what this file exercises. */
type EnsureJobRecord = (job: { id: string; data: Record<string, unknown> }, type: string) => Promise<Record<string, unknown>>;
const ensureJobRecordOf = (service: object): EnsureJobRecord =>
  (service as unknown as { ensureJobRecord: EnsureJobRecord }).ensureJobRecord.bind(service);

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError(
    'An operation failed because it depends on one or more records that were required but not found. No record was found for an update.',
    { code: 'P2025', clientVersion: 'test' }
  );

describe('ensureJobRecord: lastRun for a deleted schedule row (#222)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.job.findFirst.mockResolvedValue(null);
    prismaMock.job.create.mockImplementation(async () => ({ id: `job-${prismaMock.job.create.mock.calls.length}` }));
    prismaMock.scheduledJob.update.mockRejectedValue(notFound());
  });

  it('does not throw, warns once per schedule id, and logs no error', async () => {
    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();

    for (const bullId of ['repeat:a:1', 'repeat:a:2', 'repeat:a:3']) {
      await expect(
        ensureJobRecordOf(service)({ id: bullId, data: { scheduledJobId: 'gone-1' } }, 'plex_recently_added_check')
      ).resolves.toMatchObject({ scheduledJobId: 'gone-1' });
    }

    expect(prismaMock.scheduledJob.update).toHaveBeenCalledTimes(3);
    expect(log.error).not.toHaveBeenCalled();
    const warnings = log.warn.mock.calls.filter((c) => String(c[0]).includes('gone-1'));
    expect(warnings).toHaveLength(1);
  });

  it('still logs other lastRun failures as errors', async () => {
    prismaMock.scheduledJob.update.mockRejectedValue(new Error('connection reset'));
    const { JobQueueService } = await import('@/lib/services/job-queue.service');
    const service = new JobQueueService();

    await ensureJobRecordOf(service)({ id: 'repeat:b:1', data: { scheduledJobId: 'sched-2' } }, 'audible_refresh');

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
