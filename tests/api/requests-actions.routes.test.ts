/**
 * Component: Request Action API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn() }));
const rankTorrentsMock = vi.hoisted(() => vi.fn());
const configServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
const configState = vi.hoisted(() => ({
  values: new Map<string, string>(),
}));
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addDownloadJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));
const downloadEbookMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: vi.fn((req: any, handler: any) => handler()),
}));

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  getProwlarrService: async () => prowlarrMock,
}));

vi.mock('@/lib/utils/ranking-algorithm', () => ({
  rankTorrents: rankTorrentsMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/ebook-scraper', () => ({
  downloadEbook: downloadEbookMock,
}));

vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock, constants: { R_OK: 4 } }));

describe('Request action routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configState.values.clear();
    authRequest = { user: { id: 'user-1', role: 'user' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    prismaMock.configuration.findUnique.mockImplementation(
      async ({ where: { key } }: { where: { key: string } }) => {
        const value = configState.values.get(key);
        return value !== undefined ? { value } : null;
      }
    );
  });

  it('performs interactive search and ranks results', async () => {
    authRequest.json.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-1',
      userId: 'user-1',
      audiobook: { title: 'Title', author: 'Author' },
    });
    configServiceMock.get.mockResolvedValueOnce(JSON.stringify([{ id: 1, priority: 10 }]));
    configServiceMock.get.mockResolvedValueOnce(null);
    prowlarrMock.search.mockResolvedValueOnce([{ title: 'Result', size: 100 }]);
    rankTorrentsMock.mockReturnValueOnce([
      { title: 'Result', score: 50, breakdown: { matchScore: 50, formatScore: 0, seederScore: 0, notes: [] }, bonusPoints: 0, bonusModifiers: [], finalScore: 50 },
    ]);

    const { POST } = await import('@/app/api/requests/[id]/interactive-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.results[0].rank).toBe(1);
  });

  it('triggers manual search job', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-2',
      userId: 'user-1',
      status: 'failed',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN' },
    });
    prismaMock.request.update.mockResolvedValueOnce({ id: 'req-2', status: 'pending' });

    const { POST } = await import('@/app/api/requests/[id]/manual-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-2' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
  });

  it('returns 401 when manual search user is not authenticated', async () => {
    authRequest.user = null;

    const { POST } = await import('@/app/api/requests/[id]/manual-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-auth' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 404 when manual search request is missing', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/requests/[id]/manual-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('NotFound');
  });

  it('returns 403 when manual search request is not owned', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-9',
      userId: 'user-2',
      status: 'failed',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN' },
    });

    const { POST } = await import('@/app/api/requests/[id]/manual-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-9' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('returns 400 when manual search status is not eligible', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-10',
      userId: 'user-1',
      status: 'downloading',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN' },
    });

    const { POST } = await import('@/app/api/requests/[id]/manual-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-10' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('selects a torrent and queues download', async () => {
    authRequest.json.mockResolvedValue({ torrent: { title: 'Torrent', size: 100 } });
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-3',
      userId: 'user-1',
      status: 'awaiting_search',
      audiobook: { id: 'ab-2', title: 'Title', author: 'Author' },
    } as any);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'admin',
      autoApproveRequests: null,
      plexUsername: 'testuser',
    } as any);
    prismaMock.request.update.mockResolvedValueOnce({ id: 'req-3', status: 'downloading', audiobook: { title: 'Title' } } as any);

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-3' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    authRequest.user = null;

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-auth' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 400 when torrent data is missing', async () => {
    authRequest.json.mockResolvedValue({});

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-missing-torrent' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 404 when request is not found', async () => {
    authRequest.json.mockResolvedValue({ torrent: { title: 'Torrent', size: 100 } });
    prismaMock.request.findUnique.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('NotFound');
  });

  it('returns 403 when user does not own the request', async () => {
    authRequest.json.mockResolvedValue({ torrent: { title: 'Torrent', size: 100 } });
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-4',
      userId: 'user-2',
      status: 'awaiting_search',
      audiobook: { id: 'ab-2', title: 'Title', author: 'Author' },
    } as any);

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-4' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('returns 403 when request is awaiting approval', async () => {
    authRequest.json.mockResolvedValue({ torrent: { title: 'Torrent', size: 100 } });
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-5',
      userId: 'user-1',
      status: 'awaiting_approval',
      audiobook: { id: 'ab-2', title: 'Title', author: 'Author' },
    } as any);

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('AwaitingApproval');
  });

  it('stores selected torrent when approval is required by global setting', async () => {
    authRequest.json.mockResolvedValue({ torrent: { title: 'Torrent', size: 100 } });
    configState.values.set('auto_approve_requests', 'false');
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-6',
      userId: 'user-1',
      status: 'awaiting_search',
      audiobook: { id: 'ab-3', title: 'Title', author: 'Author' },
    } as any);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'user',
      autoApproveRequests: null,
      plexUsername: 'plexuser',
    } as any);
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-6',
      status: 'awaiting_approval',
      audiobook: { title: 'Title', author: 'Author' },
    } as any);

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-6' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.message).toMatch(/approval/i);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalled();
  });

  it('auto-approves when global setting is missing and user has no preference', async () => {
    authRequest.json.mockResolvedValue({ torrent: { title: 'Torrent', size: 100 } });
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-7',
      userId: 'user-1',
      status: 'awaiting_search',
      audiobook: { id: 'ab-4', title: 'Title', author: 'Author' },
    } as any);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'user',
      autoApproveRequests: null,
      plexUsername: 'plexuser',
    } as any);
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-7',
      status: 'downloading',
      audiobook: { title: 'Title', author: 'Author' },
    } as any);

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-7' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalled();
  });

  it('returns error when ebook sidecar is disabled', async () => {
    configState.values.set('ebook_sidecar_enabled', 'false');

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-4' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not enabled/);
  });

  it('returns 404 when request is not found', async () => {
    configState.values.set('ebook_sidecar_enabled', 'true');
    prismaMock.request.findUnique.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/not found/);
  });

  it('returns 400 when request status is not eligible for ebook fetch', async () => {
    configState.values.set('ebook_sidecar_enabled', 'true');
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-5',
      status: 'pending',
      audiobook: { title: 'Title', author: 'Author', audibleAsin: 'ASIN' },
    });

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Cannot fetch e-book/);
  });

  it('returns 400 when audiobook directory is missing', async () => {
    configState.values.set('ebook_sidecar_enabled', 'true');
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-6',
      status: 'downloaded',
      audiobook: { title: 'Title', author: 'Author', audibleAsin: 'ASIN' },
    });
    fsMock.access.mockRejectedValueOnce(new Error('missing'));

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-6' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/directory not found/);
  });

  it('downloads ebook and returns success', async () => {
    configState.values.set('ebook_sidecar_enabled', 'true');
    configState.values.set('media_dir', '/media/audiobooks');
    configState.values.set('audiobook_path_template', '{author}/{title} {asin}');
    configState.values.set('ebook_sidecar_preferred_format', 'epub');
    configState.values.set('ebook_sidecar_base_url', 'https://ebooks.example');
    configState.values.set('ebook_sidecar_flaresolverr_url', 'http://flaresolverr');

    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-7',
      status: 'available',
      audiobook: { title: 'Title', author: 'Author', audibleAsin: 'ASIN123' },
    });
    prismaMock.audibleCache.findUnique.mockResolvedValueOnce({ releaseDate: '2022-05-01' });
    fsMock.access.mockResolvedValueOnce(undefined);
    downloadEbookMock.mockResolvedValueOnce({
      success: true,
      format: 'epub',
      filePath: '/media/audiobooks/Author/Title ASIN123/Title.epub',
    });

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-7' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(downloadEbookMock).toHaveBeenCalledWith(
      'ASIN123',
      'Title',
      'Author',
      expect.stringContaining('Title ASIN123'),
      'epub',
      'https://ebooks.example',
      undefined,
      'http://flaresolverr'
    );
  });

  it('returns failure payload when ebook download fails', async () => {
    configState.values.set('ebook_sidecar_enabled', 'true');
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-8',
      status: 'downloaded',
      audiobook: { title: 'Title', author: 'Author', audibleAsin: 'ASIN123' },
    });
    fsMock.access.mockResolvedValueOnce(undefined);
    downloadEbookMock.mockResolvedValueOnce({
      success: false,
      error: 'Download failed',
    });

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-8' }) });
    const payload = await response.json();

    expect(payload.success).toBe(false);
    expect(payload.message).toMatch(/Download failed/);
  });
});


