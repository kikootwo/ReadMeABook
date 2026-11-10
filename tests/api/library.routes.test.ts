/**
 * Component: Library API route tests (loads, config, params, live mode, allowlist)
 * Documentation: documentation/features/library-view.md
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';
import { API_TOKEN_ALLOWED_ENDPOINTS } from '@/lib/constants/api-tokens';
import { CANARY, VIEWERS, get, installStack } from '../lib/library-view/route-seed';

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn(), getPlexConfig: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));

const mocks = { prisma: prismaMock, config: configMock };
const FORBIDDEN_SELECTS = ['fileFormat', 'ebookAutoRetryCount', 'customSearchTerms', 'placedEbookFiles', 'approvalBypassedBy', 'cancelledAt', 'autoRerequestCount', 'filePath', 'thumbUrl', 'summary', 'selectedTorrent'];

async function call(qs = '', viewer = VIEWERS.admin) {
  const { GET } = await import('@/app/api/library/route');
  const response = await GET(get(qs, viewer, requireAuthMock));
  return { status: response.status, body: await response.json() };
}

describe('GET /api/library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installStack(mocks);
  });

  it('goes through requireAuth (401 without a session)', async () => {
    requireAuthMock.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const { GET } = await import('@/app/api/library/route');
    const response = await GET(get(''));
    expect(response.status).toBe(401);
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
  });

  it('is not on the API token allowlist', () => {
    expect(API_TOKEN_ALLOWED_ENDPOINTS.some((e) => e.path.startsWith('/api/library'))).toBe(false);
  });

  it('loads qualifying requests with the asserted where and no server-only column', async () => {
    const { status } = await call();
    expect(status).toBe(200);
    const args = prismaMock.request.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ type: 'audiobook', deletedAt: null, status: { not: 'cancelled' } });
    expect(args.where).toEqual((await import('@/lib/library-view/loader')).LIBRARY_REQUEST_WHERE);
    const select = JSON.stringify(args.select);
    for (const key of FORBIDDEN_SELECTS) expect(select).not.toContain(`"${key}"`);
    expect(args.select.audiobook.select.libraryAsin).toBe(true); // read only for the cover rule
  });

  it('loads the active Audiobookshelf library only, never file_path, never the ebook library id', async () => {
    await call();
    const args = prismaMock.plexLibrary.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ plexLibraryId: 'abs-lib-1' });
    const select = JSON.stringify(args.select);
    for (const key of ['filePath', 'thumbUrl', 'summary']) expect(select).not.toContain(`"${key}"`);
    expect(configMock.get).not.toHaveBeenCalledWith('audiobookshelf.ebook_library_id');
    expect(prismaMock.plexLibrary.aggregate.mock.calls[0][0].where).toEqual({ plexLibraryId: 'abs-lib-1' });
  });

  it('reuses the row snapshot while the version holds; requests are read fresh every call', async () => {
    await call();
    await call('q=dune');
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.plexLibrary.aggregate).toHaveBeenCalledTimes(2);
    expect(prismaMock.request.findMany.mock.calls.filter((c: any[]) => c[0]?.where?.type === 'audiobook').length).toBeGreaterThanOrEqual(2);
  });

  it('uses the Plex library id in Plex mode', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getPlexConfig.mockResolvedValue({ libraryId: 'plex-lib-7' });
    const { body } = await call();
    expect(prismaMock.plexLibrary.findMany.mock.calls[0][0].where).toEqual({ plexLibraryId: 'plex-lib-7' });
    expect(body.backend).toBe('plex');
  });

  it('no library configured: 200 with RMAB entries and libraryConfigured false', async () => {
    installStack(mocks, undefined, { libraryId: null });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.libraryConfigured).toBe(false);
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
    expect(body.items.every((i: any) => !i.inLibrary && i.source === 'rmab')).toBe(true);
    expect(body.stats.total).toBe(8);
  });

  it('returns the full shape with stats, facets, ids and BigInt converted', async () => {
    const { body } = await call('sort=title&order=asc');
    expect(body).toMatchObject({ matched: 9, nextCursor: null, groups: null, backend: 'audiobookshelf', libraryConfigured: true });
    expect(body.stats).toEqual({ total: 9, available: 4, onTheWay: 1, needsALook: 2 });
    expect(body.facets.source).toEqual({ scan: 1, rmab: 8 });
    const followed = body.items.find((i: any) => i.title === 'Library Edition');
    expect(followed).toMatchObject({ id: expect.stringMatching(/^req_/), durationMinutes: 120, inLibrary: true, status: 'available' });
    expect(followed.request.downloadSizeBytes).toBe('9000000000');
    expect(body.items.find((i: any) => i.title === 'Scan Only Book').id).toMatch(/^lib_/);
  });

  it('the latest selected download gives the size (explicit createdAt desc)', async () => {
    await call();
    expect(prismaMock.downloadHistory.findMany.mock.calls[0][0]).toMatchObject({
      where: { selected: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('pages with a cursor and refuses a stale one', async () => {
    const first = await call('sort=title&order=asc&limit=4');
    expect(first.body.items).toHaveLength(4);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await call(`sort=title&order=asc&limit=4&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((i: any) => i.id)).not.toContain(first.body.items[3].id);
    const stale = await call(`sort=title&order=desc&limit=4&cursor=${first.body.nextCursor}`);
    expect(stale).toEqual({ status: 400, body: { error: 'StaleCursor', message: expect.any(String) } });
  });

  it.each(['status=bogus', 'limit=500', 'cursor=%21%21', `requestedBy=${'a,'.repeat(60)}`])('400 for %s', async (qs) => {
    const { status } = await call(qs);
    expect(status).toBe(400);
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
  });

  it('500 hides the error detail', async () => {
    prismaMock.request.findMany.mockRejectedValue(new Error(`db down ${CANARY.absFolder}`));
    const { status, body } = await call();
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('CANARY');
  });

  describe('live mode', () => {
    it('reads only live audiobook requests and maps them to entry ids', async () => {
      const now = Date.now();
      prismaMock.request.findMany.mockResolvedValue([
        { audiobookId: 'ab-1', status: 'downloading', progress: 40, updatedAt: new Date(now), createdAt: new Date(now) },
        { audiobookId: 'ab-1', status: 'pending', progress: 0, updatedAt: new Date(now), createdAt: new Date(now - 1000) },
        { audiobookId: 'ab-2', status: 'downloaded', progress: 100, updatedAt: new Date(now), createdAt: new Date(now) },
      ]);
      const { status, body } = await call('live=1', VIEWERS.other);
      expect(status).toBe(200);
      expect(body).toEqual({
        items: [
          { id: 'req_ab-1', status: 'downloading', progress: 40, updatedAt: new Date(now).toISOString() },
          { id: 'req_ab-2', status: 'downloaded', progress: 100, updatedAt: new Date(now).toISOString() },
        ],
        refreshMs: 5000,
      });
      const args = prismaMock.request.findMany.mock.calls[0][0];
      expect(args.where.type).toBe('audiobook');
      expect(args.where.deletedAt).toBeNull();
      expect(args.where.OR[0]).toEqual({ status: { in: ['pending', 'searching', 'downloading', 'processing'] } });
      expect(args.where.OR[1].status).toEqual({ in: ['downloaded', 'awaiting_import'] });
      const windowStart = args.where.OR[1].updatedAt.gte.getTime();
      expect(Date.now() - windowStart).toBeGreaterThanOrEqual(15 * 60 * 1000);
      expect(Date.now() - windowStart).toBeLessThan(15 * 60 * 1000 + 5000);
      expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
    });

    it('30 s while only slow statuses remain, 0 when nothing is live', async () => {
      prismaMock.request.findMany.mockResolvedValue([
        { audiobookId: 'ab-3', status: 'pending', progress: 0, updatedAt: new Date(), createdAt: new Date() },
      ]);
      expect((await call('live=1')).body.refreshMs).toBe(30000);
      prismaMock.request.findMany.mockResolvedValue([]);
      expect((await call('live=1')).body).toEqual({ items: [], refreshMs: 0 });
    });
  });
});
