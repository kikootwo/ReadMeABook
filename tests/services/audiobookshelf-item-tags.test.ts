/**
 * Component: Audiobookshelf API client, addABSItemTags (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * ABS's PATCH /items/:id/media replaces the whole tags array: the item is read first, its tags are
 * kept in order, and a list that can't be read is never written. Real: api.ts. Mocked: fetch, config.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ABS_TAG_TIMEOUT_MS, addABSItemTags } from '@/lib/services/audiobookshelf/api';

const configServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));

const ok = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });
const fail = (status: number, statusText: string) => ({ ok: false, status, statusText, json: async () => ({}) });
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }));

describe('addABSItemTags (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    configServiceMock.get.mockImplementation(async (key: string) => ({ 'audiobookshelf.server_url': 'http://abs/', 'audiobookshelf.api_token': 't' } as Record<string, string>)[key] ?? null);
  });

  it('reads the item, keeps its tags in order and PATCHes only {tags} to /items/:id/media', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ media: { tags: ['keepme', 'Fiction'] } }))
      .mockResolvedValueOnce(ok({ updated: true, libraryItem: { media: { tags: ['keepme', 'Fiction', 'req:alice'] } } }));

    const out = await addABSItemTags('li_1', ['req:alice']);

    expect(out).toEqual({ status: 'added', tags: ['req:alice'] });
    expect(calls()).toEqual([
      { url: 'http://abs/api/items/li_1', method: 'GET', body: undefined },
      { url: 'http://abs/api/items/li_1/media', method: 'PATCH', body: { tags: ['keepme', 'Fiction', 'req:alice'] } },
    ]);
  });

  it('passes a 15 s timeout on both calls', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValueOnce(ok({ media: { tags: [] } })).mockResolvedValueOnce(ok({}));

    await addABSItemTags('li_1', ['req:alice']);

    expect(ABS_TAG_TIMEOUT_MS).toBe(15_000);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(15_000);
    timeout.mockRestore();
  });

  it('no PATCH when every tag is already there', async () => {
    fetchMock.mockResolvedValueOnce(ok({ media: { tags: ['req:alice', 'x'] } }));

    expect(await addABSItemTags('li_1', ['req:alice'])).toEqual({ status: 'present' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds only the missing tags, de-duplicated', async () => {
    fetchMock.mockResolvedValueOnce(ok({ media: { tags: ['req:bob'] } })).mockResolvedValueOnce(ok({}));

    const out = await addABSItemTags('li_1', ['req:alice', 'req:bob', 'req:alice']);

    expect(out).toEqual({ status: 'added', tags: ['req:alice'] });
    expect(calls()[1].body).toEqual({ tags: ['req:bob', 'req:alice'] });
  });

  it.each([
    ['no media', {}],
    ['no tags field', { media: {} }],
    ['tags not an array', { media: { tags: 'a,b' } }],
    ['a non-string tag', { media: { tags: ['a', 3] } }],
  ])('never PATCHes when the read has %s', async (_label, item) => {
    fetchMock.mockResolvedValueOnce(ok(item));

    expect(await addABSItemTags('li_1', ['req:alice'])).toEqual({ status: 'unreadable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports failed when the saved item lacks the tag', async () => {
    fetchMock.mockResolvedValueOnce(ok({ media: { tags: [] } })).mockResolvedValueOnce(ok({ libraryItem: { media: { tags: [] } } }));

    expect(await addABSItemTags('li_1', ['req:alice'])).toMatchObject({ status: 'failed' });
  });

  it.each([
    ['403 on the read', [fail(403, 'Forbidden')], 403],
    ['403 on the write', [ok({ media: { tags: [] } }), fail(403, 'Forbidden')], 403],
    ['500', [fail(500, 'Internal Server Error')], 500],
  ])('never throws on %s', async (_label, responses, httpStatus) => {
    for (const r of responses) fetchMock.mockResolvedValueOnce(r);

    expect(await addABSItemTags('li_1', ['req:alice'])).toMatchObject({ status: 'failed', httpStatus });
  });

  it('never throws on a timeout or network error', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));

    const out = await addABSItemTags('li_1', ['req:alice']);

    expect(out).toMatchObject({ status: 'failed', error: expect.stringContaining('timeout') });
    expect(out).not.toHaveProperty('httpStatus');
  });
});
