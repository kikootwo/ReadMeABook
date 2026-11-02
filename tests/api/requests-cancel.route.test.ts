/**
 * Component: Request Cancel API Route Tests (#228)
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Fails on main: the route does not exist, and API tokens had no way to cancel a request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authUser: { id: string; role: string } | null;

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const requireAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock }));

const record = (userId = 'user-1', status = 'downloading') => ({
  id: 'req-1', userId, status, audiobookId: 'ab-1', type: 'audiobook',
  audiobook: { title: 'Book', author: 'Author' }, user: { plexUsername: 'reader' },
});

async function post(id = 'req-1') {
  const { POST } = await import('@/app/api/requests/[id]/cancel/route');
  const response = await POST({} as never, { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { id: 'user-1', role: 'user' };
  requireAuthMock.mockImplementation((_req: unknown, handler: (r: unknown) => unknown) => handler({ user: authUser }));
  jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  prismaMock.request.findFirst.mockResolvedValue(record());
  prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.downloadHistory.findFirst.mockResolvedValue(null); // no download yet
});

describe('POST /api/requests/:id/cancel', () => {
  it('the owner (user token) cancels their own request: 200 with a minimal body', async () => {
    const { status, body } = await post();

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      request: { id: 'req-1', status: 'cancelled', cancelledAt: expect.any(String) },
      download: 'none',
      message: 'Request cancelled.',
    });
    expect(JSON.stringify(body)).not.toMatch(/selectedTorrent|downloadHistory|torrentHash|audiobook/);
    expect(prismaMock.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'req-1', deletedAt: null } }));
  });

  it('a user cannot cancel another user\'s request: 403, nothing written', async () => {
    prismaMock.request.findFirst.mockResolvedValue(record('user-2'));
    const { status, body } = await post();

    expect(status).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
  });

  it('an admin (effective role) cancels any request', async () => {
    authUser = { id: 'admin-1', role: 'admin' };
    prismaMock.request.findFirst.mockResolvedValue(record('user-2'));
    expect((await post()).status).toBe(200);
  });

  it('a token whose owner was demoted acts as a user (the middleware resolves the current role)', async () => {
    authUser = { id: 'user-1', role: 'user' };
    prismaMock.request.findFirst.mockResolvedValue(record('user-9'));
    expect((await post()).status).toBe(403);
  });

  it('unknown or soft-deleted request: 404', async () => {
    prismaMock.request.findFirst.mockResolvedValue(null);
    const { status, body } = await post('nope');
    expect(status).toBe(404);
    expect(body.error).toBe('NotFound');
  });

  it('a status that cannot be cancelled: 400', async () => {
    prismaMock.request.findFirst.mockResolvedValue(record('user-1', 'available'));
    const { status, body } = await post();
    expect(status).toBe(400);
    expect(body.message).toBe('Cannot cancel request with status: available');
  });

  it('a non-admin message never names the client', async () => {
    prismaMock.downloadHistory.findFirst.mockResolvedValue({
      id: 'dh-1', requestId: 'req-1', selected: true, downloadStatus: 'downloading', downloadClient: 'qbittorrent',
      torrentHash: 'h', downloadClientId: 'h', addedByRmab: false, createdAt: new Date(), nzbId: null,
    });
    const { body } = await post();
    // An owner gets `kept`, not which kind of keep (#228 review)
    expect(body.download).toBe('kept');
    expect(body.message).not.toMatch(/qBittorrent/);
  });

  it('without a user: 401', async () => {
    authUser = null;
    expect((await post()).status).toBe(401);
  });
});
