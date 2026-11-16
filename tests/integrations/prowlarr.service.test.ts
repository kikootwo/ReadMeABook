/**
 * Component: Prowlarr Integration Service Tests
 * Documentation: documentation/phase3/prowlarr.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProwlarrService } from '@/lib/integrations/prowlarr.service';

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  interceptors: {
    request: {
      use: vi.fn(),
    },
  },
}));

const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  get: vi.fn(),
}));

const configMock = vi.hoisted(() => ({
  get: vi.fn(),
  getMany: vi.fn(),
}));

// Mock for DownloadClientManager
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getAllClients: vi.fn(),
  hasClientForProtocol: vi.fn(),
}));

vi.mock('axios', () => ({
  default: axiosMock,
  ...axiosMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
  invalidateDownloadClientManager: vi.fn(),
}));

describe('ProwlarrService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.get.mockReset();
    axiosMock.get.mockReset();
    configMock.get.mockReset();
    downloadClientManagerMock.getClientForProtocol.mockReset();
    downloadClientManagerMock.getAllClients.mockReset();
    downloadClientManagerMock.hasClientForProtocol.mockReset();
  });

  it('filters results for SABnzbd (usenet)', async () => {
    // Mock: Only SABnzbd is configured (usenet only)
    downloadClientManagerMock.hasClientForProtocol.mockImplementation(async (protocol: string) => {
      return protocol === 'usenet';
    });
    clientMock.get.mockResolvedValue({
      data: [
        {
          guid: 'g1',
          indexer: 'IndexerA',
          title: 'Book NZB',
          size: 100,
          publishDate: '2024-01-01T00:00:00.000Z',
          downloadUrl: 'https://example.com/book.nzb',
          protocol: 'usenet',
        },
        {
          guid: 'g2',
          indexer: 'IndexerB',
          title: 'Book Torrent',
          size: 200,
          publishDate: '2024-01-02T00:00:00.000Z',
          magnetUrl: 'magnet:?xt=urn:btih:abc',
          protocol: 'torrent',
        },
      ],
    });

    const service = new ProwlarrService('http://prowlarr', 'key');
    const results = await service.search('Book');

    expect(results).toHaveLength(1);
    expect(results[0].downloadUrl).toContain('.nzb');
    expect(results[0].protocol).toBe('usenet');
  });

  it('throws when search fails', async () => {
    // Mock: qBittorrent is configured (torrent only)
    downloadClientManagerMock.hasClientForProtocol.mockImplementation(async (protocol: string) => {
      return protocol === 'torrent';
    });
    clientMock.get.mockRejectedValue(new Error('bad search'));

    const service = new ProwlarrService('http://prowlarr', 'key');

    await expect(service.search('Book')).rejects.toThrow('Failed to search Prowlarr: bad search');
  });

  it('filters results for qBittorrent (torrent)', async () => {
    // Mock: Only qBittorrent is configured (torrent only)
    downloadClientManagerMock.hasClientForProtocol.mockImplementation(async (protocol: string) => {
      return protocol === 'torrent';
    });
    clientMock.get.mockResolvedValue({
      data: [
        {
          guid: 'g1',
          indexer: 'IndexerA',
          title: 'Book NZB',
          size: 100,
          publishDate: '2024-01-01T00:00:00.000Z',
          downloadUrl: 'https://example.com/book.nzb',
          protocol: 'usenet',
        },
        {
          guid: 'g2',
          indexer: 'IndexerB',
          title: 'Book Torrent',
          size: 200,
          publishDate: '2024-01-02T00:00:00.000Z',
          magnetUrl: 'magnet:?xt=urn:btih:abc',
          protocol: 'torrent',
        },
      ],
    });

    const service = new ProwlarrService('http://prowlarr', 'key');
    const results = await service.search('Book');

    expect(results).toHaveLength(1);
    expect(results[0].downloadUrl).toContain('magnet:?');
    expect(results[0].protocol).toBe('torrent');
  });

  it('parses RSS feeds into torrent results', async () => {
    const xml = `
      <rss xmlns:torznab="http://torznab.com/schemas/2015/feed">
        <channel>
          <item>
            <title>Great Book M4B 64kbps</title>
            <link>https://example.com/book.torrent</link>
            <guid>guid-1</guid>
            <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
            <prowlarrindexer>IndexerA</prowlarrindexer>
            <torznab:attr name="seeders" value="5" />
            <torznab:attr name="peers" value="8" />
            <torznab:attr name="infohash" value="HASH" />
          </item>
        </channel>
      </rss>
    `;

    axiosMock.get.mockResolvedValue({ data: xml });
    const service = new ProwlarrService('http://prowlarr', 'key');

    const results = await service.getRssFeed(1);

    expect(results).toHaveLength(1);
    expect(results[0].seeders).toBe(5);
    expect(results[0].leechers).toBe(3);
    expect(results[0].format).toBe('M4B');
    expect(results[0].bitrate).toBe('64kbps');
    expect(results[0].hasChapters).toBe(true);
  });

  it('skips RSS items missing download URLs', async () => {
    const xml = `
      <rss xmlns:torznab="http://torznab.com/schemas/2015/feed">
        <channel>
          <item>
            <title>Book Without Link</title>
            <guid>guid-2</guid>
            <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
            <prowlarrindexer>IndexerA</prowlarrindexer>
          </item>
        </channel>
      </rss>
    `;

    axiosMock.get.mockResolvedValue({ data: xml });
    const service = new ProwlarrService('http://prowlarr', 'key');

    const results = await service.getRssFeed(2);

    expect(results).toHaveLength(0);
  });

  it('detects NZB downloads by protocol or URL', () => {
    expect(ProwlarrService.isNZBResult({ downloadUrl: 'https://x/test.nzb' } as any)).toBe(true);
    expect(ProwlarrService.isNZBResult({ downloadUrl: 'https://x/getnzb?id=1' } as any)).toBe(true);
    expect(ProwlarrService.isNZBResult({ downloadUrl: 'magnet:?xt=urn:btih:abc' } as any)).toBe(false);
    expect(ProwlarrService.isNZBResult({ downloadUrl: 'https://x/file', protocol: 'usenet' } as any)).toBe(true);
  });

  it('applies category, indexer, and seeder filters', async () => {
    // Mock: Only qBittorrent is configured (torrent only)
    downloadClientManagerMock.hasClientForProtocol.mockImplementation(async (protocol: string) => {
      return protocol === 'torrent';
    });
    clientMock.get.mockResolvedValue({
      data: [
        {
          guid: 'g1',
          indexer: 'IndexerA',
          title: 'Book One',
          size: 100,
          publishDate: '2024-01-01T00:00:00.000Z',
          downloadUrl: 'https://example.com/book.torrent',
          protocol: 'torrent',
          seeders: 1,
        },
        {
          guid: 'g2',
          indexer: 'IndexerB',
          title: 'Book Two',
          size: 200,
          publishDate: '2024-01-02T00:00:00.000Z',
          downloadUrl: 'https://example.com/book2.torrent',
          protocol: 'torrent',
          seeders: 10,
        },
      ],
    });

    const service = new ProwlarrService('http://prowlarr', 'key');
    const results = await service.search('Book', {
      categories: [3030, 3040],
      minSeeders: 2,
      maxResults: 1,
      indexerIds: [1, 2],
    });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Book Two');
    expect(clientMock.get).toHaveBeenCalledWith('/search', {
      params: expect.objectContaining({
        categories: [3030, 3040],
        indexerIds: [1, 2],
      }),
      timeout: 180000,
    });
  });

  it('returns unfiltered results when protocol filtering fails', async () => {
    // Mock: hasClientForProtocol throws an error
    downloadClientManagerMock.hasClientForProtocol.mockRejectedValue(new Error('config fail'));

    clientMock.get.mockResolvedValue({
      data: [
        {
          guid: 'g1',
          indexer: 'IndexerA',
          title: 'Book NZB',
          size: 100,
          publishDate: '2024-01-01T00:00:00.000Z',
          downloadUrl: 'https://example.com/book.nzb',
          protocol: 'usenet',
        },
        {
          guid: 'g2',
          indexer: 'IndexerB',
          title: 'Book Torrent',
          size: 200,
          publishDate: '2024-01-02T00:00:00.000Z',
          downloadUrl: 'https://example.com/book.torrent',
          protocol: 'torrent',
        },
      ],
    });

    const service = new ProwlarrService('http://prowlarr', 'key');
    const results = await service.search('Book');

    expect(results).toHaveLength(2);
  });

  it('aggregates RSS feeds and ignores failures', async () => {
    const service = new ProwlarrService('http://prowlarr', 'key');
    const rssSpy = vi.spyOn(service, 'getRssFeed')
      .mockRejectedValueOnce(new Error('bad'))
      .mockResolvedValueOnce([{ guid: 'g1' } as any]);

    const results = await service.getAllRssFeeds([1, 2]);

    expect(rssSpy).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it('skips results without download URLs', () => {
    const service = new ProwlarrService('http://prowlarr', 'key');
    const result = (service as any).transformResult({
      guid: 'g1',
      indexer: 'IndexerA',
      title: 'No URL',
      size: 100,
      publishDate: '2024-01-01T00:00:00.000Z',
    });

    expect(result).toBeNull();
  });

  it('extracts flags from indexer fields and title metadata', () => {
    const service = new ProwlarrService('http://prowlarr', 'key');
    const result = (service as any).transformResult({
      guid: 'g3',
      indexer: 'IndexerA',
      title: 'Book M4A 128kbps',
      size: 100,
      publishDate: '2024-01-01T00:00:00.000Z',
      downloadUrl: 'https://example.com/book.torrent',
      indexerFlags: ['Trusted', 2],
      flags: ['Featured', 'Trusted'],
    });

    expect(result?.flags).toEqual(['Trusted', 'Featured']);
    expect(result?.format).toBe('M4A');
    expect(result?.bitrate).toBe('128kbps');
  });

  it('derives flags from volume factors when no explicit flags exist', () => {
    const service = new ProwlarrService('http://prowlarr', 'key');
    const result = (service as any).transformResult({
      guid: 'g4',
      indexer: 'IndexerB',
      title: 'Book MP3',
      size: 100,
      publishDate: '2024-01-01T00:00:00.000Z',
      downloadUrl: 'https://example.com/book.torrent',
      downloadVolumeFactor: 0,
      uploadVolumeFactor: 2,
    });

    expect(result?.flags).toEqual(['Freeleech', 'Double Upload']);
    expect(result?.format).toBe('MP3');
  });

  it('marks partial freeleech when download volume factor is reduced', () => {
    const service = new ProwlarrService('http://prowlarr', 'key');
    const result = (service as any).transformResult({
      guid: 'g5',
      indexer: 'IndexerC',
      title: 'Book MP3',
      size: 100,
      publishDate: '2024-01-01T00:00:00.000Z',
      downloadUrl: 'https://example.com/book.torrent',
      downloadVolumeFactor: 0.5,
    });

    expect(result?.flags).toEqual(['Partial Freeleech']);
  });

  it('returns null when transformResult throws', () => {
    const service = new ProwlarrService('http://prowlarr', 'key');
    const result = (service as any).transformResult({
      guid: 'g6',
      indexer: 'IndexerD',
      title: null,
      size: 100,
      publishDate: '2024-01-01T00:00:00.000Z',
      downloadUrl: 'https://example.com/book.torrent',
    });

    expect(result).toBeNull();
  });

  it('returns indexers and stats', async () => {
    clientMock.get
      .mockResolvedValueOnce({ data: [{ id: 1, name: 'IndexerA' }] })
      .mockResolvedValueOnce({ data: { indexers: [] } });

    const service = new ProwlarrService('http://prowlarr', 'key');
    const indexers = await service.getIndexers();
    const stats = await service.getStats();

    expect(indexers).toHaveLength(1);
    expect(stats.indexers).toEqual([]);
  });

  it('returns false when connection test fails', async () => {
    clientMock.get.mockRejectedValue(new Error('health down'));

    const service = new ProwlarrService('http://prowlarr', 'key');
    const ok = await service.testConnection();

    expect(ok).toBe(false);
  });

  it('throws when indexer stats cannot be fetched', async () => {
    clientMock.get.mockRejectedValue(new Error('no stats'));

    const service = new ProwlarrService('http://prowlarr', 'key');

    await expect(service.getStats()).rejects.toThrow('Failed to get indexer statistics');
  });

  it('returns a singleton service from configuration', async () => {
    const originalApiKey = process.env.PROWLARR_API_KEY;
    delete process.env.PROWLARR_API_KEY;
    vi.resetModules();

    configMock.getMany.mockResolvedValue({
      prowlarr_url: 'http://prowlarr',
      prowlarr_api_key: 'api-key',
    });
    clientMock.get.mockResolvedValue({ data: {} });

    const { getProwlarrService } = await import('@/lib/integrations/prowlarr.service');
    const serviceA = await getProwlarrService();
    const serviceB = await getProwlarrService();

    expect(serviceA).toBe(serviceB);

    if (originalApiKey === undefined) {
      delete process.env.PROWLARR_API_KEY;
    } else {
      process.env.PROWLARR_API_KEY = originalApiKey;
    }
  });

  it('throws when Prowlarr API key is missing', async () => {
    const originalApiKey = process.env.PROWLARR_API_KEY;
    delete process.env.PROWLARR_API_KEY;
    vi.resetModules();

    configMock.getMany.mockResolvedValue({
      prowlarr_url: 'http://prowlarr',
      prowlarr_api_key: '',
    });

    const { getProwlarrService } = await import('@/lib/integrations/prowlarr.service');
    await expect(getProwlarrService()).rejects.toThrow('Prowlarr API key not configured');

    if (originalApiKey === undefined) {
      delete process.env.PROWLARR_API_KEY;
    } else {
      process.env.PROWLARR_API_KEY = originalApiKey;
    }
  });

  it('returns service even when connection test fails', async () => {
    const originalApiKey = process.env.PROWLARR_API_KEY;
    delete process.env.PROWLARR_API_KEY;
    vi.resetModules();

    configMock.getMany.mockResolvedValue({
      prowlarr_url: 'http://prowlarr',
      prowlarr_api_key: 'api-key',
    });
    clientMock.get.mockRejectedValue(new Error('health down'));

    const { getProwlarrService } = await import('@/lib/integrations/prowlarr.service');
    const service = await getProwlarrService();

    expect(service).toBeDefined();

    if (originalApiKey === undefined) {
      delete process.env.PROWLARR_API_KEY;
    } else {
      process.env.PROWLARR_API_KEY = originalApiKey;
    }
  });

  it('gives the indexer search its own 180 s timeout; other Prowlarr calls keep 60 s (#601)', async () => {
    downloadClientManagerMock.hasClientForProtocol.mockResolvedValue(true);
    clientMock.get.mockResolvedValue({ data: [] });
    axiosMock.get.mockResolvedValue({ data: '<rss><channel></channel></rss>' });

    const service = new ProwlarrService('http://prowlarr', 'key');
    await service.search('Book');
    await service.getIndexers();
    await service.getRssFeed(1);

    // The shared client keeps the 60 s download-client timeout (/indexer, /health, /indexerstats)
    expect(axiosMock.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60000 }));
    expect(clientMock.get).toHaveBeenCalledWith('/search', expect.objectContaining({ timeout: 180000 }));
    expect(clientMock.get).toHaveBeenCalledWith('/indexer');
    expect(axiosMock.get).toHaveBeenCalledWith('http://prowlarr/1/api', expect.objectContaining({ timeout: 60000 }));
  });
});
