/**
 * Component: Library view content versions (row and request checksums cover every selected column)
 * Documentation: documentation/features/library-view.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const keysOf = (o: object) => Object.keys(o).sort();

describe('library view content versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ n: 3, h: '-12345' }]);
  });

  it('the row version hashes exactly the selected library columns, never the touch stamps', async () => {
    const loader = await import('@/lib/library-view/loader');
    expect(keysOf(loader.LIBRARY_ROW_COLUMNS)).toEqual(keysOf(loader.LIBRARY_ROW_SELECT));

    expect(await loader.libraryRowsVersion('lib-1')).toBe('3:-12345');
    const query = prismaMock.$queryRaw.mock.calls[0][0];
    expect(query.sql).toContain('hashtextextended(row(');
    for (const column of Object.values(loader.LIBRARY_ROW_COLUMNS)) expect(query.sql).toContain(`p.${column}`);
    expect(query.sql).not.toMatch(/updated_at|last_scanned_at|file_path|thumb_url/);
    expect(query.values).toEqual(['lib-1']); // the library id is a bound parameter
  });

  it('the requests version hashes every selected request, user and audiobook column over the qualifying set', async () => {
    const loader = await import('@/lib/library-view/loader');
    const { user, audiobook, ...request } = loader.LIBRARY_REQUEST_SELECT;
    const columns = loader.LIBRARY_REQUEST_COLUMNS;
    expect(keysOf(columns.request)).toEqual(keysOf(request));
    expect(keysOf(columns.user)).toEqual(keysOf(user.select));
    expect(keysOf(columns.audiobook)).toEqual(keysOf(audiobook.select));

    expect(await loader.libraryRequestsVersion()).toBe('3:-12345');
    const query = prismaMock.$queryRaw.mock.calls[0][0];
    for (const c of Object.values(columns.request)) expect(query.sql).toContain(`r.${c}`);
    for (const c of Object.values(columns.user)) expect(query.sql).toContain(`u.${c}`);
    for (const c of Object.values(columns.audiobook)) expect(query.sql).toContain(`a.${c}`);
    // Same set as LIBRARY_REQUEST_WHERE: audiobook type, not deleted, not cancelled
    expect(loader.LIBRARY_REQUEST_WHERE).toEqual({ type: 'audiobook', deletedAt: null, status: { not: 'cancelled' } });
    expect(query.sql).toMatch(/r\.type = 'audiobook' and r\.deleted_at is null and r\.status <> 'cancelled'/);
    expect(query.values).toEqual([]);
  });

  it('an empty set gives a stable version', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ n: 0, h: '0' }]);
    const loader = await import('@/lib/library-view/loader');
    expect(await loader.libraryRowsVersion('lib-1')).toBe('0:0');
  });
});

describe('row version single-flight', () => {
  /** A $queryRaw call that settles only when the test says so. */
  function deferredQuery() {
    let resolve!: (value: { n: number; h: string }[]) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<{ n: number; h: string }[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    prismaMock.$queryRaw.mockReturnValueOnce(promise);
    return { resolve, reject };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('concurrent calls for one library share one read', async () => {
    const loader = await import('@/lib/library-view/loader');
    const query = deferredQuery();
    const calls = Array.from({ length: 10 }, () => loader.libraryRowsVersion('lib-1'));
    query.resolve([{ n: 7, h: '42' }]);
    expect(await Promise.all(calls)).toEqual(Array(10).fill('7:42'));
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('a call after the read settles starts a new read', async () => {
    const loader = await import('@/lib/library-view/loader');
    prismaMock.$queryRaw.mockResolvedValueOnce([{ n: 1, h: '1' }]).mockResolvedValueOnce([{ n: 2, h: '2' }]);
    expect(await loader.libraryRowsVersion('lib-1')).toBe('1:1');
    expect(await loader.libraryRowsVersion('lib-1')).toBe('2:2');
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('different libraries never share a read', async () => {
    const loader = await import('@/lib/library-view/loader');
    const a = deferredQuery();
    const b = deferredQuery();
    const first = loader.libraryRowsVersion('lib-a');
    const second = loader.libraryRowsVersion('lib-b');
    a.resolve([{ n: 1, h: 'a' }]);
    b.resolve([{ n: 1, h: 'b' }]);
    expect(await first).toBe('1:a');
    expect(await second).toBe('1:b');
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('a failure reaches only the callers that joined; the next call reads again', async () => {
    const loader = await import('@/lib/library-view/loader');
    const query = deferredQuery();
    const joined = [loader.libraryRowsVersion('lib-1'), loader.libraryRowsVersion('lib-1')];
    query.reject(new Error('db down'));
    for (const call of joined) await expect(call).rejects.toThrow('db down');
    prismaMock.$queryRaw.mockResolvedValueOnce([{ n: 3, h: '3' }]);
    expect(await loader.libraryRowsVersion('lib-1')).toBe('3:3');
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('the requests version is never shared (an action refetch must see its own write)', async () => {
    const loader = await import('@/lib/library-view/loader');
    const first = deferredQuery();
    const second = deferredQuery();
    const calls = [loader.libraryRequestsVersion(), loader.libraryRequestsVersion()];
    first.resolve([{ n: 1, h: 'before' }]);
    second.resolve([{ n: 1, h: 'after' }]);
    expect(await Promise.all(calls)).toEqual(['1:before', '1:after']);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
