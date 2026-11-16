/**
 * Component: Admin Approve Route + real token auth (integration)
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * The real requireAuth, the real permission gate and the real route together (database and job
 * queue faked), so the route's token checks cannot drift from what the middleware sets.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { approvalDb } from '../helpers/approval-db-fake';

const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));

vi.mock('@/lib/db', async () => ({ prisma: (await import('../helpers/approval-db-fake')).approvalDb.prisma }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/release-gate', () => ({ shouldWaitForRelease: async () => false }));

const DAY = 24 * 60 * 60 * 1000;
const SECRET = 'rmab_integration_0123456789abcdef';
const HASH = crypto.createHash('sha256').update(SECRET).digest('hex');
let settingValue: string | null = 'true';
let tokenOverrides: Record<string, unknown> = {};

function tokenRow() {
  const createdAt = new Date(Date.now() - 1000);
  return {
    id: 'tok-1',
    name: 'Approver',
    tokenHash: HASH,
    tokenPrefix: 'rmab_integra',
    role: 'admin',
    canApproveRequests: true,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 90 * DAY),
    tokenUser: { id: 'admin-1', plexId: 'local-admin', plexUsername: 'admin', role: 'admin', deletedAt: null, registrationStatus: 'approved' },
    ...tokenOverrides,
  };
}

async function approve(body: unknown) {
  const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
  const request = new NextRequest('http://localhost/api/admin/requests/req-1/approve', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ id: 'req-1' }) });
  return { status: response.status, body: await response.json() };
}

describe('approve route with real token auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approvalDb.reset();
    approvalDb.seed();
    settingValue = 'true';
    tokenOverrides = {};
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    approvalDb.prisma.apiToken.findUnique.mockImplementation(async ({ where }: any) => (where.tokenHash === HASH ? tokenRow() : null));
    approvalDb.prisma.apiToken.update.mockResolvedValue({});
    approvalDb.prisma.configuration.findUnique.mockImplementation(async ({ where }: any) =>
      where.key === 'api_tokens.allow_request_approval' && settingValue !== null ? { key: where.key, value: settingValue } : null
    );
  });

  it('a flagged admin token with the setting on approves (200, search queued)', async () => {
    const result = await approve({ action: 'approve' });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Request approved and search job triggered');
    expect(approvalDb.rows.get('req-1')!.status).toBe('pending');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
  });

  it('deny is 403 and the row is unchanged', async () => {
    const result = await approve({ action: 'deny' });

    expect(result.status).toBe(403);
    expect(result.body.message).toBe('API tokens can only approve requests. Deny in the web UI or in Discord.');
    expect(approvalDb.rows.get('req-1')!.status).toBe('awaiting_approval');
  });

  it('a selectedTorrent is 400 and the row is unchanged', async () => {
    const result = await approve({ action: 'approve', selectedTorrent: { title: 'x', downloadUrl: 'magnet:?xt=urn:btih:x' } });

    expect(result.status).toBe(400);
    expect(approvalDb.rows.get('req-1')!.status).toBe('awaiting_approval');
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('the setting off is 403 and nothing is read or queued', async () => {
    settingValue = 'false';
    const result = await approve({ action: 'approve' });

    expect(result.status).toBe(403);
    expect(approvalDb.prisma.request.findFirst).not.toHaveBeenCalled();
    expect(approvalDb.rows.get('req-1')!.status).toBe('awaiting_approval');
  });

  it('an unflagged admin token is 403', async () => {
    tokenOverrides = { canApproveRequests: false };
    expect((await approve({ action: 'approve' })).status).toBe(403);
    expect(approvalDb.rows.get('req-1')!.status).toBe('awaiting_approval');
  });

  it('an expired token is 401', async () => {
    tokenOverrides = { createdAt: new Date(Date.now() - 91 * DAY), expiresAt: new Date(Date.now() - 1000) };
    const result = await approve({ action: 'approve' });

    expect(result.status).toBe(401);
    expect(approvalDb.rows.get('req-1')!.status).toBe('awaiting_approval');
  });
});
