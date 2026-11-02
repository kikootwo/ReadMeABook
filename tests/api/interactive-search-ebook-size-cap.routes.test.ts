/**
 * Component: Interactive Ebook Search Size Cap Route Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Interactive ebook search lists indexer results over the automatic-search
 * size cap (EBOOK_MAX_SIZE_MB), with their size, so the user can pick them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));

const CONFIG: Record<string, string> = {
  ebook_annas_archive_enabled: 'false',
  ebook_indexer_search_enabled: 'true',
  ebook_sidecar_preferred_format: 'pdf',
  prowlarr_indexers: JSON.stringify([
    { id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, ebookCategories: [7020] },
  ]),
  indexer_flag_config: '[]',
};

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: unknown, handler: (req: unknown) => unknown) => handler(req),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/middleware/interactive-search-access', () => ({
  denyWithoutInteractiveSearchAccess: async () => null,
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => CONFIG[key] ?? null,
    getAudibleRegion: async () => 'us',
  }),
}));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: async () => prowlarrMock }));
vi.mock('@/lib/services/download-selection-guard', () => ({
  stripProwlarrKeyFromResults: async (results: unknown) => results,
}));
vi.mock('@/lib/services/ebook-scraper', () => ({
  searchByAsin: vi.fn(),
  searchByTitle: vi.fn(),
  getSlowDownloadLinks: vi.fn(),
}));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({
    getAudiobookDetails: async () => ({ asin: 'B000000001', title: 'Big Picture Book', author: 'Jane Writer' }),
  }),
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => ({ id: 'plex-1' }) }));

const MB = 1024 * 1024;

function indexerResult(guid: string, size: number) {
  return {
    indexer: 'Indexer',
    indexerId: 1,
    title: `Jane Writer - Big Picture Book (pdf) ${guid}`,
    size,
    seeders: 10,
    publishDate: new Date('2024-01-01T00:00:00Z'),
    downloadUrl: `magnet:?xt=urn:btih:${guid}`,
    guid,
  };
}

function makeRequest() {
  return { user: { id: 'admin-1', role: 'admin' }, json: async () => ({}) } as unknown as NextRequest;
}

async function listedSizes(response: Response) {
  expect(response.status).toBe(200);
  const body = await response.json();
  return Object.fromEntries(body.results.map((r: { guid: string; size: number }) => [r.guid, r.size]));
}

describe('interactive ebook search lists results over the size cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prowlarrMock.searchWithVariations.mockResolvedValue([
      indexerResult('big', 35 * MB),
      indexerResult('small', 5 * MB),
      indexerResult('over-cap', 20 * MB + 1),
    ]);
  });

  it('POST /api/audiobooks/[asin]/interactive-search-ebook', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({
      id: 'ab-1', audibleAsin: 'B000000001', title: 'Big Picture Book', author: 'Jane Writer',
    });
    prismaMock.request.findFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/audiobooks/[asin]/interactive-search-ebook/route');
    const sizes = await listedSizes(await POST(makeRequest(), { params: Promise.resolve({ asin: 'B000000001' }) }));

    expect(sizes).toEqual({ big: 35 * MB, small: 5 * MB, 'over-cap': 20 * MB + 1 });
  });

  it('POST /api/requests/[id]/interactive-search-ebook', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-1',
      type: 'ebook',
      status: 'failed',
      audiobook: { id: 'ab-1', audibleAsin: null, title: 'Big Picture Book', author: 'Jane Writer' },
    });

    const { POST } = await import('@/app/api/requests/[id]/interactive-search-ebook/route');
    const sizes = await listedSizes(await POST(makeRequest(), { params: Promise.resolve({ id: 'req-1' }) }));

    expect(sizes).toEqual({ big: 35 * MB, small: 5 * MB, 'over-cap': 20 * MB + 1 });
  });
});
