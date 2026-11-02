/**
 * Component: Per-Indexer Seeding Policy Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { describe, expect, it } from 'vitest';
import { evaluateSeeding, isUnlimitedSeeding } from '@/lib/utils/seeding-policy';

describe('evaluateSeeding', () => {
  it.each([
    ['no config', null],
    ['both criteria 0', { seedingTimeMinutes: 0, ratioLimit: 0 }],
    ['both criteria missing', {}],
  ])('treats %s as unlimited, never met', (_label, config) => {
    const result = evaluateSeeding(config, { seedingTime: 1e9, ratio: 100 });
    expect(result).toMatchObject({ unlimited: true, met: false });
    expect(isUnlimitedSeeding(config)).toBe(true);
  });

  it.each([
    // [seedingTimeMinutes, ratioLimit, seedingTime (s), ratio, met]
    [60, 0, 3599, undefined, false],
    [60, 0, 3600, undefined, true],
    [0, 1.5, 0, 1.49, false],
    [0, 1.5, 0, 1.5, true],
    [60, 2, 7200, 1.9, false],
    [60, 2, 3599, 2.5, false],
    [60, 2, 3600, 2, true],
  ])('time %s min, ratio %s; seeded %s s at ratio %s → met %s', (time, ratioLimit, seedingTime, ratio, met) => {
    const result = evaluateSeeding({ seedingTimeMinutes: time, ratioLimit }, { seedingTime, ratio });
    expect(result).toMatchObject({ unlimited: false, met });
  });

  it('treats an unreported ratio as not met when a ratio limit is set', () => {
    expect(evaluateSeeding({ seedingTimeMinutes: 0, ratioLimit: 1 }, { seedingTime: 1e9 }).met).toBe(false);
  });

  it('treats a missing seeding time as 0 s', () => {
    expect(evaluateSeeding({ seedingTimeMinutes: 1 }, {}).met).toBe(false);
  });

  it('formats progress, with --/-- for a disabled criterion', () => {
    expect(evaluateSeeding({ seedingTimeMinutes: 60, ratioLimit: 2 }, { seedingTime: 2700, ratio: 1.2 }).progress)
      .toBe('ratio 1.20/2.00, time 45/60 min');
    expect(evaluateSeeding({ seedingTimeMinutes: 0, ratioLimit: 2 }, { seedingTime: 2700 }).progress)
      .toBe('ratio 0.00/2.00, time --/-- min');
  });
});
