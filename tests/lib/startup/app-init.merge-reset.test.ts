/**
 * Component: App init, merge progress reset after a restart (#216)
 * Documentation: documentation/backend/services/scheduler.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const order = vi.hoisted(() => [] as string[]);
const resetMock = vi.hoisted(() => vi.fn());
const startMock = vi.hoisted(() => vi.fn(async () => { order.push('scheduler'); }));

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn(async () => [{ '?column?': 1 }]) } }));
vi.mock('ioredis', () => ({
  default: class {
    on() {}
    async connect() {}
    async ping() { return 'PONG'; }
    disconnect() {}
  },
}));
vi.mock('@/lib/services/credential-migration.service', () => ({
  runCredentialMigration: vi.fn(async () => { order.push('credentials'); }),
}));
vi.mock('@/lib/services/scheduler.service', () => ({ getSchedulerService: () => ({ start: startMock }) }));
vi.mock('@/lib/utils/merge-progress', () => ({ resetInterruptedMergeProgress: resetMock }));

describe('runAppInitOnce: merge progress reset', () => {
  beforeEach(() => {
    vi.resetModules();
    order.length = 0;
    resetMock.mockReset();
    // The once-per-process state lives on globalThis (process-singleton)
    delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('rmab.singleton.startup-init-state')];
  });

  const freshInit = () => import('@/lib/startup/app-init');

  it('resets processing requests cut mid-merge before the scheduler starts', async () => {
    resetMock.mockImplementation(async () => { order.push('reset'); return 2; });
    const { runAppInitOnce } = await freshInit();

    await expect(runAppInitOnce()).resolves.toBe('initialized');

    expect(order).toEqual(['credentials', 'reset', 'scheduler']);
  });

  it('a failed reset never stops the init', async () => {
    resetMock.mockRejectedValue(new Error('db busy'));
    const { runAppInitOnce } = await freshInit();

    await expect(runAppInitOnce()).resolves.toBe('initialized');

    expect(order).toEqual(['credentials', 'scheduler']);
  });
});
