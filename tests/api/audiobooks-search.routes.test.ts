/**
 * Component: Audiobooks Search Torrents API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  getAudibleRegion: vi.fn().mockResolvedValue('us'),
}));
const prowlarrMock = vi.hoisted(() => ({
  search: vi.fn(),
  searchWithVariations: vi.fn(),
}));
const rankTorrentsMock = vi.hoisted(() => vi.fn());
const groupIndexersMock = vi.hoisted(() => vi.fn());
const groupDescriptionMock = vi.hoisted(() => vi.fn(() => 'Group'));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  getProwlarrService: async () => prowlarrMock,
}));

vi.mock('@/lib/utils/ranking-algorithm', () => ({
  rankTorrents: rankTorrentsMock,
}));

vi.mock('@/lib/utils/indexer-grouping', () => ({
  groupIndexersByCategories: groupIndexersMock,
  getGroupDescription: groupDescriptionMock,
}));

describe('Audiobooks search torrents route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    authRequest = {
      user: { id: 'user-1', role: 'user' },
      json: vi.fn(),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('returns error when no indexers are configured', async () => {
    authRequest.json.mockResolvedValue({ title: 'Title', author: 'Author' });
    configServiceMock.get.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/audiobooks/search-torrents/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ConfigError');
  });

  it('returns ranked results with rank order', async () => {
    authRequest.json.mockResolvedValue({ title: 'Title', author: 'Author' });
    configServiceMock.get
      .mockResolvedValueOnce(JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10 }]))
      .mockResolvedValueOnce(null);

    groupIndexersMock.mockReturnValue({ groups: [{ categories: [1], indexerIds: [1] }], skippedIndexers: [] });
    prowlarrMock.searchWithVariations.mockResolvedValue([{ title: 'Result', size: 100, indexer: 'Indexer', indexerId: 1 }]);
    rankTorrentsMock.mockReturnValue([
      {
        title: 'Result',
        size: 100,
        indexer: 'Indexer',
        indexerId: 1,
        score: 50,
        breakdown: { matchScore: 50, formatScore: 0, sizeScore: 0, seederScore: 0, notes: [] },
        bonusPoints: 0,
        bonusModifiers: [],
        finalScore: 50,
      },
    ]);

    const { POST } = await import('@/app/api/audiobooks/search-torrents/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.results[0].rank).toBe(1);
    expect(rankTorrentsMock).toHaveBeenCalled();
  });
});


