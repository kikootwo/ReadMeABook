/**
 * Component: Instrumentation Hook Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trigger = vi.hoisted(() => vi.fn());
vi.mock('@/lib/startup/startup-trigger', () => ({ triggerStartupInit: trigger }));

describe('instrumentation register()', () => {
  const saved = { runtime: process.env.NEXT_RUNTIME, phase: process.env.NEXT_PHASE };
  beforeEach(() => trigger.mockResolvedValue(undefined));
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
  ])('%s → trigger called %i time(s)', async (_label, runtime, phase, expected) => {
    process.env.NEXT_RUNTIME = runtime;
    if (phase) process.env.NEXT_PHASE = phase;
    else delete process.env.NEXT_PHASE;

    const { register } = await import('@/instrumentation');
    await register();

    expect(trigger).toHaveBeenCalledTimes(expected);
  });
});
