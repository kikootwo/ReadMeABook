/**
 * Component: Audiobookshelf Ebook Library Setting Route Tests
 * Documentation: documentation/settings-pages.md
 *
 * PUT /api/admin/settings/audiobookshelf: ebookLibraryId is a trimmed string, '' clears it,
 * an omitted field keeps the saved value, any other type is a 400 with nothing saved;
 * libraryId handling is unchanged. GET /api/admin/settings returns it ('' when unset).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const setManyMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/db', () => ({
  prisma: { configuration: { findMany: findManyMock }, user: { count: async () => 0 } },
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: async () => null, setMany: setManyMock }),
}));

const BASE = { serverUrl: 'http://abs:13378', apiToken: 'new-token', libraryId: 'lib-audio', triggerScanAfterImport: true };

function json(body: unknown) {
  return { json: async () => body } as never;
}

async function put(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/admin/settings/audiobookshelf/route');
  return PUT(json(body));
}

/** The value written for a key by the one setMany call, or undefined when not written. */
function written(key: string): string | undefined {
  expect(setManyMock).toHaveBeenCalledTimes(1);
  const updates = setManyMock.mock.calls[0][0] as { key: string; value: string }[];
  return updates.find((u) => u.key === key)?.value;
}

describe('PUT /api/admin/settings/audiobookshelf: ebookLibraryId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setManyMock.mockResolvedValue(undefined);
  });

  it('saves the id trimmed', async () => {
    const response = await put({ ...BASE, ebookLibraryId: '  lib-ebooks  ' });

    expect(response.status).toBe(200);
    expect(written('audiobookshelf.ebook_library_id')).toBe('lib-ebooks');
  });

  it.each([[''], ['   ']])('"%s" clears it', async (ebookLibraryId) => {
    const response = await put({ ...BASE, ebookLibraryId });

    expect(response.status).toBe(200);
    expect(written('audiobookshelf.ebook_library_id')).toBe('');
  });

  it('an omitted field leaves the saved value alone', async () => {
    const response = await put(BASE);

    expect(response.status).toBe(200);
    expect(written('audiobookshelf.ebook_library_id')).toBeUndefined();
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['a boolean', true],
    ['an array', ['lib-ebooks']],
    ['an object', { id: 'lib-ebooks' }],
  ])('%s is a 400 and nothing is saved', async (_label, ebookLibraryId) => {
    const response = await put({ ...BASE, ebookLibraryId });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('ebookLibraryId');
    expect(setManyMock).not.toHaveBeenCalled();
  });

  it('libraryId is written as before', async () => {
    await put({ ...BASE, ebookLibraryId: 'lib-ebooks' });
    expect(written('audiobookshelf.library_id')).toBe('lib-audio');

    setManyMock.mockClear();
    await put({ ...BASE, libraryId: undefined });
    expect(written('audiobookshelf.library_id')).toBe('');
  });
});

describe('GET /api/admin/settings: audiobookshelf.ebookLibraryId', () => {
  async function getAbs() {
    const { GET } = await import('@/app/api/admin/settings/route');
    const response = await GET({} as never);
    return (await response.json()).audiobookshelf;
  }

  it('unset reads as an empty string', async () => {
    findManyMock.mockResolvedValue([{ key: 'audiobookshelf.library_id', value: 'lib-audio' }]);

    const abs = await getAbs();

    expect(abs.ebookLibraryId).toBe('');
    expect(abs.libraryId).toBe('lib-audio');
  });

  it('a saved id reads back', async () => {
    findManyMock.mockResolvedValue([
      { key: 'audiobookshelf.library_id', value: 'lib-audio' },
      { key: 'audiobookshelf.ebook_library_id', value: 'lib-ebooks' },
    ]);

    expect((await getAbs()).ebookLibraryId).toBe('lib-ebooks');
  });
});
