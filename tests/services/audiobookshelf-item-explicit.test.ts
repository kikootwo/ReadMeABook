/**
 * Component: Audiobookshelf API client, writeABSItem Explicit flag + canKeyUserSeeExplicit (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * The flag shares the tag writer's PATCH /items/:id/media: one GET only when tags are asked, one
 * PATCH holding only what is missing, `metadata.explicit` alone when the tag list can't be read,
 * never `explicit: false`. The guard reads GET /api/me and returns only a boolean.
 * Real: api.ts. Mocked: fetch, config.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canKeyUserSeeExplicit, writeABSItem } from '@/lib/services/audiobookshelf/api';

const configServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => loggerMock } }));

const ok = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });
const fail = (status: number, statusText: string) => ({ ok: false, status, statusText, json: async () => ({}) });
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }));
const saved = (explicit: unknown, tags?: string[]) => ok({ updated: true, libraryItem: { media: { ...(tags ? { tags } : {}), metadata: { explicit } } } });

describe('writeABSItem: Explicit flag (#542)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    configServiceMock.get.mockImplementation(async (key: string) => ({ 'audiobookshelf.server_url': 'http://abs', 'audiobookshelf.api_token': 't' } as Record<string, string>)[key] ?? null);
  });

  it('explicit only: no GET, one PATCH with exactly {metadata: {explicit: true}}', async () => {
    fetchMock.mockResolvedValueOnce(saved(true));

    expect(await writeABSItem('li_1', { explicit: true })).toEqual({ tags: 'none', addedTags: [], explicit: 'set' });
    expect(calls()).toEqual([{ url: 'http://abs/api/items/li_1/media', method: 'PATCH', body: { metadata: { explicit: true } } }]);
  });

  it('tags + explicit: one GET and one PATCH holding both', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ media: { tags: ['Fiction'], metadata: { explicit: false } } }))
      .mockResolvedValueOnce(saved(true, ['Fiction', 'req:alice']));

    const out = await writeABSItem('li_1', { tags: ['req:alice'], explicit: true });

    expect(out).toEqual({ tags: 'added', addedTags: ['req:alice'], explicit: 'set' });
    expect(calls()).toEqual([
      { url: 'http://abs/api/items/li_1', method: 'GET', body: undefined },
      { url: 'http://abs/api/items/li_1/media', method: 'PATCH', body: { tags: ['Fiction', 'req:alice'], metadata: { explicit: true } } },
    ]);
  });

  it('the read already shows explicit true: the PATCH carries tags only', async () => {
    fetchMock.mockResolvedValueOnce(ok({ media: { tags: [], metadata: { explicit: true } } })).mockResolvedValueOnce(saved(true, ['req:alice']));

    const out = await writeABSItem('li_1', { tags: ['req:alice'], explicit: true });

    expect(out).toEqual({ tags: 'added', addedTags: ['req:alice'], explicit: 'present' });
    expect(calls()[1].body).toEqual({ tags: ['req:alice'] });
  });

  it('nothing missing: present for both, no PATCH', async () => {
    fetchMock.mockResolvedValueOnce(ok({ media: { tags: ['req:alice'], metadata: { explicit: true } } }));

    expect(await writeABSItem('li_1', { tags: ['req:alice'], explicit: true })).toEqual({ tags: 'present', addedTags: [], explicit: 'present' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unreadable tag list', [ok({ media: { tags: 'a,b' } })], 'unreadable'],
    ['a failed read (403)', [fail(403, 'Forbidden')], 'failed'],
    ['a read timeout', [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })], 'failed'],
  ])('%s: still sends {metadata: {explicit: true}} on its own', async (_label, reads, tagState) => {
    const [read] = reads;
    if (read instanceof Error) fetchMock.mockRejectedValueOnce(read);
    else fetchMock.mockResolvedValueOnce(read);
    fetchMock.mockResolvedValueOnce(saved(true));

    const out = await writeABSItem('li_1', { tags: ['req:alice'], explicit: true });

    expect(out).toMatchObject({ tags: tagState, explicit: 'set' });
    expect(calls()[1]).toEqual({ url: 'http://abs/api/items/li_1/media', method: 'PATCH', body: { metadata: { explicit: true } } });
  });

  it('response explicit false → failed; a response without metadata.explicit counts as saved', async () => {
    fetchMock.mockResolvedValueOnce(saved(false));
    expect(await writeABSItem('li_1', { explicit: true })).toMatchObject({ explicit: 'failed', error: 'explicit flag not saved' });

    fetchMock.mockResolvedValueOnce(ok({ updated: false }));
    expect(await writeABSItem('li_1', { explicit: true })).toMatchObject({ explicit: 'set' });
  });

  it('403 on the PATCH → failed with httpStatus; never throws', async () => {
    fetchMock.mockResolvedValueOnce(fail(403, 'Forbidden'));

    expect(await writeABSItem('li_1', { explicit: true })).toMatchObject({ explicit: 'failed', httpStatus: 403 });
  });

  it('15 s timeout on the PATCH', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValueOnce(saved(true));

    await writeABSItem('li_1', { explicit: true });

    expect(timeout).toHaveBeenCalledWith(15_000);
    timeout.mockRestore();
  });

  it('no body ever carries explicit: false, and no tags key without tags', async () => {
    const cases: Parameters<typeof writeABSItem>[1][] = [
      { explicit: true },
      { tags: ['req:a'] },
      { tags: ['req:a'], explicit: true },
      // A caller that slips false past the type never reaches ABS with it
      { explicit: false as unknown as true },
      {},
    ];
    for (const want of cases) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async (_url: string, init: { method?: string }) =>
        init.method === 'PATCH' ? saved(true, ['req:a']) : ok({ media: { tags: [], metadata: { explicit: false } } }));
      await writeABSItem('li_1', want);
      for (const call of calls().filter((c) => c.method === 'PATCH')) {
        expect(JSON.stringify(call.body)).not.toContain('"explicit":false');
        if (!want.tags) expect(call.body).not.toHaveProperty('tags');
      }
    }
  });
});

describe('canKeyUserSeeExplicit (#542)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    configServiceMock.get.mockImplementation(async (key: string) => ({ 'audiobookshelf.server_url': 'http://abs', 'audiobookshelf.api_token': 't' } as Record<string, string>)[key] ?? null);
  });

  it('reads GET /api/me with a 15 s bound; true only for an active user with explicit access', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValueOnce(ok({ id: 'u', token: 'legacy-secret', isActive: true, permissions: { accessExplicitContent: true } }));

    const result = await canKeyUserSeeExplicit();

    expect(result).toBe(true);
    expect(calls()).toEqual([{ url: 'http://abs/api/me', method: 'GET', body: undefined }]);
    expect(timeout).toHaveBeenCalledWith(15_000);
    timeout.mockRestore();
  });

  it.each([
    ['access off', ok({ isActive: true, permissions: { accessExplicitContent: false } })],
    ['access missing', ok({ isActive: true, permissions: {} })],
    ['no permissions', ok({ isActive: true })],
    ['inactive', ok({ isActive: false, permissions: { accessExplicitContent: true } })],
    ['a truthy non-boolean', ok({ isActive: 1, permissions: { accessExplicitContent: 'yes' } })],
    ['403', fail(403, 'Forbidden')],
  ])('false for %s', async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response);
    expect(await canKeyUserSeeExplicit()).toBe(false);
  });

  it('false on a timeout; never throws', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted due to timeout'), { name: 'TimeoutError' }));
    expect(await canKeyUserSeeExplicit()).toBe(false);
  });

  it('returns only a boolean and never logs the body (it carries the legacy token)', async () => {
    fetchMock.mockResolvedValueOnce(ok({ token: 'legacy-secret', isActive: true, permissions: { accessExplicitContent: true } }));

    const result = await canKeyUserSeeExplicit();

    expect(typeof result).toBe('boolean');
    const logged = JSON.stringify([loggerMock.info.mock.calls, loggerMock.warn.mock.calls, loggerMock.error.mock.calls, loggerMock.debug.mock.calls]);
    expect(logged).not.toContain('legacy-secret');
  });
});
