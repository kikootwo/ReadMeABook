/**
 * Component: Watched Authors API Route Tests
 * Documentation: documentation/features/watched-lists.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addCheckWatchedItemJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

const WATCHED_AUTHOR = {
  id: 'wa-1',
  userId: 'user-1',
  authorAsin: 'B001AUTH01',
  authorName: 'Author A',
  coverArtUrl: null,
  includeBackCatalog: false,
  lastCheckedAt: null,
  createdAt: new Date('2026-08-01T12:00:00Z'),
  updatedAt: new Date('2026-08-01T12:00:00Z'),
};

describe('watched author catalog mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'user-1', role: 'user' },
      json: vi.fn(),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('defaults new watched authors to new releases only', async () => {
    authRequest.json.mockResolvedValue({
      authorAsin: 'B001AUTH01',
      authorName: 'Author A',
    });
    prismaMock.watchedAuthor.findUnique.mockResolvedValue(null);
    prismaMock.watchedAuthor.create.mockResolvedValue(WATCHED_AUTHOR);

    const { POST } = await import('@/app/api/user/watched-authors/route');
    const response = await POST({} as any);

    expect(response.status).toBe(201);
    expect(prismaMock.watchedAuthor.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ includeBackCatalog: false }),
    });
  });

  it('updates the mode and checks the author when back catalog is enabled', async () => {
    authRequest.json.mockResolvedValue({ includeBackCatalog: true });
    prismaMock.watchedAuthor.findUnique.mockResolvedValue(WATCHED_AUTHOR);
    prismaMock.watchedAuthor.update.mockResolvedValue({ ...WATCHED_AUTHOR, includeBackCatalog: true });

    const { PATCH } = await import('@/app/api/user/watched-authors/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'wa-1' }) });

    expect(response.status).toBe(200);
    expect(prismaMock.watchedAuthor.update).toHaveBeenCalledWith({
      where: { id: 'wa-1' },
      data: { includeBackCatalog: true },
    });
    expect(jobQueueMock.addCheckWatchedItemJob).toHaveBeenCalledWith(
      'user-1',
      undefined,
      'B001AUTH01'
    );
  });

  it('does not allow another user to change the mode', async () => {
    authRequest.json.mockResolvedValue({ includeBackCatalog: true });
    prismaMock.watchedAuthor.findUnique.mockResolvedValue({ ...WATCHED_AUTHOR, userId: 'user-2' });

    const { PATCH } = await import('@/app/api/user/watched-authors/[id]/route');
    const response = await PATCH({} as any, { params: Promise.resolve({ id: 'wa-1' }) });

    expect(response.status).toBe(403);
    expect(prismaMock.watchedAuthor.update).not.toHaveBeenCalled();
  });
});
