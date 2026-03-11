/**
 * Component: Hardcover Shelves [id] API Route Tests
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
  isEncryptedFormat: vi.fn((s: string) => s.startsWith('enc:')),
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

vi.mock('@/lib/services/hardcover-api.service', () => ({
  fetchHardcoverList: fetchHardcoverListMock,
}));

const SHELF = {
  id: 'hc-shelf-1',
  userId: 'user-1',
  name: 'Currently Reading',
  listId: 'status-2',
  apiToken: 'enc:secret-token',
  lastSyncAt: null,
  bookCount: 3,
  coverUrls: null,
  createdAt: new Date().toISOString(),
};

describe('DELETE /api/user/hardcover-shelves/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'user' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('returns 404 when list does not exist', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(null);

    const { DELETE } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'hc-shelf-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('List not found');
  });

  it('returns 403 when list belongs to another user', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce({ ...SHELF, userId: 'other-user' });

    const { DELETE } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'hc-shelf-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('deletes the list and returns success', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.hardcoverShelf.delete.mockResolvedValueOnce({});

    const { DELETE } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'hc-shelf-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(prismaMock.hardcoverShelf.delete).toHaveBeenCalledWith({ where: { id: 'hc-shelf-1' } });
  });

  it('returns 500 when deletion throws', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.hardcoverShelf.delete.mockRejectedValueOnce(new Error('db error'));

    const { DELETE } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await DELETE({} as any, { params: Promise.resolve({ id: 'hc-shelf-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Failed to delete list');
  });
});

describe('PATCH /api/user/hardcover-shelves/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'user' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    encryptionMock.isEncryptedFormat.mockImplementation((s: string) => s.startsWith('enc:'));
    encryptionMock.encrypt.mockImplementation((s: string) => `enc:${s}`);
    encryptionMock.decrypt.mockImplementation((s: string) => s.replace('enc:', ''));
    fetchHardcoverListMock.mockResolvedValue({ listName: 'Test List', books: [] });
  });

  it('returns 404 when list does not exist', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(null);

    const { PATCH } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ listId: 'status-3' }) } as any,
      { params: Promise.resolve({ id: 'hc-shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('List not found');
  });

  it('returns 403 when list belongs to another user', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce({ ...SHELF, userId: 'other-user' });

    const { PATCH } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ listId: 'status-3' }) } as any,
      { params: Promise.resolve({ id: 'hc-shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('does not trigger a sync when no fields changed', async () => {
    // listId is the same as existing; no apiToken provided
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.hardcoverShelf.update.mockResolvedValueOnce(SHELF);

    const { PATCH } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ listId: SHELF.listId }) } as any,
      { params: Promise.resolve({ id: 'hc-shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(jobQueueMock.addSyncShelvesJob).not.toHaveBeenCalled();
  });

  it('triggers a sync when forceSync is true, even if no fields changed', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.hardcoverShelf.update.mockResolvedValueOnce(SHELF);

    const { PATCH } =
      await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await PATCH(
      {
        json: vi
          .fn()
          .mockResolvedValue({ listId: SHELF.listId, forceSync: true }),
      } as any,
      { params: Promise.resolve({ id: 'hc-shelf-1' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(prismaMock.hardcoverShelf.update).toHaveBeenCalledWith({
      where: { id: 'hc-shelf-1' },
      data: expect.objectContaining({
        lastSyncAt: null,
        bookCount: null,
        coverUrls: null,
      }),
    });
    expect(jobQueueMock.addSyncShelvesJob).toHaveBeenCalledWith(
      undefined,
      SHELF.id,
      'hardcover',
      0,
    );
  });

  it('updates listId, clears metadata, and triggers a sync job', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(SHELF);
    const updated = { ...SHELF, listId: 'status-3', lastSyncAt: null };
    prismaMock.hardcoverShelf.update.mockResolvedValueOnce(updated);

    const { PATCH } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ listId: 'status-3' }) } as any,
      { params: Promise.resolve({ id: 'hc-shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(prismaMock.hardcoverShelf.update).toHaveBeenCalledWith({
      where: { id: 'hc-shelf-1' },
      data: expect.objectContaining({ listId: 'status-3', lastSyncAt: null }),
    });
    expect(jobQueueMock.addSyncShelvesJob).toHaveBeenCalledWith(undefined, updated.id, 'hardcover', 0);
  });

  it('encrypts the apiToken before persisting', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.hardcoverShelf.update.mockResolvedValueOnce(SHELF);

    const { PATCH } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    await PATCH(
      { json: vi.fn().mockResolvedValue({ apiToken: 'my-raw-token' }) } as any,
      { params: Promise.resolve({ id: 'hc-shelf-1' }) }
    );

    expect(encryptionMock.encrypt).toHaveBeenCalledWith('my-raw-token');
    expect(prismaMock.hardcoverShelf.update).toHaveBeenCalledWith({
      where: { id: 'hc-shelf-1' },
      data: expect.objectContaining({ apiToken: 'enc:my-raw-token' }),
    });
  });

  it('strips the Bearer prefix before encrypting the token', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.hardcoverShelf.update.mockResolvedValueOnce(SHELF);

    const { PATCH } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    await PATCH(
      { json: vi.fn().mockResolvedValue({ apiToken: 'Bearer my-raw-token' }) } as any,
      { params: Promise.resolve({ id: 'hc-shelf-1' }) }
    );

    expect(encryptionMock.encrypt).toHaveBeenCalledWith('my-raw-token');
  });

  it('still returns 200 even when the sync job fails to enqueue', async () => {
    prismaMock.hardcoverShelf.findUnique.mockResolvedValueOnce(SHELF);
    prismaMock.hardcoverShelf.update.mockResolvedValueOnce({ ...SHELF, listId: 'status-3' });
    jobQueueMock.addSyncShelvesJob.mockRejectedValueOnce(new Error('queue down'));

    const { PATCH } = await import('@/app/api/user/hardcover-shelves/[id]/route');
    const response = await PATCH(
      { json: vi.fn().mockResolvedValue({ listId: 'status-3' }) } as any,
      { params: Promise.resolve({ id: 'hc-shelf-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
  });
});
