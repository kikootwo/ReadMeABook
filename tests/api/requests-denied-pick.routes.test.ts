/**
 * Component: A denied request stays denied (#232)
 * Documentation: documentation/admin-features/request-approval.md
 *
 * A non-admin can't pick a release for, or search releases for, a request an admin denied, even
 * when the user's approval setting has since changed to auto-approve (select-torrent re-checks
 * approval on current settings only). This matches the UI, which never offers it. Admins are
 * unchanged: they can still search and pick for a denied request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: { user: { id: string; role: string }; json: ReturnType<typeof vi.fn> };

const prismaMock = createPrismaMock();
const configServiceMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addDownloadJob: vi.fn(), addNotificationJob: vi.fn(() => Promise.resolve()) }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler(authRequest),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr-connection', () => ({
  getProwlarrConnection: async () => ({
    baseUrl: 'http://prowlarr:9696',
    apiKey: 'test-prowlarr-key',
    base: { origin: 'http://prowlarr:9696', protocol: 'http:', hostname: 'prowlarr', host: 'prowlarr:9696', port: '9696', defaultPort: false, userinfo: '', basePath: '' },
  }),
}));
// Interactive search permission is covered by tests/api/interactive-search-access.test.ts
vi.mock('@/lib/middleware/interactive-search-access', () => ({ denyWithoutInteractiveSearchAccess: async () => null }));

const TORRENT = { title: 'Torrent', size: 100, downloadUrl: 'http://prowlarr:9696/1/download' };
const DENIED = { id: 'req-1', userId: 'user-1', status: 'denied', audiobook: { id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'B00ASIN123' } };

function as(role: 'user' | 'admin') {
  authRequest = { user: { id: role === 'admin' ? 'admin-1' : 'user-1', role }, json: vi.fn().mockResolvedValue({ torrent: TORRENT }) };
}

async function selectTorrent() {
  const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
  const response = await POST({} as never, { params: Promise.resolve({ id: 'req-1' }) });
  return { status: response.status, body: await response.json() };
}

async function interactiveSearch() {
  const { POST } = await import('@/app/api/requests/[id]/interactive-search/route');
  const response = await POST({} as never, { params: Promise.resolve({ id: 'req-1' }) });
  return { status: response.status, body: await response.json() };
}

describe('a denied request stays denied (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    as('user');
    prismaMock.request.findFirst.mockResolvedValue({ ...DENIED });
    prismaMock.configuration.findUnique.mockResolvedValue(null); // global auto-approve (default true)
    configServiceMock.get.mockResolvedValue(null); // no indexers configured
    prismaMock.request.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...DENIED, ...data }));
  });

  it.each([true, null])('the owner can\'t pick a release for their denied request (autoApproveRequests %s)', async (autoApproveRequests) => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', autoApproveRequests, plexUsername: 'reader' });

    const res = await selectTorrent();

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'RequestDenied', message: 'This request was denied by an admin. You cannot download a release for it.' });
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
    expect(prismaMock.request.update).not.toHaveBeenCalled();
  });

  it('the owner can\'t search releases for their denied request', async () => {
    const res = await interactiveSearch();

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'RequestDenied', message: 'This request was denied by an admin. You cannot search for releases for it.' });
    expect(configServiceMock.get).not.toHaveBeenCalled();
  });

  it('an admin can still pick a release for a denied request: the download starts', async () => {
    as('admin');
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', autoApproveRequests: null, plexUsername: 'admin' });

    const res = await selectTorrent();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-1', expect.objectContaining({ id: 'ab-1' }), expect.objectContaining({ title: 'Torrent' }));
    expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'downloading' }) }));
  });

  it('an admin can still search releases for a denied request (gets past the status checks)', async () => {
    as('admin');

    const res = await interactiveSearch();

    expect(res.status).toBe(400); // the next check: no indexers configured in this test
    expect(res.body.error).toBe('ConfigError');
    expect(configServiceMock.get).toHaveBeenCalledWith('prowlarr_indexers');
  });

  it.each(['failed', 'pending', 'awaiting_search'])('the owner can still pick a release for a %s request', async (status) => {
    prismaMock.request.findFirst.mockResolvedValue({ ...DENIED, status });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', autoApproveRequests: true, plexUsername: 'reader' });

    const res = await selectTorrent();

    expect(res.status).toBe(200);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
  });
});
