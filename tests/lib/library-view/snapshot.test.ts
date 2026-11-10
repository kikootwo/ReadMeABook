/**
 * Component: Library view snapshot cache tests (content key, stale-while-rebuilding, one build per library)
 * Documentation: documentation/features/library-view.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { row } from './fixtures';

const loader = vi.hoisted(() => ({
  version: { current: '1:1' },
  versions: [] as string[],
  rows: { current: [] as unknown[] },
  loads: { count: 0 },
  next: [] as (() => Promise<unknown[]>)[],
}));

vi.mock('@/lib/library-view/loader', () => ({
  libraryRowsVersion: async () => loader.versions.shift() ?? loader.version.current,
  loadLibraryRows: async () => {
    loader.loads.count += 1;
    const once = loader.next.shift();
    return once ? once() : loader.rows.current;
  },
}));

const BLOCKED = 'blocked';
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
/** The call's result, or BLOCKED when it is still waiting on a load after 30 ms. */
const settle = <T>(promise: Promise<T>) => Promise.race([promise, tick(30).then(() => BLOCKED)]);

/** The next load waits until the returned release function runs. */
function gatedLoad(rows: unknown[]): () => void {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  loader.next.push(async () => {
    await gate;
    return rows;
  });
  return release;
}

async function load() {
  return import('@/lib/library-view/snapshot');
}

describe('library snapshot cache', () => {
  beforeEach(async () => {
    (await load()).resetLibrarySnapshot();
    loader.version.current = '1:1';
    loader.versions = [];
    loader.rows.current = [row({ id: 'r1', plexGuid: 'g1', asin: 'B000000001' })];
    loader.loads.count = 0;
    loader.next = [];
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

  it('a version change serves the previous snapshot while one rebuild runs (no stampede)', async () => {
    const { getPreparedLibrary } = await load();
    const a = await getPreparedLibrary('plex', 'lib-1');
    loader.version.current = '2:2';
    const release = gatedLoad([row({ id: 'r2', plexGuid: 'g2' })]);

    expect(await settle(getPreparedLibrary('plex', 'lib-1'))).toBe(a);
    expect(await settle(getPreparedLibrary('plex', 'lib-1'))).toBe(a);
    expect(await settle(getPreparedLibrary('plex', 'lib-1'))).toBe(a);
    expect(loader.loads.count).toBe(2);

    release();
    await tick();
    expect((await getPreparedLibrary('plex', 'lib-1')).rows[0].id).toBe('r2');
    expect(loader.loads.count).toBe(2);
  });

  it('a write during a rebuild is not lost: the next rebuild sees it', async () => {
    const { getPreparedLibrary } = await load();
    await getPreparedLibrary('plex', 'lib-1');
    loader.version.current = '2:2';
    const release = gatedLoad([row({ id: 'r2', plexGuid: 'g2' })]);
    await settle(getPreparedLibrary('plex', 'lib-1')); // starts the rebuild for version 2

    // A write lands while that rebuild is still loading
    loader.version.current = '3:3';
    loader.rows.current = [row({ id: 'r3', plexGuid: 'g3' })];
    const during = await settle(getPreparedLibrary('plex', 'lib-1'));
    expect(during).not.toBe(BLOCKED);
    expect((during as Awaited<ReturnType<typeof getPreparedLibrary>>).rows[0].id).toBe('r1');
    expect(loader.loads.count).toBe(2);

    release();
    await tick();
    expect((await getPreparedLibrary('plex', 'lib-1')).rows[0].id).toBe('r2'); // built for version 2; sees 3
    await tick();
    expect((await getPreparedLibrary('plex', 'lib-1')).rows[0].id).toBe('r3');
    expect(loader.loads.count).toBe(3);
  });

  it('two concurrent cold misses build once, even when the version moves between them', async () => {
    const { getPreparedLibrary } = await load();
    loader.versions.push('1:1', '1:2');
    const [a, b] = await Promise.all([getPreparedLibrary('plex', 'lib-1'), getPreparedLibrary('plex', 'lib-1')]);
    expect(loader.loads.count).toBe(1);
    expect(b).toBe(a);
  });

  it('a failed rebuild keeps serving the previous snapshot and the next call retries', async () => {
    const { getPreparedLibrary } = await load();
    const a = await getPreparedLibrary('plex', 'lib-1');
    loader.version.current = '2:2';
    loader.next.push(async () => {
      throw new Error('db down');
    });
    expect(await settle(getPreparedLibrary('plex', 'lib-1'))).toBe(a);
    await tick();
    loader.rows.current = [row({ id: 'r2', plexGuid: 'g2' })];
    expect(await getPreparedLibrary('plex', 'lib-1')).toBe(a); // retry starts here
    await tick();
    expect((await getPreparedLibrary('plex', 'lib-1')).rows[0].id).toBe('r2');
    expect(loader.loads.count).toBe(3);
  });

  it('another library or backend has no snapshot to serve: that call waits for its own build', async () => {
    const { getPreparedLibrary } = await load();
    await getPreparedLibrary('audiobookshelf', 'lib-1');
    loader.rows.current = [row({ id: 'r9', plexGuid: 'g9' })];
    expect((await getPreparedLibrary('audiobookshelf', 'lib-2')).rows[0].id).toBe('r9');
    expect((await getPreparedLibrary('plex', 'lib-2')).rows[0].id).toBe('r9');
    expect(loader.loads.count).toBe(3);
  });

  it('a failed cold build is not cached and the next call retries', async () => {
    const { getPreparedLibrary } = await load();
    loader.next.push(async () => {
      throw new Error('db down');
    });
    await expect(getPreparedLibrary('plex', 'lib-1')).rejects.toThrow('db down');
    await expect(getPreparedLibrary('plex', 'lib-1')).resolves.toBeTruthy();
  });
});
