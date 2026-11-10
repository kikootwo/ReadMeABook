/**
 * Component: Library view snapshot cache tests (version key, TTL, shared builds, stale builds)
 * Documentation: documentation/features/library-view.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { row } from './fixtures';

const loader = vi.hoisted(() => ({
  version: { current: '1:1' },
  rows: { current: [] as unknown[] },
  loads: { count: 0 },
  next: [] as (() => Promise<unknown[]>)[],
}));

vi.mock('@/lib/library-view/loader', () => ({
  libraryRowsVersion: async () => loader.version.current,
  loadLibraryRows: async () => {
    loader.loads.count += 1;
    const once = loader.next.shift();
    return once ? once() : loader.rows.current;
  },
}));

async function load() {
  const mod = await import('@/lib/library-view/snapshot');
  return mod;
}

describe('library snapshot cache', () => {
  beforeEach(async () => {
    (await load()).resetLibrarySnapshot();
    loader.version.current = '1:1';
    loader.rows.current = [row({ id: 'r1', plexGuid: 'g1', asin: 'B000000001' })];
    loader.loads.count = 0;
    loader.next = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no library configured: empty, no load', async () => {
    const { getPreparedLibrary } = await load();
    const prepared = await getPreparedLibrary('plex', null);
    expect(prepared.rows).toEqual([]);
    expect(loader.loads.count).toBe(0);
  });

  it('reuses the prepared rows while the version is unchanged', async () => {
    const { getPreparedLibrary } = await load();
    const a = await getPreparedLibrary('audiobookshelf', 'lib-1');
    const b = await getPreparedLibrary('audiobookshelf', 'lib-1');
    expect(b).toBe(a);
    expect(loader.loads.count).toBe(1);
    expect(a.index.byField.get('B000000001')?.id).toBe('r1');
    expect(Object.isFrozen(a.scanEntries[0])).toBe(true);
  });

  it('rebuilds when the version, library id or backend changes', async () => {
    const { getPreparedLibrary } = await load();
    await getPreparedLibrary('audiobookshelf', 'lib-1');
    loader.version.current = '2:5';
    loader.rows.current = [...loader.rows.current, row({ id: 'r2', plexGuid: 'g2' })];
    expect((await getPreparedLibrary('audiobookshelf', 'lib-1')).rows).toHaveLength(2);
    await getPreparedLibrary('audiobookshelf', 'lib-2');
    await getPreparedLibrary('plex', 'lib-2');
    expect(loader.loads.count).toBe(4);
  });

  it('rebuilds after the safety TTL even when the version holds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { getPreparedLibrary } = await load();
    const { SNAPSHOT_MAX_AGE_MS } = await import('@/lib/library-view/constants');
    await getPreparedLibrary('plex', 'lib-1');
    vi.setSystemTime(Date.now() + SNAPSHOT_MAX_AGE_MS + 1);
    await getPreparedLibrary('plex', 'lib-1');
    expect(loader.loads.count).toBe(2);
  });

  it('concurrent misses on one key share a single build', async () => {
    const { getPreparedLibrary } = await load();
    const [a, b, c] = await Promise.all([
      getPreparedLibrary('plex', 'lib-1'),
      getPreparedLibrary('plex', 'lib-1'),
      getPreparedLibrary('plex', 'lib-1'),
    ]);
    expect(loader.loads.count).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('an older build finishing after a newer one does not take the slot', async () => {
    const { getPreparedLibrary } = await load();
    const oldRows = [row({ id: 'old', plexGuid: 'g-old' })];
    const newRows = [row({ id: 'new', plexGuid: 'g-new' })];
    let releaseOld: () => void = () => {};
    const gate = new Promise<void>((resolve) => (releaseOld = resolve));
    loader.next.push(async () => {
      await gate;
      return oldRows;
    });
    loader.next.push(async () => newRows);

    const older = getPreparedLibrary('plex', 'lib-1');
    await Promise.resolve();
    await Promise.resolve();
    loader.version.current = '2:2';
    const newer = await getPreparedLibrary('plex', 'lib-1');
    releaseOld();
    expect((await older).rows[0].id).toBe('old');
    expect(newer.rows[0].id).toBe('new');
    expect((await getPreparedLibrary('plex', 'lib-1')).rows[0].id).toBe('new');
  });

  it('a failed build is not cached and the next call retries', async () => {
    const { getPreparedLibrary } = await load();
    loader.next.push(async () => {
      throw new Error('db down');
    });
    await expect(getPreparedLibrary('plex', 'lib-1')).rejects.toThrow('db down');
    await expect(getPreparedLibrary('plex', 'lib-1')).resolves.toBeTruthy();
  });
});
