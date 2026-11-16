/**
 * Component: Request Approval via API Token Tests
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Past the middleware gates, a token approves with the requester's own pick or an automatic search
 * only (a body release is refused), and every token approve/deny is logged with the token.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
  addDownloadJob: vi.fn(),
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock, requireAdmin: requireAdminMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => loggerMock } }));

const TOKEN = { id: 'token-1', name: 'Absorb', tokenPrefix: 'rmab_approv', canApproveRequests: true };

const awaiting = {
  id: 'req-1',
  userId: 'user-1',
  type: 'audiobook',
  status: 'awaiting_approval',
  selectedTorrent: null,
  audiobook: { id: 'ab-1', title: 'Book', author: 'Author', audibleAsin: 'ASIN-1' },
  user: { id: 'user-1', plexUsername: 'reader' },
};

async function approve(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
  const response = await POST({ json: vi.fn().mockResolvedValue(body) } as any, { params: Promise.resolve({ id: 'req-1' }) });
  return { status: response.status, body: await response.json() };
}

describe('POST /api/admin/requests/[id]/approve with an API token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', sub: 'admin-1', username: 'boss', role: 'admin' }, apiToken: TOKEN };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
    prismaMock.request.findFirst.mockResolvedValue(awaiting);
    prismaMock.request.update.mockImplementation(async ({ data }: any) => ({ ...awaiting, ...data }));
  });

  it('refuses a release named in the body, before touching the request', async () => {
    const res = await approve({
      action: 'approve',
      selectedTorrent: { title: 'Anything', downloadUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot choose a release/);
    expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringMatching(/tried to approve with its own release/), expect.objectContaining({ tokenPrefix: 'rmab_approv' }));
  });

  it('approves with an automatic search and logs the token and the admin', async () => {
    const res = await approve({ action: 'approve' });

    expect(res.status).toBe(200);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', expect.objectContaining({ id: 'ab-1' }));
    expect(loggerMock.info).toHaveBeenCalledWith(
      'API token "Absorb" (rmab_approv) approving request req-1',
      expect.objectContaining({ action: 'approve', tokenId: 'token-1', adminId: 'admin-1', adminUsername: 'boss' })
    );
  });

  it('denies and logs it', async () => {
    const res = await approve({ action: 'deny' });

    expect(res.status).toBe(200);
    expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'denied' } }));
    expect(loggerMock.info).toHaveBeenCalledWith('API token "Absorb" (rmab_approv) denying request req-1', expect.objectContaining({ action: 'deny' }));
  });

  it('accepts an explicit null release (no pick) like an absent one', async () => {
    expect((await approve({ action: 'approve', selectedTorrent: null })).status).toBe(200);
  });

  it('still lets a logged-in admin pick a release (no token: unchanged)', async () => {
    authRequest = { user: { id: 'admin-1', sub: 'admin-1', role: 'admin' } };

    const res = await approve({ action: 'approve', selectedTorrent: { title: 'Pick' } });

    // Reaches the release check instead of the token refusal
    expect(res.body.message ?? '').not.toMatch(/cannot choose a release/);
    expect(prismaMock.request.findFirst).toHaveBeenCalled();
    expect(loggerMock.info).not.toHaveBeenCalledWith(expect.stringMatching(/^API token/), expect.anything());
  });
});
