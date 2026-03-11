/**
 * Component: Shelves Sync API Route Tests
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

describe('POST /api/user/shelves/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'user' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('triggers a manual sync for all shelves when no parameters provided', async () => {
    const { POST } = await import('@/app/api/user/shelves/sync/route');
    const response = await POST(
      { json: vi.fn().mockResolvedValue({}) } as any,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);

    // Both tables should have updateMany called to clear lastSyncAt
    expect(prismaMock.goodreadsShelf.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { lastSyncAt: null },
    });
    expect(prismaMock.hardcoverShelf.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { lastSyncAt: null },
    });

    expect(jobQueueMock.addSyncShelvesJob).toHaveBeenCalledWith(
      undefined, // scheduledJobId
      undefined, // shelfId
      undefined, // shelfType
      0, // maxLookupsPerShelf (unlimited for manual)
      'user-1' // userId
    );
  });

  it('triggers a manual sync for a specific shelf', async () => {
    const { POST } = await import('@/app/api/user/shelves/sync/route');
    const response = await POST(
      { json: vi.fn().mockResolvedValue({ shelfId: 'shelf-123', shelfType: 'goodreads' }) } as any,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);

    // Only goodreads should be updated since shelfType is specified
    expect(prismaMock.goodreadsShelf.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: 'shelf-123' },
      data: { lastSyncAt: null },
    });
    expect(prismaMock.hardcoverShelf.updateMany).not.toHaveBeenCalled();

    expect(jobQueueMock.addSyncShelvesJob).toHaveBeenCalledWith(
      undefined, // scheduledJobId
      'shelf-123', // shelfId
      'goodreads', // shelfType
      0, // maxLookupsPerShelf
      'user-1' // userId
    );
  });

  it('handles invalid body gracefully', async () => {
    const { POST } = await import('@/app/api/user/shelves/sync/route');
    const response = await POST(
      { json: vi.fn().mockRejectedValue(new Error('Invalid JSON')) } as any,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    // Since body parsing fails gracefully with catching () => ({}), it treats it as sync all
    expect(jobQueueMock.addSyncShelvesJob).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      0,
      'user-1'
    );
  });

  it('validates wrong shelfType', async () => {
    const { POST } = await import('@/app/api/user/shelves/sync/route');
    const response = await POST(
      { json: vi.fn().mockResolvedValue({ shelfType: 'invalid-type' }) } as any,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
    expect(jobQueueMock.addSyncShelvesJob).not.toHaveBeenCalled();
  });
});
