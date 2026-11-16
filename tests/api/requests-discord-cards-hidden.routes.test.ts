/**
 * Component: The Discord message references (Request.discordCards): no response carries them
 * Documentation: documentation/backend/database.md
 *
 * Every response that returns a request row leaves out the stored Discord channel and message
 * IDs, for users, API tokens and admins alike: approve and deny, the request lists, the admin
 * detail, the pending-approval list, and every response built with hidePlacementRecord.
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

const CARDS = [
  { kind: 'dm', channelId: '444444444444444443', messageId: '900000000000000001' },
  { kind: 'approval', channelId: '444444444444444442', messageId: '900000000000000002' },
];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    userId: 'user-1',
    type: 'audiobook',
    status: 'available',
    selectedTorrent: null,
    placedEbookFiles: null,
    approvalBypassedBy: null,
    discordCards: CARDS,
    audiobook: { id: 'ab-1', title: 'Book', author: 'Author', audibleAsin: 'B00TEST001', filePath: '/media/Author/Book' },
    user: { id: 'user-1', plexUsername: 'reader' },
    ...overrides,
  };
}

function as(role: 'user' | 'admin', url = 'http://localhost/api/requests') {
  const id = role === 'admin' ? 'admin-1' : 'user-1';
  authRequest = { user: { id, sub: id, role }, nextUrl: new URL(url), json: vi.fn() };
}

/** No Discord ID anywhere in the payload. */
function expectNoCards(payload: unknown) {
  const text = JSON.stringify(payload);
  expect(text).not.toContain('discordCards');
  expect(text).not.toContain('900000000000000001');
  expect(text).not.toContain('444444444444444442');
}

beforeEach(() => {
  vi.clearAllMocks();
  as('user');
  prismaMock.request.count.mockResolvedValue(1);
});

describe('no response carries the Discord message references', () => {
  it.each(['approve', 'deny'] as const)('POST /api/admin/requests/[id]/approve (%s)', async (action) => {
    as('admin');
    let written: Record<string, unknown> = {};
    prismaMock.request.findFirst.mockResolvedValueOnce(row({ status: 'awaiting_approval' }));
    prismaMock.request.updateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      written = data;
      return { count: 1 };
    });
    prismaMock.request.findUnique.mockImplementation(async () => row(written));

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ action }) } as never, { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.request.id).toBe('req-1');
    expectNoCards(payload);
  });

  it.each(['user', 'admin'] as const)('GET /api/requests for a %s', async (role) => {
    as(role, 'http://localhost/api/requests');
    prismaMock.request.findMany.mockResolvedValueOnce([row()]);

    const { GET } = await import('@/app/api/requests/route');
    const payload = await (await GET({} as never)).json();

    expect(payload.requests[0]).toMatchObject({ id: 'req-1' });
    expectNoCards(payload);
  });

  it('GET /api/requests/[id] for an admin (full row)', async () => {
    as('admin', 'http://localhost/api/requests/req-1');
    prismaMock.request.findFirst.mockResolvedValueOnce(row({ downloadHistory: [], jobs: [] }));

    const { GET } = await import('@/app/api/requests/[id]/route');
    const payload = await (await GET({} as never, { params: Promise.resolve({ id: 'req-1' }) })).json();

    expect(payload.request.id).toBe('req-1');
    expectNoCards(payload);
  });

  it('GET /api/admin/requests/pending-approval', async () => {
    as('admin', 'http://localhost/api/admin/requests/pending-approval');
    prismaMock.request.findMany.mockResolvedValueOnce([row({ status: 'awaiting_approval' })]);

    const { GET } = await import('@/app/api/admin/requests/pending-approval/route');
    const payload = await (await GET({} as never)).json();

    expect(payload.requests[0].id).toBe('req-1');
    expectNoCards(payload);
  });

  it('hidePlacementRecord and hideStoredPick drop them (manual-search, select-torrent, PATCH and the rest)', () => {
    expectNoCards(hidePlacementRecord(row()));
    for (const role of ['user', 'admin']) expectNoCards(hideStoredPick(row(), role));
  });
});
