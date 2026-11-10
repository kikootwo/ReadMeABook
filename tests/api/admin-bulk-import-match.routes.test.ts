/**
 * Component: Bulk Import Match API Route Tests (typed ASIN, search, flags, limits)
 * Documentation: documentation/features/bulk-import.md
 *
 * GET /api/admin/bulk-import/match: a typed ASIN resolves like the import (audiobooks row, cache,
 * live); other text runs an Audible search with no language filter. Each result carries the
 * scan's In Library and Requested flags from one batched query per table.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const audibleMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn(), search: vi.fn() }));
const region = vi.hoisted(() => ({ value: 'us' }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: { user?: unknown }, handler: (r: unknown) => unknown) => {
    req.user = { id: 'admin-1', role: 'admin' };
    return handler(req);
  },
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ getAudibleRegion: async () => region.value }) }));

async function get(q: string | null) {
  const { GET } = await import('@/app/api/admin/bulk-import/match/route');
  const url = new URL('http://localhost/api/admin/bulk-import/match');
  if (q !== null) url.searchParams.set('q', q);
  const response = await GET(new NextRequest(url));
  return { status: response.status, body: await response.json() };
}

const hit = (n: number) => ({ asin: `B0HIT${String(n).padStart(5, '0')}`, title: `Hit ${n}`, author: 'Search Author', narrator: 'Search Narrator', coverArtUrl: `http://img/${n}.jpg`, durationMinutes: 600 + n });

describe('GET /api/admin/bulk-import/match', () => {
  beforeEach(() => {
    region.value = 'us';
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    prismaMock.audibleCache.findUnique.mockResolvedValue(null);
    audibleMock.getAudiobookDetails.mockResolvedValue(null);
    audibleMock.search.mockResolvedValue({ results: [] });
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockResolvedValue([]);
  });

  it.each([
    ['a B0 ASIN', 'B0TYPED001', 'B0TYPED001'],
    ['a lower-case ASIN with spaces', '  b0typed001 ', 'B0TYPED001'],
    ['an ISBN-10 ASIN', '146079350x', '146079350X'],
  ])('resolves %s from the audiobooks row first (no search)', async (_label, q, asin) => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: 'Stored Title', author: 'Stored Author', narrator: null, coverArtUrl: null });

    const res = await get(q);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'asin', asin, store: 'audible.com' });
    expect(res.body.results).toEqual([{ asin, title: 'Stored Title', author: 'Stored Author', inLibrary: false, hasActiveRequest: false }]);
    expect(prismaMock.audiobook.findFirst).toHaveBeenCalledWith({ where: { audibleAsin: asin } });
    expect(prismaMock.audibleCache.findUnique).not.toHaveBeenCalled();
    expect(audibleMock.getAudiobookDetails).not.toHaveBeenCalled();
    expect(audibleMock.search).not.toHaveBeenCalled();
  });

  it('falls back to the Audible cache, then a live lookup without the series fill', async () => {
    audibleMock.getAudiobookDetails.mockResolvedValue({ asin: 'B0TYPED001', title: 'Live Title', author: 'Live Author', durationMinutes: 61 });

    const res = await get('B0TYPED001');

    expect(prismaMock.audibleCache.findUnique).toHaveBeenCalledWith({ where: { asin: 'B0TYPED001' } });
    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith('B0TYPED001', { fillSeries: false });
    expect(res.body.results).toEqual([expect.objectContaining({ asin: 'B0TYPED001', title: 'Live Title', durationMinutes: 61 })]);
  });

  it('answers an unknown ASIN with no results and the configured store', async () => {
    region.value = 'uk';

    const res = await get('B0MISSING1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: 'asin', asin: 'B0MISSING1', store: 'audible.co.uk', results: [] });
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });

  it.each(['Foundation', 'Bloodlines', 'BOOKSHELF12'])('searches "%s" as text, in any language', async (q) => {
    audibleMock.search.mockResolvedValue({ results: [hit(1)] });

    const res = await get(q);

    expect(audibleMock.search).toHaveBeenCalledWith(q, 1, { ignoreLanguageFilter: true });
    expect(prismaMock.audiobook.findFirst).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ kind: 'search', asin: null });
  });

  it('returns at most 20 results, each with its flags from one query per table', async () => {
    audibleMock.search.mockResolvedValue({ results: Array.from({ length: 30 }, (_, i) => hit(i + 1)) });
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ asin: 'B0HIT00002', plexGuid: 'x' }]);
    prismaMock.request.findMany.mockResolvedValue([{ audiobook: { audibleAsin: 'B0HIT00003' } }]);

    const res = await get('some title');

    expect(res.body.results).toHaveLength(20);
    expect(res.body.results.slice(0, 3).map((r: { inLibrary: boolean; hasActiveRequest: boolean }) => [r.inLibrary, r.hasActiveRequest]))
      .toEqual([[false, false], [true, false], [false, true]]);
    expect(res.body.results[0]).toEqual({ ...hit(1), inLibrary: false, hasActiveRequest: false });
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.findMany.mock.calls[0][0].where.audiobook.audibleAsin.in).toHaveLength(20);
  });

  it.each([
    ['missing', null],
    ['blank', '   '],
    ['over 200 characters', 'x'.repeat(201)],
  ])('answers 400 for a %s query and calls nothing', async (_label, q) => {
    const res = await get(q);

    expect(res.status).toBe(400);
    expect(audibleMock.search).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.findFirst).not.toHaveBeenCalled();
  });

  it('answers 502 when the live lookup throws', async () => {
    audibleMock.getAudiobookDetails.mockRejectedValue(new Error('ECONNRESET'));

    const res = await get('B0TYPED001');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Audible lookup failed' });
  });
});
