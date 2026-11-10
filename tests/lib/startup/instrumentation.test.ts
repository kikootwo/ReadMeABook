/**
 * Component: Instrumentation Hook Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trigger = vi.hoisted(() => vi.fn());
const registerShutdown = vi.hoisted(() => vi.fn());
vi.mock('@/lib/startup/startup-trigger', () => ({ triggerStartupInit: trigger }));
vi.mock('@/lib/startup/shutdown-coordinator', () => ({ registerShutdownHandlers: registerShutdown }));

describe('instrumentation register()', () => {
  const saved = { runtime: process.env.NEXT_RUNTIME, phase: process.env.NEXT_PHASE };
  beforeEach(() => {
    vi.clearAllMocks();
    trigger.mockResolvedValue(undefined);
  });
  afterEach(() => {
    process.env.NEXT_RUNTIME = saved.runtime;
    process.env.NEXT_PHASE = saved.phase;
    if (saved.runtime === undefined) delete process.env.NEXT_RUNTIME;
    if (saved.phase === undefined) delete process.env.NEXT_PHASE;
  });

  it.each([
    ['edge runtime', 'edge', undefined, 0],
    ['production build', 'nodejs', 'phase-production-build', 0],
    ['node server', 'nodejs', undefined, 1],
  ])('%s → trigger and shutdown handlers registered %i time(s)', async (_label, runtime, phase, expected) => {
    process.env.NEXT_RUNTIME = runtime;
    if (phase) process.env.NEXT_PHASE = phase;
    else delete process.env.NEXT_PHASE;

    const { register } = await import('@/instrumentation');
    await register();

    expect(trigger).toHaveBeenCalledTimes(expected);
    expect(registerShutdown).toHaveBeenCalledTimes(expected);
  });

  it('registers the shutdown handlers before the startup trigger sends its request', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.NEXT_PHASE;

    const { register } = await import('@/instrumentation');
    await register();

    // The coordinator captures the HTTP server from the first request, which is the trigger's
    expect(registerShutdown.mock.invocationCallOrder[0]).toBeLessThan(trigger.mock.invocationCallOrder[0]);
  });
});
