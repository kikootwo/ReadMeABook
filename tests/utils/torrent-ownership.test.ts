/**
 * Component: Torrent Ownership Rule Tests
 * Documentation: documentation/phase3/download-clients.md
 */

import { describe, expect, it } from 'vitest';
import { knownNotOwned, resolveOwnership } from '@/lib/utils/torrent-ownership';

const createdAt = new Date('2026-10-01T12:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (offsetMs: number) => new Date(createdAt.getTime() + offsetMs);

describe('resolveOwnership', () => {
  it.each([
    // [addedByRmab, client added time offset (ms, undefined = none), owned, reason, recordNotOwned]
    [true, undefined, true, undefined, undefined],
    [true, -24 * HOUR + 1000, true, undefined, undefined],
    [true, -24 * HOUR, false, 'older-copy', false],
    [true, -3 * 24 * HOUR, false, 'older-copy', false],
    [true, 10 * 1000, true, undefined, undefined],
    [true, HOUR, true, undefined, undefined],
    [true, HOUR + 1000, false, 'readded', false],
    [false, 0, false, 'taken-over', false],
    [false, undefined, false, 'taken-over', false],
    [null, -10 * 1000, true, undefined, undefined],
    [null, -15 * MIN, true, undefined, undefined],
    [null, 5 * MIN, true, undefined, undefined],
    [null, -15 * MIN - 1000, false, 'legacy-unclear', false],
    [null, 5 * MIN + 1000, false, 'legacy-unclear', false],
    [null, -2 * HOUR, false, 'legacy-unclear', false],
    [null, -24 * HOUR + 1000, false, 'legacy-unclear', false],
    [null, -24 * HOUR, false, 'legacy-taken-over', true],
    [null, -3 * 24 * HOUR, false, 'legacy-taken-over', true],
    [null, undefined, false, 'legacy-unclear', false],
  ])('addedByRmab=%s, added %s ms from the grab: owned=%s (%s)', (addedByRmab, offset, owned, reason, recordNotOwned) => {
    const verdict = resolveOwnership(
      { addedByRmab: addedByRmab as boolean | null, createdAt },
      offset === undefined ? undefined : at(offset as number)
    );
    expect(verdict.owned).toBe(owned);
    if (!verdict.owned) {
      expect(verdict.reason).toBe(reason);
      expect(verdict.recordNotOwned).toBe(recordNotOwned);
    }
  });

  it('treats a client added time of 0 (epoch) as unknown', () => {
    expect(resolveOwnership({ addedByRmab: null, createdAt }, new Date(0))).toMatchObject({ owned: false, reason: 'legacy-unclear', recordNotOwned: false });
    expect(resolveOwnership({ addedByRmab: true, createdAt }, new Date(0))).toEqual({ owned: true });
  });

  it('never owns a row recorded as removed, whatever its provenance', () => {
    for (const addedByRmab of [true, null, false]) {
      expect(resolveOwnership({ addedByRmab, createdAt, downloadStatus: 'removed' }, at(0)))
        .toMatchObject({ owned: false, reason: 'removed', recordNotOwned: false });
    }
  });
});

describe('knownNotOwned', () => {
  it('knows removed and taken-over rows without a client call, and nothing else', () => {
    expect(knownNotOwned({ addedByRmab: false, createdAt })).toMatchObject({ owned: false, reason: 'taken-over' });
    expect(knownNotOwned({ addedByRmab: true, createdAt, downloadStatus: 'removed' })).toMatchObject({ reason: 'removed' });
    expect(knownNotOwned({ addedByRmab: true, createdAt, downloadStatus: 'completed' })).toBeNull();
    expect(knownNotOwned({ addedByRmab: null, createdAt, downloadStatus: 'completed' })).toBeNull();
  });
});
