/**
 * Component: Download Selection Guard Route Tests
 * Documentation: documentation/phase3/download-clients.md
 *
 * Client-supplied (or stored) release picks may only point at a magnet link or a
 * Prowlarr download link; Anna's Archive links are rebuilt from the md5.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const PROWLARR = 'http://prowlarr:9696';
const ANNAS = 'https://annas.example';
const MD5 = '0123456789abcdef0123456789abcdef';
const EVIL = 'http://evil.example/collect';

let authRequest: any;
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));
const slowLinksMock = vi.hoisted(() => vi.fn());
const replaceAudiobookMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler(authRequest),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getMany: async () => ({ prowlarr_url: PROWLARR, prowlarr_api_key: 'test-prowlarr-key' }),
    get: async (key: string) => (key === 'ebook_sidecar_base_url' ? ANNAS : null),
    getAudibleRegion: async () => 'us',
  }),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/ebook-scraper', () => ({ getSlowDownloadLinks: slowLinksMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => ({ plexGuid: 'plex-1' }) }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: async () => ({ title: 'Title', author: 'Author' }) }),
}));
vi.mock('@/lib/services/reported-issue.service', () => ({
  replaceAudiobook: replaceAudiobookMock,
  ReportedIssueError: class extends Error {},
}));

const torrent = (downloadUrl: string) => ({
  guid: 'guid-1', title: 'Release', size: 100, indexer: 'Indexer', downloadUrl, publishDate: '2024-01-01',
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('download selection guard on routes', () => {
  beforeEach(() => {
    authRequest = { user: { id: 'user-1', sub: 'user-1', role: 'user' }, json: vi.fn() };
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1', role: 'admin', interactiveSearchAccess: null, autoApproveRequests: null, plexUsername: 'user',
    });
    slowLinksMock.mockResolvedValue([`${ANNAS}/slow_download/${MD5}/0/0`, `${ANNAS}/slow_download/${MD5}/0/1`]);
  });

  describe.each([
    ['another origin', EVIL],
    ['a non-download Prowlarr path', `${PROWLARR}/api/v1/indexer`],
    ['a look-alike origin', 'http://prowlarr:9697/1/download'],
    ['a magnet with an embedded newline', 'magnet:?xt=urn:btih:abc\nhttp://evil.example/collect'],
    ['a magnet with embedded whitespace', 'magnet:?xt=urn:btih:abc\thttp://evil.example/collect'],
  ])('rejects a download URL on %s', (_label, url) => {
    it('POST /api/audiobooks/request-with-torrent → 400', async () => {
      authRequest.json.mockResolvedValue({
        audiobook: { asin: 'B000000001', title: 'Title', author: 'Author' },
        torrent: torrent(url),
      });
      const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
      const response = await POST({} as any);

      expect(response.status).toBe(400);
      expect(prismaMock.request.create).not.toHaveBeenCalled();
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it('POST /api/requests/[id]/select-torrent → 400', async () => {
      authRequest.json.mockResolvedValue({ torrent: torrent(url) });
      const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
      const response = await POST({} as any, params('req-1'));

      expect(response.status).toBe(400);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it('POST /api/audiobooks/[asin]/select-ebook (indexer pick) → 400', async () => {
      const request = { json: async () => ({ ebook: { ...torrent(url), source: 'prowlarr', score: 1, finalScore: 1 } }) };
      const { POST } = await import('@/app/api/audiobooks/[asin]/select-ebook/route');
      const response = await POST(request as any, { params: Promise.resolve({ asin: 'B000000001' }) });

      expect(response.status).toBe(400);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it('POST /api/admin/reported-issues/[id]/replace → 400', async () => {
      authRequest.json.mockResolvedValue({ torrent: torrent(url) });
      const { POST } = await import('@/app/api/admin/reported-issues/[id]/replace/route');
      const response = await POST({} as any, params('issue-1'));

      expect(response.status).toBe(400);
      expect(replaceAudiobookMock).not.toHaveBeenCalled();
    });

    it('POST /api/admin/requests/[id]/approve with a stored user pick → approves with automatic search', async () => {
      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1', userId: 'user-2', type: 'audiobook', status: 'awaiting_approval',
        selectedTorrent: torrent(url),
        audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
        user: { id: 'user-2', plexUsername: 'other' },
      });
      prismaMock.request.update.mockResolvedValue({ id: 'req-1', userId: 'user-2', audiobook: { id: 'ab-1', title: 'Title', author: 'Author' }, user: {} });
      const request = { json: async () => ({ action: 'approve' }) };
      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(request as any, params('req-1'));

      expect(response.status).toBe(200);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
      expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
      expect(prismaMock.request.update.mock.calls[0][0].data.status).toBe('pending');
      expect(prismaMock.request.update.mock.calls[0][0].data.selectedTorrent).toBeDefined();
    });

    it('POST /api/admin/requests/[id]/approve with an admin-provided pick → 400', async () => {
      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1', userId: 'user-2', type: 'audiobook', status: 'awaiting_approval', selectedTorrent: null,
        audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
        user: { id: 'user-2', plexUsername: 'other' },
      });
      const request = { json: async () => ({ action: 'approve', selectedTorrent: torrent(url) }) };
      const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
      const response = await POST(request as any, params('req-1'));

      expect(response.status).toBe(400);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
      expect(prismaMock.request.update).not.toHaveBeenCalled();
    });
  });

  it('rebuilds Anna\'s Archive links from the md5 and ignores client-supplied URLs', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: 'Title', author: 'Author' });
    prismaMock.request.findFirst.mockResolvedValue(null);
    prismaMock.request.create.mockResolvedValue({ id: 'ebook-1' });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
    const request = {
      json: async () => ({
        ebook: { source: 'annas_archive', md5: MD5, downloadUrl: EVIL, downloadUrls: [EVIL], title: 'Book', score: 100 },
      }),
    };

    const { POST } = await import('@/app/api/audiobooks/[asin]/select-ebook/route');
    const response = await POST(request as any, { params: Promise.resolve({ asin: 'B000000001' }) });

    expect(response.status).toBe(200);
    expect(slowLinksMock).toHaveBeenCalledWith(MD5, ANNAS, undefined, undefined, { throwOnError: true });
    const [, , queuedUrl] = jobQueueMock.addStartDirectDownloadJob.mock.calls[0];
    expect(queuedUrl).toBe(`${ANNAS}/slow_download/${MD5}/0/0`);
    expect(JSON.stringify(prismaMock.downloadHistory.update.mock.calls)).not.toContain('evil.example');
  });

  it('rejects an Anna\'s Archive pick without a valid md5', async () => {
    const request = { json: async () => ({ ebook: { source: 'annas_archive', md5: '../x', downloadUrl: EVIL } }) };
    const { POST } = await import('@/app/api/audiobooks/[asin]/select-ebook/route');
    const response = await POST(request as any, { params: Promise.resolve({ asin: 'B000000001' }) });

    expect(response.status).toBe(400);
    expect(slowLinksMock).not.toHaveBeenCalled();
    expect(jobQueueMock.addStartDirectDownloadJob).not.toHaveBeenCalled();
  });

  it('rebuilds a stored Anna\'s Archive pick at admin approval', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-2', userId: 'user-2', type: 'ebook', status: 'awaiting_approval',
      selectedTorrent: { source: 'annas_archive', md5: MD5, downloadUrl: EVIL, downloadUrls: [EVIL] },
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
      user: { id: 'user-2', plexUsername: 'other' },
    });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-2' });
    prismaMock.request.update.mockResolvedValue({ id: 'req-2', audiobook: { title: 'Title', author: 'Author' }, user: {} });
    const request = { json: async () => ({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    await POST(request as any, params('req-2'));

    const [, , queuedUrl] = jobQueueMock.addStartDirectDownloadJob.mock.calls[0];
    expect(queuedUrl).toBe(`${ANNAS}/slow_download/${MD5}/0/0`);
  });

  it('approves with an automatic search when a stored Anna\'s Archive pick has no links any more', async () => {
    slowLinksMock.mockResolvedValue([]);
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-3', userId: 'user-2', type: 'ebook', status: 'awaiting_approval',
      selectedTorrent: { source: 'annas_archive', md5: MD5 },
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
      user: { id: 'user-2', plexUsername: 'other' },
    });
    prismaMock.request.update.mockResolvedValue({ id: 'req-3', userId: 'user-2', audiobook: { id: 'ab-1', title: 'Title', author: 'Author' }, user: {} });
    const request = { json: async () => ({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, params('req-3'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobQueueMock.addStartDirectDownloadJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalled();
    // The admin is told the user's pick was dropped
    expect(body.selectionDropped).toContain('No Anna');
    expect(body.message).toContain('could not be used');
  });

  it('keeps the stored pick and returns 503 when Anna\'s Archive cannot be reached at approval', async () => {
    slowLinksMock.mockRejectedValue(new Error('FlareSolverr timeout'));
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-4', userId: 'user-2', type: 'ebook', status: 'awaiting_approval',
      selectedTorrent: { source: 'annas_archive', md5: MD5 },
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
      user: { id: 'user-2', plexUsername: 'other' },
    });
    const request = { json: async () => ({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, params('req-4'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.message).toContain('Try again');
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addStartDirectDownloadJob).not.toHaveBeenCalled();
  });

  it('returns 503 (not 400) for an e-book pick when Anna\'s Archive cannot be reached', async () => {
    slowLinksMock.mockRejectedValue(new Error('ECONNRESET'));
    const request = { json: async () => ({ ebook: { source: 'annas_archive', md5: MD5, title: 'Book', score: 100 } }) };

    const { POST } = await import('@/app/api/audiobooks/[asin]/select-ebook/route');
    const response = await POST(request as any, { params: Promise.resolve({ asin: 'B000000001' }) });

    expect(response.status).toBe(503);
    expect(jobQueueMock.addStartDirectDownloadJob).not.toHaveBeenCalled();
  });
});
