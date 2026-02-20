/**
 * Component: Request Action API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));
const rankTorrentsMock = vi.hoisted(() => vi.fn());
const configServiceMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn().mockResolvedValue('us') }));
const groupIndexersMock = vi.hoisted(() => vi.fn());
const groupDescriptionMock = vi.hoisted(() => vi.fn(() => 'Group'));
const configState = vi.hoisted(() => ({
  values: new Map<string, string>(),
}));
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addDownloadJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
  addSearchEbookJob: vi.fn(() => Promise.resolve()),
}));
const downloadEbookMock = vi.hoisted(() => vi.fn());
const audibleServiceMock = vi.hoisted(() => ({
  getRuntime: vi.fn(),
}));
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

vi.mock('@/lib/utils/indexer-grouping', () => ({
  groupIndexersByCategories: groupIndexersMock,
  getGroupDescription: groupDescriptionMock,
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

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock, constants: { R_OK: 4 } }));

describe('Request action routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
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

  it('performs interactive search and ranks results with runtime from ASIN', async () => {
    authRequest.json.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-1',
      userId: 'user-1',
      audiobook: { title: 'Title', author: 'Author', audibleAsin: 'B00ASIN123' },
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'user',
      interactiveSearchAccess: null,
    });
    configServiceMock.get.mockResolvedValueOnce(JSON.stringify([{ id: 1, priority: 10, categories: [3030] }]));
    configServiceMock.get.mockResolvedValueOnce(null);
    groupIndexersMock.mockReturnValue({ groups: [{ categories: [3030], indexerIds: [1] }], skippedIndexers: [] });
    prowlarrMock.searchWithVariations.mockResolvedValueOnce([{ title: 'Result', size: 500 * 1024 * 1024 }]);
    audibleServiceMock.getRuntime.mockResolvedValueOnce(600);
    rankTorrentsMock.mockReturnValueOnce([
      { title: 'Result', size: 500 * 1024 * 1024, score: 50, breakdown: { matchScore: 50, formatScore: 0, sizeScore: 12, seederScore: 0, notes: [] }, bonusPoints: 0, bonusModifiers: [], finalScore: 62 },
    ]);

    const { POST } = await import('@/app/api/requests/[id]/interactive-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.results[0].rank).toBe(1);
    expect(audibleServiceMock.getRuntime).toHaveBeenCalledWith('B00ASIN123');
    expect(rankTorrentsMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ title: 'Title', author: 'Author', durationMinutes: 600 }),
      expect.any(Object)
    );
  });

  it('performs interactive search without runtime when no ASIN', async () => {
    authRequest.json.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-1b',
      userId: 'user-1',
      audiobook: { title: 'Title', author: 'Author', audibleAsin: null },
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'user',
      interactiveSearchAccess: null,
    });
    configServiceMock.get.mockResolvedValueOnce(JSON.stringify([{ id: 1, priority: 10, categories: [3030] }]));
    configServiceMock.get.mockResolvedValueOnce(null);
    groupIndexersMock.mockReturnValue({ groups: [{ categories: [3030], indexerIds: [1] }], skippedIndexers: [] });
    prowlarrMock.searchWithVariations.mockResolvedValueOnce([{ title: 'Result', size: 100 }]);
    rankTorrentsMock.mockReturnValueOnce([
      { title: 'Result', size: 100, score: 50, breakdown: { matchScore: 50, formatScore: 0, sizeScore: 0, seederScore: 0, notes: [] }, bonusPoints: 0, bonusModifiers: [], finalScore: 50 },
    ]);

    const { POST } = await import('@/app/api/requests/[id]/interactive-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-1b' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(audibleServiceMock.getRuntime).not.toHaveBeenCalled();
    expect(rankTorrentsMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ title: 'Title', author: 'Author', durationMinutes: undefined }),
      expect.any(Object)
    );
  });

  it('performs interactive search gracefully when runtime fetch fails', async () => {
    authRequest.json.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-1c',
      userId: 'user-1',
      audiobook: { title: 'Title', author: 'Author', audibleAsin: 'B00FAIL' },
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'user',
      interactiveSearchAccess: null,
    });
    configServiceMock.get.mockResolvedValueOnce(JSON.stringify([{ id: 1, priority: 10, categories: [3030] }]));
    configServiceMock.get.mockResolvedValueOnce(null);
    groupIndexersMock.mockReturnValue({ groups: [{ categories: [3030], indexerIds: [1] }], skippedIndexers: [] });
    prowlarrMock.searchWithVariations.mockResolvedValueOnce([{ title: 'Result', size: 100 }]);
    audibleServiceMock.getRuntime.mockRejectedValueOnce(new Error('Network error'));
    rankTorrentsMock.mockReturnValueOnce([
      { title: 'Result', size: 100, score: 50, breakdown: { matchScore: 50, formatScore: 0, sizeScore: 0, seederScore: 0, notes: [] }, bonusPoints: 0, bonusModifiers: [], finalScore: 50 },
    ]);

    const { POST } = await import('@/app/api/requests/[id]/interactive-search/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-1c' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.results).toHaveLength(1);
    expect(rankTorrentsMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ durationMinutes: undefined }),
      expect.any(Object)
    );
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

  it('creates ebook request and triggers search job', async () => {
    configState.values.set('ebook_sidecar_enabled', 'true');

    // Mock parent request lookup
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-6',
      userId: 'user-1',
      audiobookId: 'ab-1',
      status: 'downloaded',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN123' },
    });

    // Mock check for existing ebook request
    prismaMock.request.findFirst.mockResolvedValueOnce(null);

    // Mock ebook request creation
    prismaMock.request.create.mockResolvedValueOnce({
      id: 'ebook-req-1',
      type: 'ebook',
      parentRequestId: 'req-6',
    });

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-6' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.message).toMatch(/created/i);
    expect(payload.requestId).toBe('ebook-req-1');
    expect(prismaMock.request.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ebook',
        parentRequestId: 'req-6',
        status: 'pending',
      }),
    });
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
      'ebook-req-1',
      expect.objectContaining({
        id: 'ab-1',
        title: 'Title',
        author: 'Author',
        asin: 'ASIN123',
      })
    );
  });

  it('retries existing failed ebook request', async () => {
    configState.values.set('ebook_sidecar_enabled', 'true');

    // Mock parent request lookup
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-7',
      userId: 'user-1',
      audiobookId: 'ab-1',
      status: 'available',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN123' },
    });

    // Mock existing failed ebook request
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'ebook-req-existing',
      status: 'failed',
    });

    // Mock update for retry
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'ebook-req-existing',
      status: 'pending',
    });

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-7' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.message).toMatch(/retried/i);
    expect(payload.requestId).toBe('ebook-req-existing');
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'ebook-req-existing' },
      data: expect.objectContaining({
        status: 'pending',
        progress: 0,
        errorMessage: null,
      }),
    });
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalled();
  });

  it('returns message when ebook request already exists and in progress', async () => {
    configState.values.set('ebook_sidecar_enabled', 'true');

    // Mock parent request lookup
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-8',
      userId: 'user-1',
      audiobookId: 'ab-1',
      status: 'downloaded',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN123' },
    });

    // Mock existing in-progress ebook request
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'ebook-req-existing',
      status: 'downloading',
    });

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-8' }) });
    const payload = await response.json();

    expect(payload.success).toBe(false);
    expect(payload.message).toMatch(/already exists/i);
    expect(payload.requestId).toBe('ebook-req-existing');
    // Should not create new request or trigger search
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
  });
});


