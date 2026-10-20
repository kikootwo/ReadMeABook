/**
 * Component: Request With Torrent API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));
const findPlexMatchMock = vi.hoisted(() => vi.fn());
const audibleServiceMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn(),
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/utils/audiobook-matcher', () => ({
  findPlexMatch: findPlexMatchMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));


// Prowlarr connection used by the download-URL guard and key stripping
vi.mock('@/lib/integrations/prowlarr-connection', () => ({
  getProwlarrConnection: async () => ({
    baseUrl: 'http://prowlarr:9696',
    apiKey: 'test-prowlarr-key',
    base: { origin: 'http://prowlarr:9696', protocol: 'http:', hostname: 'prowlarr', host: 'prowlarr:9696', port: '9696', defaultPort: false, userinfo: '', basePath: '' },
  }),
}));


// Interactive search permission is covered by tests/api/interactive-search-access.test.ts
vi.mock('@/lib/middleware/interactive-search-access', () => ({
  denyWithoutInteractiveSearchAccess: async () => null,
}));

describe('Request with torrent route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'user-1', role: 'user' },
      json: vi.fn(),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
  });

  it('returns 409 when audiobook is already being processed', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'downloaded',
      userId: 'user-2',
      user: { plexUsername: 'other' },
    } as any);

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('BeingProcessed');
  });

  it('returns 401 when user is missing', async () => {
    authRequest.user = null;

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 409 when audiobook is already available', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'available',
      userId: 'user-2',
      user: { plexUsername: 'other' },
    } as any);

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('AlreadyAvailable');
  });

  it('returns 409 when Plex match already exists', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce({ plexGuid: 'plex://item' });

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('AlreadyAvailable');
    expect(payload.plexGuid).toBe('plex://item');
  });

  it('returns 409 for duplicate active requests', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce(null);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({ id: 'ab-1', title: 'Title', author: 'Author' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce({ id: 'req-2', status: 'pending' } as any);

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('DuplicateRequest');
  });

  it('replaces a failed request in one transaction, carrying its blocklist (#312)', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce(null);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({ id: 'ab-1', title: 'Title', author: 'Author' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce({ id: 'req-old', status: 'failed', customSearchTerms: 'title custom' } as any);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'user',
      autoApproveRequests: true,
      plexUsername: 'user',
    } as any);
    const tx = {
      request: {
        create: vi.fn().mockResolvedValue({ id: 'req-3', audiobook: { id: 'ab-1', title: 'Title', author: 'Author' }, user: { id: 'user-1', plexUsername: 'user' } }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      blockedRelease: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    let committed = false;
    prismaMock.$transaction.mockImplementationOnce(async (fn: any) => {
      const result = await fn(tx);
      committed = true;
      return result;
    });

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(committed).toBe(true);
    expect(tx.request.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'downloading', customSearchTerms: 'title custom' }),
    }));
    expect(tx.blockedRelease.updateMany).toHaveBeenCalledWith({ where: { requestId: 'req-old' }, data: { requestId: 'req-3' } });
    expect(tx.request.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'req-old' }) }));
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
  });

  it('answers 409 and queues nothing when another re-request replaced the failed request first', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce(null);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({ id: 'ab-1', title: 'Title', author: 'Author' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce({ id: 'req-old', status: 'failed' } as any);
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-1', role: 'user', autoApproveRequests: true, plexUsername: 'user' } as any);
    const tx = {
      request: { create: vi.fn().mockResolvedValue({ id: 'req-3' }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      blockedRelease: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    prismaMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);

    expect(response.status).toBe(409);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('returns 404 when user lookup fails', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce(null);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({ id: 'ab-1', title: 'Title', author: 'Author' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('UserNotFound');
  });

  it('stores selected torrent when approval is required', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce(null);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({ id: 'ab-1', title: 'Title', author: 'Author' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'user',
      autoApproveRequests: false,
      plexUsername: 'user',
    } as any);
    prismaMock.request.create.mockResolvedValueOnce({
      id: 'req-4',
      audiobook: { title: 'Title', author: 'Author' },
      user: { id: 'user-1', plexUsername: 'user' },
    } as any);

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'awaiting_approval',
          selectedTorrent: expect.objectContaining({ guid: 'guid' }),
        }),
      })
    );
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_pending_approval',
      'req-4',
      'Title',
      'Author',
      'user'
    );
  });

  it('updates year from Audnexus when audiobook already exists', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValueOnce({ releaseDate: '2020-01-02' });
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({ id: 'ab-2', title: 'Title', author: 'Author' } as any);
    prismaMock.audiobook.update.mockResolvedValueOnce({ id: 'ab-2', year: 2020 } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'admin',
      autoApproveRequests: null,
      plexUsername: 'user',
    } as any);
    prismaMock.request.create.mockResolvedValueOnce({
      id: 'req-5',
      audiobook: { id: 'ab-2', title: 'Title', author: 'Author' },
      user: { id: 'user-1', plexUsername: 'user' },
    } as any);

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ year: 2020 }),
      })
    );
  });

  it('returns validation errors for invalid payloads', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { title: 'Missing fields' },
    });

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('creates request and queues download job', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce(null);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audiobook.create.mockResolvedValueOnce({ id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'admin',
      autoApproveRequests: null,
      plexUsername: 'user',
    } as any);
    prismaMock.request.create.mockResolvedValueOnce({
      id: 'req-2',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
      user: { id: 'user-1', plexUsername: 'user' },
    } as any);

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-2', {
      id: 'ab-1',
      title: 'Title',
      author: 'Author',
    }, expect.objectContaining({ guid: 'guid' }));
  });
});

