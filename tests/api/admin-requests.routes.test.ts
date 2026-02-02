/**
 * Component: Admin Requests API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const deleteRequestMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addSearchJob: vi.fn(),
  addNotificationJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/request-delete.service', () => ({
  deleteRequest: deleteRequestMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

describe('Admin requests routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  it('returns recent requests (legacy endpoint)', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([
      {
        id: 'req-1',
        status: 'pending',
        createdAt: new Date(),
        completedAt: null,
        errorMessage: null,
        audiobook: { title: 'Title', author: 'Author' },
        user: { plexUsername: 'user' },
        downloadHistory: [{ torrentUrl: 'http://torrent' }],
      },
    ]);

    const { GET } = await import('@/app/api/admin/requests/recent/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.requests).toHaveLength(1);
    expect(payload.requests[0].torrentUrl).toBe('http://torrent');
  });

  it('returns paginated requests with default params', async () => {
    prismaMock.request.count.mockResolvedValueOnce(1);
    prismaMock.request.findMany.mockResolvedValueOnce([
      {
        id: 'req-1',
        status: 'pending',
        createdAt: new Date(),
        completedAt: null,
        errorMessage: null,
        audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
        user: { id: 'u-1', plexUsername: 'user' },
        downloadHistory: [{ torrentUrl: 'http://torrent' }],
      },
    ]);

    const mockRequest = {
      url: 'http://localhost/api/admin/requests',
    };

    const { GET } = await import('@/app/api/admin/requests/route');
    const response = await GET(mockRequest as any);
    const payload = await response.json();

    expect(payload.requests).toHaveLength(1);
    expect(payload.total).toBe(1);
    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(25);
    expect(payload.totalPages).toBe(1);
    expect(payload.requests[0].userId).toBe('u-1');
  });

  it('filters requests by status', async () => {
    prismaMock.request.count.mockResolvedValueOnce(1);
    prismaMock.request.findMany.mockResolvedValueOnce([
      {
        id: 'req-1',
        status: 'failed',
        createdAt: new Date(),
        completedAt: null,
        errorMessage: 'Search failed',
        audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
        user: { id: 'u-1', plexUsername: 'user' },
        downloadHistory: [],
      },
    ]);

    const mockRequest = {
      url: 'http://localhost/api/admin/requests?status=failed',
    };

    const { GET } = await import('@/app/api/admin/requests/route');
    const response = await GET(mockRequest as any);
    const payload = await response.json();

    expect(payload.requests).toHaveLength(1);
    expect(payload.requests[0].status).toBe('failed');
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'failed',
        }),
      })
    );
  });

  it('filters requests by userId', async () => {
    prismaMock.request.count.mockResolvedValueOnce(1);
    prismaMock.request.findMany.mockResolvedValueOnce([
      {
        id: 'req-1',
        status: 'pending',
        createdAt: new Date(),
        completedAt: null,
        errorMessage: null,
        audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
        user: { id: 'user-123', plexUsername: 'specificuser' },
        downloadHistory: [],
      },
    ]);

    const mockRequest = {
      url: 'http://localhost/api/admin/requests?userId=user-123',
    };

    const { GET } = await import('@/app/api/admin/requests/route');
    const response = await GET(mockRequest as any);
    const payload = await response.json();

    expect(payload.requests).toHaveLength(1);
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-123',
        }),
      })
    );
  });

  it('searches requests by title/author', async () => {
    prismaMock.request.count.mockResolvedValueOnce(1);
    prismaMock.request.findMany.mockResolvedValueOnce([
      {
        id: 'req-1',
        status: 'pending',
        createdAt: new Date(),
        completedAt: null,
        errorMessage: null,
        audiobook: { id: 'ab-1', title: 'Harry Potter', author: 'J.K. Rowling' },
        user: { id: 'u-1', plexUsername: 'user' },
        downloadHistory: [],
      },
    ]);

    const mockRequest = {
      url: 'http://localhost/api/admin/requests?search=Harry',
    };

    const { GET } = await import('@/app/api/admin/requests/route');
    const response = await GET(mockRequest as any);
    const payload = await response.json();

    expect(payload.requests).toHaveLength(1);
    expect(payload.requests[0].title).toBe('Harry Potter');
  });

  it('paginates requests correctly', async () => {
    prismaMock.request.count.mockResolvedValueOnce(100);
    prismaMock.request.findMany.mockResolvedValueOnce([]);

    const mockRequest = {
      url: 'http://localhost/api/admin/requests?page=3&pageSize=10',
    };

    const { GET } = await import('@/app/api/admin/requests/route');
    const response = await GET(mockRequest as any);
    const payload = await response.json();

    expect(payload.page).toBe(3);
    expect(payload.pageSize).toBe(10);
    expect(payload.totalPages).toBe(10);
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20, // (page - 1) * pageSize = 2 * 10
        take: 10,
      })
    );
  });

  it('sorts requests by different fields', async () => {
    prismaMock.request.count.mockResolvedValueOnce(1);
    prismaMock.request.findMany.mockResolvedValueOnce([]);

    const mockRequest = {
      url: 'http://localhost/api/admin/requests?sortBy=title&sortOrder=asc',
    };

    const { GET } = await import('@/app/api/admin/requests/route');
    await GET(mockRequest as any);

    expect(prismaMock.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { audiobook: { title: 'asc' } },
      })
    );
  });

  it('soft deletes a request via delete service', async () => {
    deleteRequestMock.mockResolvedValueOnce({
      success: true,
      message: 'Deleted',
      filesDeleted: 1,
      torrentsRemoved: 0,
      torrentsKeptSeeding: 0,
      torrentsKeptUnlimited: 0,
    });

    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(deleteRequestMock).toHaveBeenCalledWith('req-1', 'admin-1');
  });

  it('returns 401 when admin user is missing', async () => {
    authRequest.user = null;

    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'req-2' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 404 when delete service reports missing request', async () => {
    deleteRequestMock.mockResolvedValueOnce({
      success: false,
      error: 'NotFound',
      message: 'Missing',
    });

    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'req-3' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('NotFound');
  });

  it('returns 500 when delete service fails', async () => {
    deleteRequestMock.mockResolvedValueOnce({
      success: false,
      error: 'DeleteFailed',
      message: 'boom',
    });

    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'req-4' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('DeleteFailed');
  });

  it('returns pending approval requests', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([{ id: 'req-10', status: 'awaiting_approval' }]);

    const { GET } = await import('@/app/api/admin/requests/pending-approval/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.count).toBe(1);
  });

  it('returns 500 when pending approval fetch fails', async () => {
    prismaMock.request.findMany.mockRejectedValueOnce(new Error('fetch failed'));

    const { GET } = await import('@/app/api/admin/requests/pending-approval/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('FetchError');
  });

  it('returns 401 when approving without a user', async () => {
    authRequest.user = null;
    const request = { json: vi.fn().mockResolvedValue({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns validation error for invalid approval action', async () => {
    const request = { json: vi.fn().mockResolvedValue({ action: 'maybe' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 404 when approving a missing request', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce(null);
    const request = { json: vi.fn().mockResolvedValue({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('NotFound');
  });

  it('returns 400 when request is not awaiting approval', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-2',
      status: 'pending',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
      user: { id: 'u1', plexUsername: 'user' },
    });
    const request = { json: vi.fn().mockResolvedValue({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'req-2' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('InvalidStatus');
  });

  it('approves request with a selected torrent and triggers download', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-3',
      status: 'awaiting_approval',
      selectedTorrent: { title: 'Torrent' },
      audiobook: { id: 'ab-3', title: 'Title', author: 'Author' },
      user: { id: 'u3', plexUsername: 'user3' },
      userId: 'u3',
    });
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-3',
      status: 'downloading',
      audiobook: { id: 'ab-3', title: 'Title', author: 'Author' },
      user: { id: 'u3', plexUsername: 'user3' },
      userId: 'u3',
    });
    const request = { json: vi.fn().mockResolvedValue({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'req-3' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalled();
  });

  it('approves request without a selected torrent and triggers search', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-4',
      status: 'awaiting_approval',
      selectedTorrent: null,
      audiobook: { id: 'ab-4', title: 'Title', author: 'Author', audibleAsin: 'ASIN4' },
      user: { id: 'u4', plexUsername: 'user4' },
      userId: 'u4',
    });
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-4',
      status: 'pending',
      audiobook: { id: 'ab-4', title: 'Title', author: 'Author', audibleAsin: 'ASIN4' },
      user: { id: 'u4', plexUsername: 'user4' },
      userId: 'u4',
    });
    const request = { json: vi.fn().mockResolvedValue({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'req-4' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalled();
  });

  it('denies request without triggering jobs', async () => {
    prismaMock.request.findUnique.mockResolvedValueOnce({
      id: 'req-5',
      status: 'awaiting_approval',
      selectedTorrent: null,
      audiobook: { id: 'ab-5', title: 'Title', author: 'Author' },
      user: { id: 'u5', plexUsername: 'user5' },
      userId: 'u5',
    });
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-5',
      status: 'denied',
      audiobook: { id: 'ab-5', title: 'Title', author: 'Author' },
      user: { id: 'u5', plexUsername: 'user5' },
      userId: 'u5',
    });
    const request = { json: vi.fn().mockResolvedValue({ action: 'deny' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST(request as any, { params: Promise.resolve({ id: 'req-5' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });
});


