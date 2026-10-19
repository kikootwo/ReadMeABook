/**
 * Component: Process-wide Singleton Tests (module evaluated twice in one process)
 * Documentation: documentation/backend/services/scheduler.md
 */

import { describe, expect, it, vi } from 'vitest';

const queueInstances = vi.hoisted(() => [] as unknown[]);
const processRegistrations = vi.hoisted(() => ({ count: 0 }));
const prismaConstructions = vi.hoisted(() => ({ count: 0 }));

vi.mock('bull', () => ({
  default: vi.fn(function Queue(this: unknown) {
    const queue = {
      on: () => undefined,
      process: () => { processRegistrations.count++; },
      setMaxListeners: () => undefined,
      close: async () => undefined,
    };
    queueInstances.push(queue);
    return queue;
  }),
}));
vi.mock('ioredis', () => ({
  default: vi.fn(function Redis() {
    return { setMaxListeners: () => undefined, disconnect: () => undefined, on: () => undefined };
  }),
}));
vi.mock('@/generated/prisma/client', () => ({
  PrismaClient: vi.fn(function PrismaClient() {
    prismaConstructions.count++;
    return { $disconnect: async () => undefined };
  }),
}));

describe('process-wide singletons survive a second module instance', () => {
  it('Prisma, job queue and scheduler are created once even when their modules load twice', async () => {
    const first = {
      db: await import('@/lib/db'),
      jobs: await import('@/lib/services/job-queue.service'),
      scheduler: await import('@/lib/services/scheduler.service'),
    };
    const queueA = first.jobs.getJobQueueService();
    const schedulerA = first.scheduler.getSchedulerService();
    const registrationsAfterFirst = processRegistrations.count;

    // Fresh module registry = a second evaluation of every module in the same process
    vi.resetModules();
    const second = {
      db: await import('@/lib/db'),
      jobs: await import('@/lib/services/job-queue.service'),
      scheduler: await import('@/lib/services/scheduler.service'),
    };

    expect(second.jobs).not.toBe(first.jobs);
    expect(second.jobs.getJobQueueService()).toBe(queueA);
    expect(second.scheduler.getSchedulerService()).toBe(schedulerA);
    expect(second.db.prisma).toBe(first.db.prisma);

    expect(queueInstances).toHaveLength(1);
    expect(registrationsAfterFirst).toBeGreaterThan(0);
    expect(processRegistrations.count).toBe(registrationsAfterFirst);
    expect(prismaConstructions.count).toBe(1);
  });
});
