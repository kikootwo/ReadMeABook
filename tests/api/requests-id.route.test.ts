/**
 * Component: Request By ID API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addSearchJob: vi.fn(), addOrganizeJob: vi.fn(), addNotificationJob: vi.fn().mockResolvedValue(undefined) }));
const requireAuthMock = vi.hoisted(() => vi.fn());
const qbtMock = vi.hoisted(() => ({ getTorrent: vi.fn() }));
const sabnzbdMock = vi.hoisted(() => ({ getNZB: vi.fn() }));
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/integrations/qbittorrent.service', () => ({
  getQBittorrentService: async () => qbtMock,
}));

vi.mock('@/lib/integrations/sabnzbd.service', () => ({
  getSABnzbdService: async () => sabnzbdMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({}),
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
}));

describe('Request by ID API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'user-1', role: 'user' },
      nextUrl: new URL('http://localhost/api/requests/req-1'),
      json: vi.fn(),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    downloadClientManagerMock.getClientServiceForProtocol.mockReset();
  });

  it('returns 403 when user is not authorized to view the request', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      userId: 'user-2',
    });

    const { GET } = await import('@/app/api/requests/[id]/route');
    const response = await GET({} as any, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('returns request details for the owner', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      userId: 'user-1',
      audiobook: { id: 'ab-1' },
    });

    const { GET } = await import('@/app/api/requests/[id]/route');
    const response = await GET({} as any, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.request.id).toBe('req-1');
  });

  it('returns 404 when request does not exist', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/requests/[id]/route');
    const response = await GET({} as any, { params: Promise.resolve({ id: 'missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('NotFound');
  });

  it('returns 401 when user is missing', async () => {
    authRequest.user = null;

    const { GET } = await import('@/app/api/requests/[id]/route');
    const response = await GET({} as any, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('cancels a request', async () => {
    authRequest.json.mockResolvedValue({ action: 'cancel' });
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-2',
      userId: 'user-1',
      status: 'pending',
      user: { plexUsername: 'testuser' },
      audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author' },
    });
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-2',
      status: 'cancelled',
      audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author' },
    });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-2' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.request.status).toBe('cancelled');
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_cancelled',
      'req-2',
      'Test Book',
      'Test Author',
      'testuser'
    );
  });

  it('cancels an awaiting_approval request and clears selectedTorrent', async () => {
    authRequest.json.mockResolvedValue({ action: 'cancel' });
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-ap',
      userId: 'user-1',
      status: 'awaiting_approval',
      user: { plexUsername: 'testuser' },
      audiobook: { id: 'ab-ap', title: 'Approval Book', author: 'Some Author' },
    });
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-ap',
      status: 'cancelled',
      audiobook: { id: 'ab-ap', title: 'Approval Book', author: 'Some Author' },
    });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-ap' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.request.status).toBe('cancelled');
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ selectedTorrent: null }),
      })
    );
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_cancelled',
      'req-ap',
      'Approval Book',
      'Some Author',
      'testuser'
    );
  });

  it('returns 400 when cancelling a request in a non-cancellable status', async () => {
    authRequest.json.mockResolvedValue({ action: 'cancel' });
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-2',
      userId: 'user-1',
      status: 'available',
      user: { plexUsername: 'testuser' },
      audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author' },
    });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-2' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 400 for invalid actions', async () => {
    authRequest.json.mockResolvedValue({ action: 'unknown' });
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-2',
      userId: 'user-1',
      status: 'pending',
    });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-2' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('rejects retry when status is not retryable', async () => {
    authRequest.json.mockResolvedValue({ action: 'retry' });
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-4',
      userId: 'user-1',
      status: 'available',
    });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-4' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('retries a failed request by enqueuing a search job', async () => {
    authRequest.json.mockResolvedValue({ action: 'retry' });
    prismaMock.request.findFirst
      .mockResolvedValueOnce({
        id: 'req-3',
        userId: 'user-1',
        status: 'failed',
      })
      .mockResolvedValueOnce({
        id: 'req-3',
        userId: 'user-1',
        audiobook: {
          id: 'ab-2',
          title: 'Title',
          author: 'Author',
          audibleAsin: 'ASIN-2',
        },
      });
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-3',
      status: 'pending',
      audiobook: { id: 'ab-2' },
    });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-3' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-3', {
      id: 'ab-2',
      title: 'Title',
      author: 'Author',
      asin: 'ASIN-2',
    });
  });

  it('retries an import via qBittorrent download history', async () => {
    authRequest.json.mockResolvedValue({ action: 'retry' });
    prismaMock.request.findFirst
      .mockResolvedValueOnce({
        id: 'req-5',
        userId: 'user-1',
        status: 'warn',
      })
      .mockResolvedValueOnce({
        id: 'req-5',
        userId: 'user-1',
        audiobook: { id: 'ab-5' },
        downloadHistory: [{ torrentHash: 'hash-1', selected: true, downloadClient: 'qbittorrent' }],
      });
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue({
      clientType: 'qbittorrent',
      getDownload: vi.fn().mockResolvedValue({
        downloadPath: '/downloads/Book',
      }),
    });
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-5',
      status: 'processing',
      audiobook: { id: 'ab-5' },
    });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith('req-5', 'ab-5', '/downloads/Book');
  });

  it('retries an import via SABnzbd download history', async () => {
    authRequest.json.mockResolvedValue({ action: 'retry' });
    prismaMock.request.findFirst
      .mockResolvedValueOnce({
        id: 'req-6',
        userId: 'user-1',
        status: 'awaiting_import',
      })
      .mockResolvedValueOnce({
        id: 'req-6',
        userId: 'user-1',
        audiobook: { id: 'ab-6' },
        downloadHistory: [{ nzbId: 'nzb-1', selected: true, downloadClient: 'sabnzbd' }],
      });
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue({
      clientType: 'sabnzbd',
      getDownload: vi.fn().mockResolvedValue({
        downloadPath: '/usenet/book',
      }),
    });
    prismaMock.request.update.mockResolvedValueOnce({
      id: 'req-6',
      status: 'processing',
      audiobook: { id: 'ab-6' },
    });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-6' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith('req-6', 'ab-6', '/usenet/book');
  });

  it('returns 400 when download history is missing for import retry', async () => {
    authRequest.json.mockResolvedValue({ action: 'retry' });
    prismaMock.request.findFirst
      .mockResolvedValueOnce({
        id: 'req-7',
        userId: 'user-1',
        status: 'warn',
      })
      .mockResolvedValueOnce({
        id: 'req-7',
        userId: 'user-1',
        audiobook: { id: 'ab-7' },
        downloadHistory: [],
      });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-7' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 400 when download client info is missing for import retry', async () => {
    authRequest.json.mockResolvedValue({ action: 'retry' });
    prismaMock.request.findFirst
      .mockResolvedValueOnce({
        id: 'req-8',
        userId: 'user-1',
        status: 'warn',
      })
      .mockResolvedValueOnce({
        id: 'req-8',
        userId: 'user-1',
        audiobook: { id: 'ab-8' },
        downloadHistory: [{}],
      });

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'req-8' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('allows admins to delete requests', async () => {
    authRequest.user = { id: 'admin-1', role: 'admin' };
    prismaMock.request.delete.mockResolvedValueOnce({});

    const { DELETE } = await import('@/app/api/requests/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'req-4' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-4' } });
  });

  it('blocks delete for non-admin users', async () => {
    authRequest.user = { id: 'user-2', role: 'user' };

    const { DELETE } = await import('@/app/api/requests/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'req-9' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });
});


