/**
 * Component: The approval record (Request.approvalBypassedBy, #232): approve clears it, no response carries it
 * Documentation: documentation/backend/database.md
 *
 * The approve route writes NULL (an approval clears an earlier record); deny leaves the field alone.
 * No response that returns a request row carries the field, for users, API tokens and admins alike.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: { user: { id: string; sub: string; role: string }; nextUrl: URL; json: ReturnType<typeof vi.fn> };

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addDownloadJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler(authRequest),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({}) }));
vi.mock('@/lib/integrations/prowlarr-connection', () => ({
  getProwlarrConnection: async () => ({
    baseUrl: 'http://prowlarr:9696',
    apiKey: 'test-prowlarr-key',
    base: { origin: 'http://prowlarr:9696', protocol: 'http:', hostname: 'prowlarr', host: 'prowlarr:9696', port: '9696', defaultPort: false, userinfo: '', basePath: '' },
  }),
}));

const { hidePlacementRecord, hideStoredPick } = await import('@/lib/services/request-detail-query');

const MARK = 'manual_import:denied';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    userId: 'user-1',
    type: 'audiobook',
    status: 'available',
    selectedTorrent: null,
    placedEbookFiles: null,
    approvalBypassedBy: MARK,
    audiobook: { id: 'ab-1', title: 'Book', author: 'Author', audibleAsin: 'B00TEST001', filePath: '/media/Author/Book' },
    user: { id: 'user-1', plexUsername: 'reader' },
    ...overrides,
  };
}

function as(role: 'user' | 'admin', url = 'http://localhost/api/requests') {
  const id = role === 'admin' ? 'admin-1' : 'user-1';
  authRequest = { user: { id, sub: id, role }, nextUrl: new URL(url), json: vi.fn() };
}

async function approve(action: 'approve' | 'deny') {
  const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
  const response = await POST({ json: vi.fn().mockResolvedValue({ action }) } as never, { params: Promise.resolve({ id: 'req-1' }) });
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  as('user');
  prismaMock.request.count.mockResolvedValue(1);
  prismaMock.request.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
});

describe('POST /api/admin/requests/[id]/approve', () => {
  beforeEach(() => {
    as('admin');
    // The approval service claims the transition with a status-guarded updateMany
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
  });

  it('approving with no stored pick clears the record (written as NULL)', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce(row({ status: 'awaiting_approval' }));

    const res = await approve('approve');

    expect(res.status).toBe(200);
    expect(prismaMock.request.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'pending', approvalBypassedBy: null });
    expect('approvalBypassedBy' in res.body.request).toBe(false);
  });

  it('approving with the user\'s stored pick clears the record (written as NULL)', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce(row({
      status: 'awaiting_approval',
      selectedTorrent: { title: 'Pick', size: 100, downloadUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) },
    }));

    const res = await approve('approve');

    expect(res.status).toBe(200);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'downloading', approvalBypassedBy: null });
  });

  it('denying leaves the record alone', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce(row({ status: 'awaiting_approval' }));

    const res = await approve('deny');

    expect(res.status).toBe(200);
    expect(prismaMock.request.updateMany.mock.calls[0][0].data).toEqual({ status: 'denied' });
    expect('approvalBypassedBy' in res.body.request).toBe(false);
  });
});

describe('no response carries the record', () => {
  it.each(['user', 'admin'] as const)('GET /api/requests (on the API-token allowlist) for a %s', async (role) => {
    as(role, 'http://localhost/api/requests');
    prismaMock.request.findMany.mockResolvedValueOnce([row()]);

    const { GET } = await import('@/app/api/requests/route');
    const payload = await (await GET({} as never)).json();

    expect(payload.requests).toHaveLength(1);
    expect(payload.requests[0]).toMatchObject({ id: 'req-1', status: 'available' });
    expect('approvalBypassedBy' in payload.requests[0]).toBe(false);
    expect(JSON.stringify(payload)).not.toContain(MARK);
  });

  it('GET /api/requests/[id] for an admin (full row)', async () => {
    as('admin', 'http://localhost/api/requests/req-1');
    prismaMock.request.findFirst.mockResolvedValueOnce(row({ downloadHistory: [], jobs: [] }));

    const { GET } = await import('@/app/api/requests/[id]/route');
    const payload = await (await GET({} as never, { params: Promise.resolve({ id: 'req-1' }) })).json();

    expect(payload.request.id).toBe('req-1');
    expect('approvalBypassedBy' in payload.request).toBe(false);
  });

  it('GET /api/admin/requests/pending-approval', async () => {
    as('admin', 'http://localhost/api/admin/requests/pending-approval');
    prismaMock.request.findMany.mockResolvedValueOnce([row({ status: 'awaiting_approval' })]);

    const { GET } = await import('@/app/api/admin/requests/pending-approval/route');
    const payload = await (await GET({} as never)).json();

    expect(payload.requests[0].id).toBe('req-1');
    expect('approvalBypassedBy' in payload.requests[0]).toBe(false);
  });

  it('hidePlacementRecord and hideStoredPick drop it (approve, manual-search, select-torrent, request-with-torrent, PATCH, POST)', () => {
    const shown = JSON.parse(JSON.stringify(hidePlacementRecord(row())));
    expect('approvalBypassedBy' in shown).toBe(false);
    expect(shown.audiobook.title).toBe('Book');
    for (const role of ['user', 'admin']) {
      expect('approvalBypassedBy' in JSON.parse(JSON.stringify(hideStoredPick(row(), role)))).toBe(false);
    }
  });
});
