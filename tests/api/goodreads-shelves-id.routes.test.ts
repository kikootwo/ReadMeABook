/**
 * Component: Goodreads Shelves [id] API Route Tests
 * Documentation: documentation/backend/services/goodreads-sync.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSyncShelvesJob: vi.fn(() => Promise.resolve()),
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

const SHELF = {
  id: 'shelf-1',
  userId: 'user-1',
  name: 'Want to Read',
  rssUrl: 'https://www.goodreads.com/review/list_rss/12345',
  lastSyncAt: null,
  bookCount: 5,
  coverUrls: null,
  createdAt: new Date().toISOString(),
};

describe('DELETE /api/user/goodreads-shelves/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'user' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('returns 404 when shelf does not exist', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(null);

    const { DELETE } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'shelf-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Shelf not found');
  });

  it('returns 403 when shelf belongs to another user', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce({ ...SHELF, userId: 'other-user' });

    const { DELETE } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'shelf-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('deletes the shelf and returns success', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.goodreadsShelf.delete.mockResolvedValueOnce({});

    const { DELETE } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'shelf-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(prismaMock.goodreadsShelf.delete).toHaveBeenCalledWith({ where: { id: 'shelf-1' } });
  });

  it('returns 500 when deletion throws', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.goodreadsShelf.delete.mockRejectedValueOnce(new Error('db error'));

    const { DELETE } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'shelf-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Failed to delete shelf');
  });
});

describe('PATCH /api/user/goodreads-shelves/[id]', () => {
  const NEW_RSS = 'https://www.goodreads.com/review/list_rss/99999';

  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'user-1', role: 'user' },
      json: vi.fn().mockResolvedValue({ rssUrl: NEW_RSS }),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([]);
  });

  const patch = async (body: Record<string, unknown>) => {
    const { PATCH } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    return PATCH({ json: vi.fn().mockResolvedValue(body) } as any, { params: Promise.resolve({ id: 'shelf-1' }) });
  };

  it('returns 409 when another of the user\'s shelves has the same feed in an older form', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([
      { id: 'shelf-1', rssUrl: SHELF.rssUrl },
      { id: 'shelf-2', rssUrl: 'http://goodreads.com/review/list_rss/99999' },
    ]);
    const response = await patch({ rssUrl: NEW_RSS });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('DuplicateShelf');
    expect(prismaMock.goodreadsShelf.update).not.toHaveBeenCalled();
  });

  it('lets a shelf be re-saved with its own feed URL', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([{ id: 'shelf-1', rssUrl: 'http://goodreads.com/review/list_rss/12345' }]);
    prismaMock.goodreadsShelf.update.mockResolvedValueOnce(SHELF);
    const response = await patch({ rssUrl: SHELF.rssUrl });

    expect(response.status).toBe(200);
  });

  it('returns 409 when the update hits the unique constraint', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.goodreadsShelf.update.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const response = await patch({ rssUrl: NEW_RSS });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('DuplicateShelf');
  });

  it('returns the validation message for the UI', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    const response = await patch({ rssUrl: 'https://evil.example/review/list_rss/1' });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('https://www.goodreads.com/review/list_rss/');
  });

  it('returns 404 when shelf does not exist', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(null);

    const { PATCH } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ rssUrl: NEW_RSS }) } as any,
      { params: Promise.resolve({ id: 'shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Shelf not found');
  });

  it('returns 403 when shelf belongs to another user', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce({ ...SHELF, userId: 'other-user' });

    const { PATCH } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ rssUrl: NEW_RSS }) } as any,
      { params: Promise.resolve({ id: 'shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('returns 400 for an invalid (non-URL) rssUrl', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);

    const { PATCH } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ rssUrl: 'not-a-url' }) } as any,
      { params: Promise.resolve({ id: 'shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it.each([
    'http://10.0.0.1/goodreads.com/review/list_rss/1',
    'https://evil.example/review/list_rss/1',
  ])('refuses a non-Goodreads feed URL (%s) without saving or syncing', async (rssUrl) => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);

    const { PATCH } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ rssUrl }) } as any,
      { params: Promise.resolve({ id: 'shelf-1' }) }
    );

    expect(response.status).toBe(400);
    expect(prismaMock.goodreadsShelf.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSyncShelvesJob).not.toHaveBeenCalled();
  });

  it('stores an http:// Goodreads feed URL as https://', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.goodreadsShelf.update.mockResolvedValueOnce({ ...SHELF, rssUrl: NEW_RSS });

    const { PATCH } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ rssUrl: 'http://www.goodreads.com/review/list_rss/99999' }) } as any,
      { params: Promise.resolve({ id: 'shelf-1' }) }
    );

    expect(response.status).toBe(200);
    expect(prismaMock.goodreadsShelf.update.mock.calls[0][0].data.rssUrl).toBe(NEW_RSS);
  });

  it('updates the shelf, clears sync metadata, and triggers a sync job', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    const updatedShelf = { ...SHELF, rssUrl: NEW_RSS, lastSyncAt: null };
    prismaMock.goodreadsShelf.update.mockResolvedValueOnce(updatedShelf);

    const { PATCH } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ rssUrl: NEW_RSS }) } as any,
      { params: Promise.resolve({ id: 'shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(prismaMock.goodreadsShelf.update).toHaveBeenCalledWith({
      where: { id: 'shelf-1' },
      data: { rssUrl: NEW_RSS, lastSyncAt: null, bookCount: null, coverUrls: null },
    });
    expect(jobQueueMock.addSyncShelvesJob).toHaveBeenCalledWith(undefined, updatedShelf.id, 'goodreads', 0, 'user-1');
  });

  it('still returns 200 even when the sync job fails to enqueue', async () => {
    prismaMock.goodreadsShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.goodreadsShelf.update.mockResolvedValueOnce({ ...SHELF, rssUrl: NEW_RSS });
    jobQueueMock.addSyncShelvesJob.mockRejectedValueOnce(new Error('queue down'));

    const { PATCH } = await import('@/app/api/user/goodreads-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ rssUrl: NEW_RSS }) } as any,
      { params: Promise.resolve({ id: 'shelf-1' }) }
    );
    const payload = await response.json();

    // Sync job failure is swallowed; shelf update should still succeed
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
  });
});
