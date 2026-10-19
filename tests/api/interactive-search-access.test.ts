/**
 * Component: Interactive Search Access + Prowlarr Key Exposure Route Tests
 * Documentation: documentation/phase3/download-clients.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const KEY = 'test-prowlarr-key';
const PROWLARR_LINK = `http://prowlarr:9696/1/download?apikey=${KEY}&link=abc`;

let authRequest: any;
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addDownloadJob: vi.fn(), addNotificationJob: vi.fn() }));
const prowlarrMock = vi.hoisted(() => ({ searchWithVariations: vi.fn() }));
const rankTorrentsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler(authRequest),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getMany: async () => ({ prowlarr_url: 'http://prowlarr:9696', prowlarr_api_key: KEY }),
    get: async (key: string) =>
      key === 'prowlarr_indexers' ? JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10 }]) : null,
    getAudibleRegion: async () => 'us',
  }),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: async () => prowlarrMock }));
vi.mock('@/lib/utils/ranking-algorithm', () => ({ rankTorrents: rankTorrentsMock }));
vi.mock('@/lib/utils/indexer-grouping', () => ({
  groupIndexersByCategories: () => ({ groups: [{ categories: [3030], indexerIds: [1] }], skippedIndexers: [] }),
  getGroupDescription: () => 'Group',
}));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: async () => null, getRuntime: async () => null }),
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => null }));

const torrent = { guid: 'g', title: 'T', size: 1, indexer: 'I', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' };

/** Prisma-like projection so the test sees exactly what the route's select returns. */
function project(record: any, select?: Record<string, any>): any {
  if (!select || record == null) return record;
  if (Array.isArray(record)) return record.map((item) => project(item, select));
  const out: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(select)) {
    if (rule === true) out[field] = record[field];
    else if (rule && typeof rule === 'object') out[field] = project(record[field], rule.select);
  }
  return out;
}

describe('interactive search access is enforced server-side', () => {
  beforeEach(() => {
    authRequest = { user: { id: 'user-1', role: 'user' }, json: vi.fn() };
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', interactiveSearchAccess: false });
  });

  it.each([
    ['POST /api/audiobooks/search-torrents', '@/app/api/audiobooks/search-torrents/route', { title: 'T', author: 'A' }, undefined],
    ['POST /api/audiobooks/request-with-torrent', '@/app/api/audiobooks/request-with-torrent/route',
      { audiobook: { asin: 'B000000001', title: 'T', author: 'A' }, torrent }, undefined],
    ['POST /api/requests/[id]/select-torrent', '@/app/api/requests/[id]/select-torrent/route', { torrent }, { id: 'req-1' }],
  ])('%s → 403 when the permission is off', async (_label, modulePath, body, routeParams) => {
    authRequest.json.mockResolvedValue(body);
    const { POST } = await import(modulePath);
    const response = routeParams
      ? await POST({} as any, { params: Promise.resolve(routeParams) })
      : await POST({} as any);

    expect(response.status).toBe(403);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(prowlarrMock.searchWithVariations).not.toHaveBeenCalled();
  });

  it('POST /api/audiobooks/[asin]/select-ebook → 403 when the permission is off', async () => {
    const request = { json: async () => ({ ebook: { ...torrent, source: 'prowlarr' } }) };
    const { POST } = await import('@/app/api/audiobooks/[asin]/select-ebook/route');
    const response = await POST(request as any, { params: Promise.resolve({ asin: 'B000000001' }) });

    expect(response.status).toBe(403);
  });
});

describe('Prowlarr key never reaches the browser', () => {
  beforeEach(() => {
    authRequest = { user: { id: 'user-1', role: 'user' }, json: vi.fn() };
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', interactiveSearchAccess: true });
  });

  it('search-torrents strips the configured key from every URL field, on any origin', async () => {
    authRequest.json.mockResolvedValue({ title: 'T', author: 'A' });
    const result = {
      title: 'Release', size: 1, indexer: 'I', indexerId: 1, seeders: 1, publishDate: new Date('2024-01-01'),
      downloadUrl: PROWLARR_LINK,
      magnetUrl: `https://mirror.example/m?apikey=${KEY}`,
      guid: `https://indexer.example/details?apikey=${KEY}&id=1`,
      infoUrl: `https://indexer.example/info?id=1&apikey=indexer-own-key`,
      score: 1, finalScore: 1, bonusPoints: 0, bonusModifiers: [], breakdown: { matchScore: 1, formatScore: 0, sizeScore: 0, seederScore: 0, notes: [] },
    };
    prowlarrMock.searchWithVariations.mockResolvedValue([result]);
    rankTorrentsMock.mockReturnValue([result]);

    const { POST } = await import('@/app/api/audiobooks/search-torrents/route');
    const response = await POST({} as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(body.results[0].downloadUrl).toBe('http://prowlarr:9696/1/download?link=abc');
    expect(body.results[0].infoUrl).toContain('apikey=indexer-own-key');
  });

  it('GET /api/requests omits stored release picks for non-admins', async () => {
    authRequest = { user: { id: 'user-1', role: 'user' }, nextUrl: new URL('http://localhost/api/requests'), json: vi.fn() };
    prismaMock.request.findMany.mockResolvedValue([{
      id: 'req-1', userId: 'user-1', status: 'awaiting_approval', audiobook: { id: 'ab-1' }, user: { id: 'user-1' },
      selectedTorrent: { downloadUrl: PROWLARR_LINK },
    }]);
    prismaMock.request.count.mockResolvedValue(1);

    const { GET } = await import('@/app/api/requests/route');
    const response = await GET({ nextUrl: new URL('http://localhost/api/requests') } as any);
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(text).toContain('req-1');
    expect(text).not.toContain(KEY);
  });

  describe.each([
    ['owner session', { id: 'user-1', role: 'user' }],
    ['API token', { id: 'user-1', role: 'user', tokenId: 'tok-1' }],
  ])('GET /api/requests/[id] for an %s', (_label, user) => {
    it('omits job payloads, source links and stored picks, and contains no key', async () => {
      authRequest = { user, json: vi.fn() };
      const stored = {
        id: 'req-1', userId: 'user-1', audiobookId: 'ab-1', status: 'failed', progress: 0, type: 'audiobook',
        errorMessage: `Grab failed: ${PROWLARR_LINK}`,
        selectedTorrent: { downloadUrl: `CANARY-selected ${PROWLARR_LINK}` },
        audiobook: { id: 'ab-1', title: 'T', author: 'A', filePath: '/media/CANARY-filePath' },
        user: { id: 'user-1', plexUsername: 'owner' },
        downloadHistory: [{
          id: 'dh-1', downloadStatus: 'failed', torrentSizeBytes: null, downloadPath: '/downloads/CANARY-downloadPath',
          magnetLink: `CANARY-magnet ${PROWLARR_LINK}`, torrentUrl: 'CANARY-torrentUrl',
        }],
        jobs: [{
          id: 'job-1', type: 'download_torrent', status: 'failed',
          payload: { torrent: { downloadUrl: `CANARY-payload ${PROWLARR_LINK}` } },
          result: 'CANARY-result', stackTrace: 'CANARY-stack',
        }],
      };
      prismaMock.request.findFirst.mockImplementation(async (args: any) => project(stored, args.select));

      const { GET } = await import('@/app/api/requests/[id]/route');
      const response = await GET({} as any, { params: Promise.resolve({ id: 'req-1' }) });
      const body = await response.json();
      const text = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('CANARY');
      expect(body.request.status).toBe('failed');
      expect(body.request.downloadHistory[0].downloadStatus).toBe('failed');
      expect(body.request.jobs[0].type).toBe('download_torrent');
    });
  });
});
