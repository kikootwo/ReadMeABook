/**
 * Component: Manual Torrent Download API Route Tests
 * Documentation: documentation/phase3/manual-torrent-download.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';
import type { TorrentResult } from '@/lib/utils/ranking-algorithm';

interface MockAuthRequest {
  user?: { id: string; role: string } | null;
  formData: () => Promise<FormData>;
}

let authRequest: MockAuthRequest;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(() => Promise.resolve('job-1')),
}));
const configServiceMock = vi.hoisted(() => ({ get: vi.fn(), getMany: vi.fn() }));
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
}));
const parseTorrentMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: vi.fn((_req: unknown, handler: () => unknown) => handler()),
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: async () => configServiceMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
  invalidateDownloadClientManager: vi.fn(),
}));

vi.mock('parse-torrent', () => ({
  default: parseTorrentMock,
}));

const VALID_MAGNET = 'magnet:?xt=urn:btih:abc123def4567890abc123def4567890abc12345&dn=Book';

/** Minimal multipart body stub - the route only reads fields via `get()` */
const makeFormData = (fields: Record<string, unknown>) => ({
  get: (key: string) => (key in fields ? fields[key] : null),
});

const makeTorrentFile = (overrides: Partial<{ name: string; size: number }> = {}) => ({
  name: overrides.name ?? 'book.torrent',
  size: overrides.size ?? 2048,
  arrayBuffer: async () => new ArrayBuffer(8),
});

const eligibleRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 'req-1',
  userId: 'user-1',
  status: 'failed',
  audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
  ...overrides,
});

const callRoute = async (id = 'req-1') => {
  const { POST } = await import('@/app/api/requests/[id]/manual-download/route');
  return POST({} as unknown as NextRequest, { params: Promise.resolve({ id }) });
};

describe('POST /api/requests/[id]/manual-download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'user-1', role: 'user' },
      formData: vi.fn(async () => makeFormData({ magnet: VALID_MAGNET })),
    };
    requireAuthMock.mockImplementation(
      (_req: unknown, handler: (req: MockAuthRequest) => unknown) => handler(authRequest)
    );
    jobQueueMock.addDownloadJob.mockResolvedValue('job-1');
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      category: 'readmeabook',
    });
    prismaMock.request.findUnique.mockResolvedValue(eligibleRequest());
    prismaMock.request.update.mockResolvedValue({
      id: 'req-1',
      status: 'downloading',
      progress: 0,
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
    });
  });

  it('returns 401 when unauthenticated', async () => {
    authRequest.user = null;

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('returns 404 when the request does not exist', async () => {
    prismaMock.request.findUnique.mockResolvedValue(null);

    const response = await callRoute('missing');
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('NotFound');
  });

  it('returns 403 when the request belongs to another user', async () => {
    prismaMock.request.findUnique.mockResolvedValue(eligibleRequest({ userId: 'user-2' }));

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('allows an admin to act on another user\'s request', async () => {
    authRequest.user = { id: 'admin-1', role: 'admin' };
    prismaMock.request.findUnique.mockResolvedValue(eligibleRequest({ userId: 'user-2' }));

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalled();
  });

  it.each(['pending', 'failed', 'awaiting_search', 'awaiting_release'])(
    'accepts a manual torrent for %s requests',
    async (status) => {
      prismaMock.request.findUnique.mockResolvedValue(eligibleRequest({ status }));

      const response = await callRoute();

      expect(response.status).toBe(200);
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalled();
    }
  );

  it.each(['downloading', 'completed', 'awaiting_approval', 'processing'])(
    'returns 409 for %s requests',
    async (status) => {
      prismaMock.request.findUnique.mockResolvedValue(eligibleRequest({ status }));

      const response = await callRoute();
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload.error).toBe('InvalidStatus');
      expect(payload.message).toContain(status);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    }
  );

  it('returns 400 when neither a magnet nor a file is supplied', async () => {
    authRequest.formData = vi.fn(async () => makeFormData({ magnet: '   ' }));

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
    expect(payload.message).toContain('magnet link or a .torrent file');
  });

  it('returns 400 when both a magnet and a file are supplied', async () => {
    authRequest.formData = vi.fn(async () =>
      makeFormData({ magnet: VALID_MAGNET, file: makeTorrentFile() })
    );

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.message).toContain('not both');
  });

  it.each([
    'http://example.com/file.torrent',
    'magnet:?dn=NoHashHere',
    'magnet:?xt=urn:sha1:abc123',
    'not a magnet at all',
  ])('returns 400 for invalid magnet %s', async (magnet) => {
    authRequest.formData = vi.fn(async () => makeFormData({ magnet }));

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.message).toBe('Invalid magnet link');
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('returns 400 when the upload is not a .torrent file', async () => {
    authRequest.formData = vi.fn(async () =>
      makeFormData({ file: makeTorrentFile({ name: 'book.nzb' }) })
    );

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.message).toBe('File must be a .torrent file');
    expect(parseTorrentMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the .torrent file exceeds 5 MB', async () => {
    authRequest.formData = vi.fn(async () =>
      makeFormData({ file: makeTorrentFile({ size: 5 * 1024 * 1024 + 1 }) })
    );

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.message).toContain('5 MB');
  });

  it('returns 400 when parse-torrent rejects the file', async () => {
    authRequest.formData = vi.fn(async () => makeFormData({ file: makeTorrentFile() }));
    parseTorrentMock.mockRejectedValue(new Error('boom'));

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.message).toBe('Invalid .torrent file');
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('returns 400 when the parsed .torrent file has no info hash', async () => {
    authRequest.formData = vi.fn(async () => makeFormData({ file: makeTorrentFile() }));
    parseTorrentMock.mockResolvedValue({ name: 'No hash' });

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.message).toBe('Invalid .torrent file');
  });

  it('returns 409 when no torrent client is configured', async () => {
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue(null);

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('NoDownloadClient');
    expect(payload.message).toContain('Settings > Download Clients');
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('queues a download job for a valid magnet and returns the updated request', async () => {
    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.request.status).toBe('downloading');
    expect(downloadClientManagerMock.getClientForProtocol).toHaveBeenCalledWith('torrent');
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
      'req-1',
      { id: 'ab-1', title: 'Title', author: 'Author' },
      expect.objectContaining({
        title: 'Manual torrent',
        downloadUrl: VALID_MAGNET,
        size: 0,
        indexer: 'manual',
        protocol: 'torrent',
      })
    );
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: 'downloading', progress: 0, errorMessage: null }),
      })
    );
  });

  it('derives a magnet from an uploaded .torrent file and queues the download', async () => {
    authRequest.formData = vi.fn(async () => makeFormData({ file: makeTorrentFile() }));
    parseTorrentMock.mockResolvedValue({
      infoHash: 'abc123def4567890abc123def4567890abc12345',
      name: 'Great Book',
      announce: ['udp://tracker.example.com:6969'],
    });

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(parseTorrentMock).toHaveBeenCalledWith(expect.any(Buffer));

    const queuedTorrent = jobQueueMock.addDownloadJob.mock.calls[0][2] as TorrentResult;
    expect(queuedTorrent.downloadUrl).toBe(
      'magnet:?xt=urn:btih:abc123def4567890abc123def4567890abc12345&dn=Great%20Book&tr=udp%3A%2F%2Ftracker.example.com%3A6969'
    );
    expect(queuedTorrent.guid).toBe(queuedTorrent.downloadUrl);
  });

  it('returns 400 when the body is not multipart form data', async () => {
    authRequest.formData = vi.fn(async () => {
      throw new Error('not multipart');
    });

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.message).toContain('multipart/form-data');
  });

  it('returns 500 when queueing the download job fails', async () => {
    jobQueueMock.addDownloadJob.mockRejectedValue(new Error('queue offline'));

    const response = await callRoute();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('DownloadError');
  });
});
