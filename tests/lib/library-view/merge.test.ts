/**
 * Component: Library view merge tests (pure engine)
 * Documentation: documentation/features/library-view.md
 */

import { describe, expect, it } from 'vitest';
import { applyDurations, mergeLibrary, requestOnlyAsins } from '@/lib/library-view/merge';
import { REMOVED_FROM_LIBRARY_MESSAGE } from '@/lib/constants/request-statuses';
import { USERS, request, row } from './fixtures';

describe('mergeLibrary', () => {
  it('links by abs_item_id and by plex_guid (stored link first)', () => {
    const absRow = row({ plexGuid: 'abs-item-1' });
    const plexRow = row({ plexGuid: 'plex://album/abc' });
    const viaAbs = request({ status: 'available', audiobook: { absItemId: 'abs-item-1' } });
    const viaPlex = request({ status: 'available', audiobook: { plexGuid: 'plex://album/abc' } });

    const entries = mergeLibrary([absRow, plexRow], [viaAbs, viaPlex]);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id).sort()).toEqual([`req_${viaAbs.audiobookId}`, `req_${viaPlex.audiobookId}`].sort());
    expect(entries.every((e) => e.inLibrary && e.source === 'rmab' && e.statusGroup === 'available')).toBe(true);
  });

  it('a stored link to a different-ASIN item gives one entry with library metadata', () => {
    const item = row({ plexGuid: 'abs-item-9', asin: 'B0LIBRARY1', title: 'Library Edition', author: 'Lib Author' });
    const followed = request({
      status: 'available',
      audiobook: { audibleAsin: 'B0REQUEST1', absItemId: 'abs-item-9', libraryAsin: 'B0LIBRARY1', title: 'Requested Edition' },
    });

    const entries = mergeLibrary([item], [followed]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: `req_${followed.audiobookId}`, title: 'Library Edition', author: 'Lib Author', inLibrary: true });
    expect(entries[0].haystack).toContain('requested edition'); // both metadata sets are searchable
  });

  it('falls back to the ASIN rule and keeps rows of no request as scan books', () => {
    const matched = row({ asin: 'B0MATCHED1' });
    const scanOnly = row({ asin: 'B0SCANONLY' });
    const r = request({ status: 'downloaded', audiobook: { audibleAsin: 'b0matched1' } });

    const entries = mergeLibrary([matched, scanOnly], [r]);

    expect(entries.find((e) => e.row === matched)?.id).toBe(`req_${r.audiobookId}`);
    expect(entries.find((e) => e.row === scanOnly)).toMatchObject({ id: `lib_${scanOnly.id}`, source: 'scan' });
    expect(entries.find((e) => e.row === scanOnly)?.primary).toBeNull();
  });

  it('a library row absorbs one book: stored link beats the ASIN rule; the loser folds in', () => {
    const target = row({ plexGuid: 'abs-item-7', asin: 'B0SAMEBOOK' });
    const byAsin = request({ createdAt: new Date('2026-03-02'), audiobook: { audibleAsin: 'B0SAMEBOOK' } });
    const byLink = request({ createdAt: new Date('2026-03-01'), status: 'available', audiobook: { absItemId: 'abs-item-7' } });

    const entries = mergeLibrary([target], [byAsin, byLink]);

    expect(entries.map((e) => e.id)).toEqual([`req_${byLink.audiobookId}`]);
  });

  it('between two ASIN claims the latest primary request wins', () => {
    const target = row({ asin: 'B0SAMEBOOK', plexGuid: 'com.plexapp.agents.audible://B0OTHERONE' });
    const older = request({ createdAt: new Date('2026-03-01'), audiobook: { audibleAsin: 'B0SAMEBOOK' } });
    const newer = request({ createdAt: new Date('2026-03-05'), audiobook: { audibleAsin: 'B0OTHERONE' } });

    expect(mergeLibrary([target], [older, newer]).map((e) => e.id)).toEqual([`req_${newer.audiobookId}`]);
  });

  it('the primary request is the newest; ids stay req_<audiobookId> across status changes', () => {
    const abId = '22222222-0000-4000-8000-0000000000ff';
    const old = request({ audiobookId: abId, status: 'denied', createdAt: new Date('2026-01-01'), user: USERS.bob });
    const pending = request({ audiobookId: abId, status: 'pending', createdAt: new Date('2026-02-01') });
    const [entry] = mergeLibrary([], [old, pending]);
    expect(entry).toMatchObject({ id: `req_${abId}`, status: 'pending', statusGroup: 'on_the_way', inLibrary: false });
    expect(entry.primary?.user.id).toBe(USERS.alice.id);

    const downloading = { ...pending, status: 'downloading', progress: 40 };
    expect(mergeLibrary([], [old, downloading])[0]).toMatchObject({ id: `req_${abId}`, progress: 40 });

    const lib = row({ plexGuid: 'abs-x' });
    const available = { ...pending, status: 'available', audiobook: { ...pending.audiobook, absItemId: 'abs-x' } };
    expect(mergeLibrary([lib], [old, available])[0]).toMatchObject({ id: `req_${abId}`, inLibrary: true, status: 'available', progress: null });
  });

  it.each([
    ['pending', 'on_the_way'], ['awaiting_search', 'on_the_way'], ['searching', 'on_the_way'],
    ['downloading', 'on_the_way'], ['processing', 'on_the_way'], ['downloaded', 'on_the_way'],
    ['awaiting_import', 'on_the_way'], ['awaiting_approval', 'needs_approval'], ['awaiting_release', 'awaiting_release'],
    ['failed', 'problem'], ['warn', 'problem'], ['denied', 'denied'], ['available', 'available'],
  ])('request-only %s → %s', (status, group) => {
    const [entry] = mergeLibrary([], [request({ status })]);
    expect(entry.statusGroup).toBe(group);
    expect(entry.status).toBe(status);
  });

  it('a "Removed from library" failed request shows as problem', () => {
    const [entry] = mergeLibrary([], [request({ status: 'failed', errorMessage: REMOVED_FROM_LIBRARY_MESSAGE })]);
    expect(entry.statusGroup).toBe('problem');
  });

  it('an available request with no row in the active library stays available, request-only', () => {
    const [entry] = mergeLibrary([], [request({ status: 'available', audiobook: { absItemId: 'gone' } })]);
    expect(entry).toMatchObject({ inLibrary: false, statusGroup: 'available', source: 'rmab' });
  });

  it('a cancelled request on an in-library book becomes lib_<id>, source scan', () => {
    const lib = row({ asin: 'B0CANCELED' });
    const cancelled = request({ status: 'cancelled', audiobook: { audibleAsin: 'B0CANCELED' } });
    expect(mergeLibrary([lib], [cancelled])).toEqual([expect.objectContaining({ id: `lib_${lib.id}`, source: 'scan' })]);
  });

  it('drops ebook, deleted and cancelled requests even when the loader returns them', () => {
    const lib = row({ asin: 'B0SCANFOUND' });
    const ebook = request({ type: 'ebook', status: 'downloaded', user: USERS.bob, audiobook: { audibleAsin: 'B0SCANFOUND' } });
    const deleted = request({ deletedAt: new Date(), audiobook: { audibleAsin: 'B0DELETED1' } });
    const entries = mergeLibrary([lib], [ebook, deleted]);
    expect(entries).toEqual([expect.objectContaining({ id: `lib_${lib.id}`, source: 'scan' })]);
  });

  it("keeps a soft-deleted account's requests with the stored name", () => {
    const [entry] = mergeLibrary([], [request({ user: USERS.goneCarol })]);
    expect(entry.primary?.user).toMatchObject({ plexUsername: 'carol' });
  });

  it('uses library duration (ms → minutes) and audible_cache minutes for request-only books', () => {
    const lib = row({ duration: BigInt(5_400_000), asin: 'B0LIBDUR01' });
    const inLib = request({ audiobook: { audibleAsin: 'B0LIBDUR01' } });
    const reqOnly = request({ audiobook: { audibleAsin: 'B0REQDUR01' } });
    const entries = mergeLibrary([lib], [inLib, reqOnly]);
    expect(requestOnlyAsins(entries)).toEqual(['B0REQDUR01']);
    applyDurations(entries, new Map([['B0REQDUR01', 321]]));
    expect(entries.find((e) => e.inLibrary)?.durationMinutes).toBe(90);
    expect(entries.find((e) => !e.inLibrary)?.durationMinutes).toBe(321);
  });

  it("treats ABS 'Unknown Author' as empty and shows the requested author", () => {
    const lib = row({ plexGuid: 'abs-u', author: 'Unknown Author' });
    const [entry] = mergeLibrary([lib], [request({ status: 'available', audiobook: { absItemId: 'abs-u', author: 'Real Author' } })]);
    expect(entry.author).toBe('Real Author');
  });
});
