/**
 * Component: Hardcover Shelves API Route Tests (POST / GET)
 * Documentation: documentation/backend/services/hardcover-sync.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSyncShelvesJob: vi.fn(() => Promise.resolve()),
}));
const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}));
const fetchHardcoverListMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

vi.mock('@/lib/services/hardcover-sync.service', () => ({
  fetchHardcoverList: fetchHardcoverListMock,
}));

const FETCHED_LIST = {
  listName: 'Currently Reading',
  books: [
    { title: 'Dune', author: 'Frank Herbert', coverUrl: 'https://example.com/dune.jpg' },
    { title: 'Foundation', author: 'Isaac Asimov', coverUrl: null },
  ],
};

describe('POST /api/user/hardcover-shelves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'user-1', role: 'user' },
      json: vi.fn().mockResolvedValue({ listId: 'status-2', apiToken: 'raw-token' }),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('returns 400 when apiToken is missing', async () => {
    authRequest.json.mockResolvedValueOnce({ listId: 'status-2' });

    const { POST } = await import('@/app/api/user/hardcover-shelves/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 400 when listId is missing', async () => {
    authRequest.json.mockResolvedValueOnce({ apiToken: 'raw-token' });

    const { POST } = await import('@/app/api/user/hardcover-shelves/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 409 when the list is already subscribed', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce({ id: 'existing-shelf' });

    const { POST } = await import('@/app/api/user/hardcover-shelves/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('DuplicateShelf');
  });

  it('returns 400 when Hardcover API fetch fails', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(null);
    fetchHardcoverListMock.mockRejectedValueOnce(new Error('Invalid token'));

    const { POST } = await import('@/app/api/user/hardcover-shelves/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('InvalidHardcoverList');
    expect(payload.message).toContain('Invalid token');
  });

  it('creates the shelf with an encrypted token and triggers sync', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(null);
    fetchHardcoverListMock.mockResolvedValueOnce(FETCHED_LIST);
    prismaMock.hardcoverShelf.create.mockResolvedValueOnce({
      id: 'new-shelf',
      name: 'Currently Reading',
      listId: 'status-2',
      lastSyncAt: null,
      createdAt: new Date().toISOString(),
      bookCount: 2,
      coverUrls: null,
    });

    const { POST } = await import('@/app/api/user/hardcover-shelves/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.shelf.name).toBe('Currently Reading');

    // Token must have been encrypted before storage
    expect(encryptionMock.encrypt).toHaveBeenCalledWith('raw-token');
    expect(prismaMock.hardcoverShelf.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apiToken: 'enc:raw-token',
          listId: 'status-2',
          userId: 'user-1',
        }),
      })
    );

    // Immediate background sync must have been triggered
    expect(jobQueueMock.addSyncShelvesJob).toHaveBeenCalledWith(undefined, 'new-shelf', 'hardcover', 0);
  });

  it('strips Bearer prefix from apiToken before encrypting', async () => {
    authRequest.json.mockResolvedValueOnce({ listId: 'status-2', apiToken: 'Bearer raw-token' });
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(null);
    fetchHardcoverListMock.mockResolvedValueOnce(FETCHED_LIST);
    prismaMock.hardcoverShelf.create.mockResolvedValueOnce({
      id: 'new-shelf-2',
      name: 'Currently Reading',
      listId: 'status-2',
      lastSyncAt: null,
      createdAt: new Date().toISOString(),
      bookCount: 2,
      coverUrls: null,
    });

    const { POST } = await import('@/app/api/user/hardcover-shelves/route');
    await POST({} as any);

    // "Bearer " prefix must have been stripped before encrypt was called
    expect(encryptionMock.encrypt).toHaveBeenCalledWith('raw-token');
  });

  it('returns 201 even when the sync job fails to enqueue', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(null);
    fetchHardcoverListMock.mockResolvedValueOnce(FETCHED_LIST);
    prismaMock.hardcoverShelf.create.mockResolvedValueOnce({
      id: 'new-shelf-3',
      name: 'Currently Reading',
      listId: 'status-2',
      lastSyncAt: null,
      createdAt: new Date().toISOString(),
      bookCount: 2,
      coverUrls: null,
    });
    jobQueueMock.addSyncShelvesJob.mockRejectedValueOnce(new Error('queue down'));

    const { POST } = await import('@/app/api/user/hardcover-shelves/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
  });

  it('only includes books with cover URLs in the initial shelf preview', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(null);
    fetchHardcoverListMock.mockResolvedValueOnce(FETCHED_LIST); // only 1 of 2 books has coverUrl
    prismaMock.hardcoverShelf.create.mockResolvedValueOnce({
      id: 'new-shelf-4',
      name: 'Currently Reading',
      listId: 'status-2',
      lastSyncAt: null,
      createdAt: new Date().toISOString(),
      bookCount: 2,
      coverUrls: null,
    });

    const { POST } = await import('@/app/api/user/hardcover-shelves/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    // The coverUrls stored should only include books with non-null coverUrl
    expect(prismaMock.hardcoverShelf.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          // 1 book has cover, 1 doesn't → only 1 stored
          coverUrls: JSON.stringify([
            { coverUrl: 'https://example.com/dune.jpg', asin: null, title: 'Dune', author: 'Frank Herbert' },
          ]),
        }),
      })
    );
  });
});
