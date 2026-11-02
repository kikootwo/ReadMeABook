/**
 * Component: Interactive Ebook Search Query Route Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Both interactive ebook routes must query indexers with title + author
 * (searchWithVariations), the same way audiobook search does. A custom title
 * replaces the title; the author still goes along.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));

const CONFIG: Record<string, string> = {
  ebook_annas_archive_enabled: 'false',
  ebook_indexer_search_enabled: 'true',
  ebook_sidecar_preferred_format: 'epub',
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
    getAudiobookDetails: async () => ({ asin: 'B000000001', title: 'Audible Title', author: 'Audible Author' }),
  }),
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => ({ id: 'plex-1' }) }));

const EXPECTED_FILTERS = { categories: [7020], indexerIds: [1], minSeeders: 0, maxResults: 100 };

function makeRequest(body: Record<string, unknown>) {
  return { user: { id: 'admin-1', role: 'admin' }, json: async () => body } as any;
}

describe('interactive ebook search sends title + author to indexers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prowlarrMock.searchWithVariations.mockResolvedValue([]);
  });

  describe('POST /api/audiobooks/[asin]/interactive-search-ebook', () => {
    beforeEach(() => {
      prismaMock.audiobook.findFirst.mockResolvedValue({
        id: 'ab-1', audibleAsin: 'B000000001', title: 'Db Title', author: 'Db Author',
      });
      prismaMock.request.findFirst.mockResolvedValue(null);
    });

    // DB record and Audible differ: the route searches with the stored audiobook record
    it.each([
      ['no custom title', {}, 'Db Title', false],
      ['a custom title', { customTitle: 'Custom Title' }, 'Custom Title', true],
    ])('with %s', async (_label, body, expectedTitle, exactTitle) => {
      const { POST } = await import('@/app/api/audiobooks/[asin]/interactive-search-ebook/route');
      const response = await POST(makeRequest(body), { params: Promise.resolve({ asin: 'B000000001' }) });

      expect(response.status).toBe(200);
      expect((await response.json()).searchTitle).toBe(expectedTitle);
      expect(prowlarrMock.search).not.toHaveBeenCalled();
      expect(prowlarrMock.searchWithVariations).toHaveBeenCalledTimes(1);
      expect(prowlarrMock.searchWithVariations).toHaveBeenCalledWith(expectedTitle, 'Db Author', EXPECTED_FILTERS, { exactTitle });
    });
  });

  describe('POST /api/requests/[id]/interactive-search-ebook', () => {
    beforeEach(() => {
      prismaMock.request.findFirst.mockResolvedValue({
        id: 'req-1',
        type: 'ebook',
        status: 'failed',
        audiobook: { id: 'ab-1', audibleAsin: null, title: 'Real Title', author: 'Real Author' },
      });
    });

    it.each([
      ['no custom title', {}, 'Real Title', false],
      ['a custom title', { customTitle: 'Custom Title' }, 'Custom Title', true],
    ])('with %s', async (_label, body, expectedTitle, exactTitle) => {
      const { POST } = await import('@/app/api/requests/[id]/interactive-search-ebook/route');
      const response = await POST(makeRequest(body), { params: Promise.resolve({ id: 'req-1' }) });

      expect(response.status).toBe(200);
      expect((await response.json()).searchTitle).toBe(expectedTitle);
      expect(prowlarrMock.search).not.toHaveBeenCalled();
      expect(prowlarrMock.searchWithVariations).toHaveBeenCalledTimes(1);
      expect(prowlarrMock.searchWithVariations).toHaveBeenCalledWith(expectedTitle, 'Real Author', EXPECTED_FILTERS, { exactTitle });
    });
  });
});
