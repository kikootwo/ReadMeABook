/**
 * Component: App Shutdown Coordinator Tests
 * Documentation: documentation/deployment/unified.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureHttpServer,
  createShutdownHandler,
  HTTP_REQUEST_CHANNEL,
  registerShutdownHandlers,
  type ShutdownDeps,
} from '@/lib/startup/shutdown-coordinator';
import { SHUTDOWN_DRAIN_MS, SHUTDOWN_HARD_DEADLINE_MS, SHUTDOWN_STEP_LIMIT_MS } from '@/lib/constants/shutdown';
import type { ActiveJobInfo } from '@/lib/services/job-activity-tracker';

const never = () => new Promise<never>(() => undefined);
const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function setup() {
  const order: string[] = [];
  const logs: string[] = [];
  let active: ActiveJobInfo[] = [];
  const server = {
    close: vi.fn((cb?: () => void) => {
      order.push('http.close');
      cb?.();
    }),
    closeAllConnections: vi.fn(() => order.push('http.closeAll')),
  };
  const queue = {
    pauseLocal: vi.fn(async () => {
      order.push('pause');
    }),
    whenCurrentJobsFinished: vi.fn(async () => {
      order.push('drain');
    }),
    activeJobs: vi.fn(() => active),
    close: vi.fn(async () => {
      order.push('queue.close');
    }),
    flushJobWrites: vi.fn(async () => {
      order.push('flush');
    }),
    disconnect: vi.fn(() => {
      order.push('redis.disconnect');
    }),
  };
  const prisma = {
    $disconnect: vi.fn(async () => {
      order.push('prisma.disconnect');
    }),
  };
  const exit = vi.fn((code: number) => {
    order.push(`exit ${code}`);
  });
  const deps: ShutdownDeps = {
    getServer: () => server,
    getQueue: () => {
      order.push('getQueue');
      return queue;
    },
    getPrisma: () => prisma,
    markStopping: () => order.push('markStopping'),
    exit,
    log: (level, message) => logs.push(`${level}: ${message}`),
    now: () => Date.now(),
  };
  return {
    order, logs, server, queue, prisma, exit, deps,
    setActive: (jobs: ActiveJobInfo[]) => {
      active = jobs;
    },
  };
}

const organizeJob: ActiveJobInfo = { id: '42', name: 'organize_files', requestId: 'req-1' };

describe('shutdown coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the steps in order and exits 0 within 100 ms when idle', async () => {
    const t = setup();
    createShutdownHandler(t.deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);

    expect(t.order).toEqual([
      'markStopping', 'getQueue', 'http.close', 'pause', 'drain', 'queue.close', 'flush', 'redis.disconnect', 'prisma.disconnect', 'exit 0',
    ]);
    expect(t.logs[0]).toBe(`info: SIGTERM received; stopping (limit ${SHUTDOWN_HARD_DEADLINE_MS} ms)`);
    expect(t.logs.at(-1)).toMatch(/^info: Done in \d+ ms \(finished 0, left 0 for retry\)$/);
  });

  it('waits for a job that finishes inside the drain window, then closes the queue', async () => {
    const t = setup();
    t.setActive([organizeJob]);
    t.queue.whenCurrentJobsFinished.mockImplementation(async () => {
      await after(1000);
      t.setActive([]);
    });

    createShutdownHandler(t.deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(999);
    expect(t.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);

    expect(t.exit).toHaveBeenCalledWith(0);
    expect(t.queue.close).toHaveBeenCalledTimes(1);
    expect(t.logs.at(-1)).toMatch(/\(finished 1, left 0 for retry\)$/);
  });

  it('leaves a job still running at the drain limit for retry, skips the queue close and exits 0 before the deadline', async () => {
    const t = setup();
    t.setActive([organizeJob]);
    t.queue.whenCurrentJobsFinished.mockImplementation(never);

    createShutdownHandler(t.deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DRAIN_MS - 1);
    expect(t.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);

    expect(t.exit.mock.calls).toEqual([[0]]);
    expect(t.logs).toContain('warn: Job 42 organize_files (request req-1) still running; left for retry on next start');
    expect(t.queue.close).not.toHaveBeenCalled();
    expect(t.queue.flushJobWrites).toHaveBeenCalled();
    expect(t.prisma.$disconnect).toHaveBeenCalled();
    expect(t.logs.at(-1)).toMatch(/\(finished 0, left 1 for retry\)$/);
  });

  it('closes open connections when requests outlast the drain window', async () => {
    const t = setup();
    t.server.close.mockImplementation(() => undefined); // close callback never fires

    createShutdownHandler(t.deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DRAIN_MS + 10);

    expect(t.server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(t.exit.mock.calls).toEqual([[0]]);
  });

  it.each([
    ['queue close', (t: ReturnType<typeof setup>) => t.queue.close.mockImplementation(never)],
    ['job-row flush', (t: ReturnType<typeof setup>) => t.queue.flushJobWrites.mockImplementation(never)],
    ['Prisma disconnect', (t: ReturnType<typeof setup>) => t.prisma.$disconnect.mockImplementation(never)],
  ])('a %s that never resolves is cut at its step limit', async (_label, hang) => {
    const t = setup();
    hang(t);

    createShutdownHandler(t.deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_STEP_LIMIT_MS + 50);

    expect(t.exit.mock.calls).toEqual([[0]]);
    expect(t.logs.some((l) => l.startsWith('warn:') && l.endsWith(': timeout'))).toBe(true);
  });

  it('exits 1 at the hard deadline when every step hangs', async () => {
    const t = setup();
    t.server.close.mockImplementation(() => undefined);
    t.queue.pauseLocal.mockImplementation(never);
    t.queue.close.mockImplementation(never);
    t.queue.flushJobWrites.mockImplementation(never);
    t.prisma.$disconnect.mockImplementation(never);

    createShutdownHandler(t.deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_HARD_DEADLINE_MS - 1);
    expect(t.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(t.exit.mock.calls[0]).toEqual([1]);
    expect(t.logs).toContain(`error: Stop did not finish within ${SHUTDOWN_HARD_DEADLINE_MS} ms; exiting now`);
  });

  it('ignores a second signal while stopping', async () => {
    const t = setup();
    const handler = createShutdownHandler(t.deps);
    handler('SIGTERM');
    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);

    expect(t.queue.pauseLocal).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledTimes(1);
    expect(t.logs).toContain('warn: SIGTERM received again; already stopping');
  });

  it('runs the remaining steps when no HTTP server was captured', async () => {
    const t = setup();
    t.deps.getServer = () => undefined;

    createShutdownHandler(t.deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);

    expect(t.logs).toContain('warn: HTTP server not captured; open requests end when the process exits');
    expect(t.queue.close).toHaveBeenCalled();
    expect(t.exit.mock.calls).toEqual([[0]]);
  });

  it('skips the queue steps when the job queue was never created', async () => {
    const t = setup();
    t.deps.getQueue = () => undefined;

    createShutdownHandler(t.deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);

    expect(t.queue.pauseLocal).not.toHaveBeenCalled();
    expect(t.queue.flushJobWrites).not.toHaveBeenCalled();
    expect(t.prisma.$disconnect).toHaveBeenCalled();
    expect(t.exit.mock.calls).toEqual([[0]]);
  });

  it('handles SIGINT like SIGTERM', async () => {
    const t = setup();
    createShutdownHandler(t.deps)('SIGINT');
    await vi.advanceTimersByTimeAsync(100);

    expect(t.logs[0]).toMatch(/^info: SIGINT received; stopping/);
    expect(t.order.at(-1)).toBe('exit 0');
  });
});

describe('captureHttpServer', () => {
  it('keeps only the server from the first request, then unsubscribes', () => {
    const listeners: Array<(message: unknown, name: string | symbol) => void> = [];
    const channel = {
      subscribe: vi.fn((_name: string | symbol, fn: (message: unknown, name: string | symbol) => void) => {
        listeners.push(fn);
      }),
      unsubscribe: vi.fn(() => true),
    };
    const getServer = captureHttpServer(channel);
    expect(channel.subscribe).toHaveBeenCalledWith(HTTP_REQUEST_CHANNEL, expect.any(Function));
    expect(getServer()).toBeUndefined();

    listeners[0]({ request: { headers: { cookie: 'secret' } } }, HTTP_REQUEST_CHANNEL); // no server: ignored
    expect(getServer()).toBeUndefined();

    const server = { close: vi.fn() };
    listeners[0]({ server, request: { headers: { cookie: 'secret' } } }, HTTP_REQUEST_CHANNEL);
    expect(getServer()).toBe(server);
    expect(channel.unsubscribe).toHaveBeenCalledWith(HTTP_REQUEST_CHANNEL, listeners[0]);

    listeners[0]({ server: { close: vi.fn() } }, HTTP_REQUEST_CHANNEL);
    expect(getServer()).toBe(server);
  });
});

describe('registerShutdownHandlers', () => {
  const onceSlot = Symbol.for('rmab.once.shutdown-coordinator');
  const store = globalThis as unknown as Record<symbol, unknown>;

  afterEach(() => {
    delete store[onceSlot];
    vi.restoreAllMocks();
  });

  it('leaves the signals to Next.js when NEXT_MANUAL_SIG_HANDLE is not set', () => {
    const on = vi.spyOn(process, 'on');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    registerShutdownHandlers({});

    expect(on).not.toHaveBeenCalledWith('SIGTERM', expect.anything());
    expect(log).toHaveBeenCalledWith(expect.stringContaining('NEXT_MANUAL_SIG_HANDLE is not set'));
  });

  it('installs SIGTERM and SIGINT handlers once per process when it is set', () => {
    const on = vi.spyOn(process, 'on').mockImplementation(() => process);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    registerShutdownHandlers({ NEXT_MANUAL_SIG_HANDLE: 'true' });
    registerShutdownHandlers({ NEXT_MANUAL_SIG_HANDLE: '1' }); // any value turns Next's handlers off

    const signals = on.mock.calls.map(([event]) => event);
    expect(signals.filter((s) => s === 'SIGTERM')).toHaveLength(1);
    expect(signals.filter((s) => s === 'SIGINT')).toHaveLength(1);
  });
});
