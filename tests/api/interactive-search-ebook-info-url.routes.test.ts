/**
 * Component: Interactive Ebook Search Info URL Route Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * The Anna's Archive result links to `<base>/md5/<md5>` with one slash,
 * even when the configured base URL ends in a slash.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const scraperMock = vi.hoisted(() => ({
  searchByAsin: vi.fn(),
  searchByTitle: vi.fn(),
  getSlowDownloadLinks: vi.fn(),
}));

const CONFIG: Record<string, string> = {
  ebook_annas_archive_enabled: 'true',
  ebook_indexer_search_enabled: 'false',
  ebook_sidecar_preferred_format: 'epub',
  ebook_sidecar_base_url: 'https://annas-archive.gl/',
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
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: async () => ({}) }));
vi.mock('@/lib/services/download-selection-guard', () => ({
  stripProwlarrKeyFromResults: async (results: unknown) => results,
}));
vi.mock('@/lib/services/ebook-scraper', () => scraperMock);
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({
    getAudiobookDetails: async () => ({ asin: 'B000000001', title: 'Audible Title', author: 'Audible Author' }),
  }),
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => ({ id: 'plex-1' }) }));

const EXPECTED_INFO_URL = 'https://annas-archive.gl/md5/abc123';

function makeRequest(): NextRequest {
  return { user: { id: 'admin-1', role: 'admin' }, json: async () => ({}) } as unknown as NextRequest;
}

describe("interactive ebook search Anna's Archive info link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scraperMock.searchByAsin.mockResolvedValue('abc123');
    scraperMock.searchByTitle.mockResolvedValue('abc123');
    scraperMock.getSlowDownloadLinks.mockResolvedValue(['https://annas-archive.gl/slow_download/abc123/0/0']);
  });

  it('POST /api/audiobooks/[asin]/interactive-search-ebook', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({
      id: 'ab-1', audibleAsin: 'B000000001', title: 'Db Title', author: 'Db Author',
    });
    prismaMock.request.findFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/audiobooks/[asin]/interactive-search-ebook/route');
    const response = await POST(makeRequest(), { params: Promise.resolve({ asin: 'B000000001' }) });

    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results).toHaveLength(1);
    expect(results[0].infoUrl).toBe(EXPECTED_INFO_URL);
  });

  it('POST /api/requests/[id]/interactive-search-ebook', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-1',
      type: 'ebook',
      status: 'failed',
      audiobook: { id: 'ab-1', audibleAsin: 'B000000001', title: 'Real Title', author: 'Real Author' },
    });

    const { POST } = await import('@/app/api/requests/[id]/interactive-search-ebook/route');
    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'req-1' }) });

    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results).toHaveLength(1);
    expect(results[0].infoUrl).toBe(EXPECTED_INFO_URL);
  });
});
