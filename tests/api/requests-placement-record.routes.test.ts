/**
 * Component: Request responses leave out the ebook placement record (#497)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Request.placedEbookFiles holds absolute library paths and hashes for the request
 * delete only. No response that returns a request row carries it, for users,
 * API tokens and admins alike.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: { user: { id: string; role: string }; nextUrl: URL; json: ReturnType<typeof vi.fn> };

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const createRequestForUserMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock, requireAdmin: requireAdminMock }));
vi.mock('@/lib/services/request-creator.service', () => ({ createRequestForUser: createRequestForUserMock }));
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

const PLACED = [{ path: '/media/Author/Book/Book.epub', size: 10, sha256: 'a'.repeat(64), placedAt: '2026-10-01T00:00:00.000Z' }];

/** A delivered ebook request row as Prisma returns it (include, no select). */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    userId: 'user-1',
    type: 'ebook',
    status: 'downloaded',
    selectedTorrent: null,
    placedEbookFiles: PLACED,
    audiobook: { id: 'ab-1', title: 'Book', author: 'Author', filePath: '/media/Author/Book' },
    user: { id: 'user-1', plexUsername: 'user' },
    ...overrides,
  };
}

function as(role: 'user' | 'admin', url = 'http://localhost/api/requests') {
  authRequest = { user: { id: role === 'admin' ? 'admin-1' : 'user-1', role }, nextUrl: new URL(url), json: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  as('user');
  requireAuthMock.mockImplementation((_req: unknown, handler: (req: unknown) => unknown) => handler(authRequest));
  requireAdminMock.mockImplementation((_req: unknown, handler: () => unknown) => handler());
  prismaMock.request.count.mockResolvedValue(1);
});

describe('GET /api/requests (on the API-token allowlist)', () => {
  it.each(['user', 'admin'] as const)('a %s gets no placedEbookFiles (and no audiobook.filePath)', async (role) => {
    as(role, 'http://localhost/api/requests?type=ebook');
    prismaMock.request.findMany.mockResolvedValueOnce([row()]);

    const { GET } = await import('@/app/api/requests/route');
    const payload = await (await GET({} as never)).json();

    expect(payload.requests).toHaveLength(1);
    expect(payload.requests[0].id).toBe('req-1');
    expect('placedEbookFiles' in payload.requests[0]).toBe(false);
    expect('filePath' in payload.requests[0].audiobook).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('Book.epub');
  });
});

describe('other responses that return a request row', () => {
  it('POST /api/requests', async () => {
    authRequest.json.mockResolvedValue({ audiobook: { asin: 'B0TEST0001', title: 'Book', author: 'Author' } });
    createRequestForUserMock.mockResolvedValueOnce({ success: true, request: row({ type: 'audiobook', status: 'pending', placedEbookFiles: null }) });

    const { POST } = await import('@/app/api/requests/route');
    const response = await POST({} as never);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.request.id).toBe('req-1');
    expect('placedEbookFiles' in payload.request).toBe(false);
  });

  it('GET /api/requests/[id] for an admin (full row)', async () => {
    as('admin', 'http://localhost/api/requests/req-1');
    prismaMock.request.findFirst.mockResolvedValueOnce(row({ downloadHistory: [], jobs: [] }));

    const { GET } = await import('@/app/api/requests/[id]/route');
    const payload = await (await GET({} as never, { params: Promise.resolve({ id: 'req-1' }) })).json();

    expect(payload.request.id).toBe('req-1');
    expect('placedEbookFiles' in payload.request).toBe(false);
  });

  it('PATCH /api/requests/[id] (cancel)', async () => {
    authRequest.json.mockResolvedValue({ action: 'cancel' });
    prismaMock.request.findFirst.mockResolvedValueOnce(row({ status: 'pending' }));
    prismaMock.request.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.downloadHistory.findFirst.mockResolvedValueOnce(null);

    const { PATCH } = await import('@/app/api/requests/[id]/route');
    const payload = await (await PATCH({} as never, { params: Promise.resolve({ id: 'req-1' }) })).json();

    expect(payload.request.status).toBe('cancelled');
    expect('placedEbookFiles' in payload.request).toBe(false);
  });

  it('GET /api/admin/requests/pending-approval', async () => {
    as('admin', 'http://localhost/api/admin/requests/pending-approval');
    prismaMock.request.findMany.mockResolvedValueOnce([row({ status: 'awaiting_approval' })]);

    const { GET } = await import('@/app/api/admin/requests/pending-approval/route');
    const payload = await (await GET({} as never)).json();

    expect(payload.requests[0].id).toBe('req-1');
    expect('placedEbookFiles' in payload.requests[0]).toBe(false);
  });
});

describe('hidePlacementRecord / hideStoredPick (approve, manual-search, select-torrent, request-with-torrent, reported-issue replace)', () => {
  it('hidePlacementRecord drops only the record', () => {
    const shown = JSON.parse(JSON.stringify(hidePlacementRecord(row())));
    expect('placedEbookFiles' in shown).toBe(false);
    expect(shown.audiobook.title).toBe('Book');
    expect(hidePlacementRecord(null)).toBeNull();
  });

  it.each(['user', 'admin'])('hideStoredPick drops the record for a %s too', (role) => {
    const shown = JSON.parse(JSON.stringify(hideStoredPick(row({ selectedTorrent: { title: 'pick' } }), role)));
    expect('placedEbookFiles' in shown).toBe(false);
    expect('selectedTorrent' in shown).toBe(role === 'admin');
  });
});
