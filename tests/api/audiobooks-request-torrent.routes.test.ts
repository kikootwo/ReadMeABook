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
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
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
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
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
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
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
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
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

  it('deletes failed requests before creating a new one', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
    });
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    findPlexMatchMock.mockResolvedValueOnce(null);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({ id: 'ab-1', title: 'Title', author: 'Author' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce({ id: 'req-old', status: 'failed' } as any);
    prismaMock.request.delete.mockResolvedValueOnce({} as any);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'user',
      autoApproveRequests: true,
      plexUsername: 'user',
    } as any);
    prismaMock.request.create.mockResolvedValueOnce({
      id: 'req-3',
      audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
      user: { id: 'user-1', plexUsername: 'user' },
    } as any);

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-old' } });
  });

  it('returns 404 when user lookup fails', async () => {
    authRequest.json.mockResolvedValue({
      audiobook: { asin: 'ASIN', title: 'Title', author: 'Author' },
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
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
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
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
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
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
      torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'url', publishDate: '2024-01-01' },
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

