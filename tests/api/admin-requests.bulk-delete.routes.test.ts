/**
 * Component: Admin Requests API Tests - bulk delete support (#212)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * DELETE /api/admin/requests/:id?keepLibrary=1 asks deleteRequest to refuse a book in the
 * library (409 InLibrary); without it the call is exactly the single delete. The list route
 * derives `inLibrary` and never returns the stored paths it reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const deleteRequestMock = vi.hoisted(() => vi.fn());
const authRequest = { user: { id: 'admin-1', role: 'admin' } };

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler(authRequest),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/request-delete.service', () => ({ deleteRequest: deleteRequestMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ getBackendMode: async () => 'audiobookshelf' }) }));

const deleteCall = (query = '') =>
  ({ nextUrl: new URL(`http://localhost/api/admin/requests/req-1${query}`) }) as unknown as NextRequest;
const listCall = () => ({ url: 'http://localhost/api/admin/requests' }) as unknown as NextRequest;
const ok = { success: true, message: 'Request deleted successfully', filesDeleted: false, torrentsRemoved: 0, torrentsKeptSeeding: 0, torrentsKeptUnlimited: 0, torrentsKeptShared: 0, torrentsKeptNotOwned: 0 };

function row(id: string, over: { type?: string; placedEbookFiles?: unknown; book?: Record<string, unknown>; importing?: boolean } = {}) {
  return {
    id,
    status: 'failed',
    type: over.type ?? 'audiobook',
    placedEbookFiles: over.placedEbookFiles ?? null,
    createdAt: new Date(),
    completedAt: null,
    errorMessage: null,
    audiobook: {
      id: `ab-${id}`, title: `Made Up ${id}`, author: 'Made Up Author', audibleAsin: null, libraryAsin: null,
      absItemId: null, filePath: null, plexGuid: null, ...over.book,
      requests: over.importing ? [{ id: 'other' }] : [],
    },
    user: { id: 'u-1', plexUsername: 'reader' },
    downloadHistory: [],
    _count: { blockedReleases: 0 },
  };
}

describe('DELETE /api/admin/requests/:id keepLibrary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('?keepLibrary=1 asks deleteRequest to refuse a book in the library', async () => {
    deleteRequestMock.mockResolvedValueOnce(ok);
    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    const response = await DELETE(deleteCall('?keepLibrary=1'), { params: Promise.resolve({ id: 'req-1' }) });
    expect(response.status).toBe(200);
    expect(deleteRequestMock).toHaveBeenCalledWith('req-1', 'admin-1', { refuseInLibrary: true });
  });

  it('a refusal answers 409 InLibrary', async () => {
    deleteRequestMock.mockResolvedValueOnce({ ...ok, success: false, error: 'InLibrary', message: 'Not deleted: the book is in your library or being imported' });
    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    const response = await DELETE(deleteCall('?keepLibrary=1'), { params: Promise.resolve({ id: 'req-1' }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'InLibrary', message: 'Not deleted: the book is in your library or being imported' });
  });

  it.each(['', '?keepLibrary=0', '?keepLibrary=true'])('without keepLibrary=1 (%s) it is the single delete, unchanged', async (query) => {
    deleteRequestMock.mockResolvedValueOnce(ok);
    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    await DELETE(deleteCall(query), { params: Promise.resolve({ id: 'req-1' }) });
    expect(deleteRequestMock).toHaveBeenCalledWith('req-1', 'admin-1');
    expect(deleteRequestMock.mock.calls[0]).toHaveLength(2);
  });
});

describe('GET /api/admin/requests inLibrary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives inLibrary per row from the shared rule and never returns stored paths', async () => {
    prismaMock.request.count.mockResolvedValueOnce(6);
    prismaMock.request.findMany.mockResolvedValueOnce([
      row('plain'),
      row('folder', { book: { filePath: '/media/Made Up Author/Book' } }),
      row('item', { book: { absItemId: 'abs-1' } }),
      row('importing', { importing: true }),
      row('ebook', { type: 'ebook', placedEbookFiles: [{ path: '/media/x.epub' }] }),
      row('ebook-empty', { type: 'ebook', placedEbookFiles: [] }),
    ]);
    const { GET } = await import('@/app/api/admin/requests/route');
    const payload = await (await GET(listCall())).json();
    expect(Object.fromEntries(payload.requests.map((r: { requestId: string; inLibrary: boolean }) => [r.requestId, r.inLibrary]))).toEqual({
      plain: false, folder: true, item: true, importing: true, ebook: true, 'ebook-empty': false,
    });
    const text = JSON.stringify(payload);
    expect(text).not.toContain('/media');
    expect(text).not.toContain('filePath');
    expect(text).not.toContain('plexGuid');
    expect(text).not.toContain('placedEbookFiles');
  });

  it('loads the book fields and live processing requests the rule needs in the same query', async () => {
    prismaMock.request.count.mockResolvedValueOnce(0);
    prismaMock.request.findMany.mockResolvedValueOnce([]);
    const { GET } = await import('@/app/api/admin/requests/route');
    await GET(listCall());
    const select = prismaMock.request.findMany.mock.calls[0][0].include.audiobook.select;
    expect(select).toMatchObject({
      filePath: true,
      plexGuid: true,
      absItemId: true,
      requests: { where: { status: 'processing', deletedAt: null }, select: { id: true }, take: 1 },
    });
  });
});
