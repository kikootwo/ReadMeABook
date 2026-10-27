/**
 * Component: E-book Direct Download Name at the Routes (#474)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * An Anna's Archive pick queued from the select-ebook route or at admin approval
 * gets a name of at most 255 bytes: the title is cut, the author kept whole.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const ANNAS = 'https://annas.example';
const MD5 = '0123456789abcdef0123456789abcdef';
const TITLE = 'Ж'.repeat(150);
const AUTHOR = 'Фёдор Михайлович Достоевский'; // 54 bytes
const asRequest = (request: object) => request as unknown as NextRequest;
// 255 - '.epub' - ' - ' - author = 193 bytes of title: 96 letters
const EXPECTED = `${'Ж'.repeat(96)} - ${AUTHOR}.epub`;

let authRequest: { user: Record<string, string>; json: () => unknown };
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));
const slowLinksMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler(authRequest),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getMany: async () => ({}),
    get: async (key: string) => (key === 'ebook_sidecar_base_url' ? ANNAS : null),
    getAudibleRegion: async () => 'us',
  }),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/ebook-scraper', () => ({ getSlowDownloadLinks: slowLinksMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => ({ plexGuid: 'plex-1' }) }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: async () => ({ title: 'Title', author: 'Author' }) }),
}));

describe('Anna\'s Archive download name at the routes (#474)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', sub: 'user-1', role: 'user' }, json: vi.fn() };
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1', role: 'admin', interactiveSearchAccess: null, autoApproveRequests: null, plexUsername: 'user',
    });
    slowLinksMock.mockResolvedValue([`${ANNAS}/slow_download/${MD5}/0/0`]);
  });

  it('POST /api/audiobooks/[asin]/select-ebook queues a long Cyrillic title with the author whole', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: TITLE, author: AUTHOR });
    prismaMock.request.findFirst.mockResolvedValue(null);
    prismaMock.request.create.mockResolvedValue({ id: 'ebook-1' });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
    const request = { json: async () => ({ ebook: { source: 'annas_archive', md5: MD5, title: 'Book', score: 100 } }) };

    const { POST } = await import('@/app/api/audiobooks/[asin]/select-ebook/route');
    const response = await POST(asRequest(request), { params: Promise.resolve({ asin: 'B000000001' }) });

    expect(response.status).toBe(200);
    const [, , , queuedName] = jobQueueMock.addStartDirectDownloadJob.mock.calls[0];
    expect(queuedName).toBe(EXPECTED);
    expect(Buffer.byteLength(queuedName, 'utf8')).toBeLessThanOrEqual(255);
  });

  it('POST /api/admin/requests/[id]/approve queues a long Cyrillic title with the author whole', async () => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-2', userId: 'user-2', type: 'ebook', status: 'awaiting_approval',
      selectedTorrent: { source: 'annas_archive', md5: MD5 },
      audiobook: { id: 'ab-1', title: TITLE, author: AUTHOR },
      user: { id: 'user-2', plexUsername: 'other' },
    });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-2' });
    prismaMock.request.update.mockResolvedValue({ id: 'req-2', audiobook: { title: TITLE, author: AUTHOR }, user: {} });
    const request = { json: async () => ({ action: 'approve' }) };

    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    await POST(asRequest(request), { params: Promise.resolve({ id: 'req-2' }) });

    const [, , , queuedName] = jobQueueMock.addStartDirectDownloadJob.mock.calls[0];
    expect(queuedName).toBe(EXPECTED);
  });

  it('a name that fits is queued unchanged', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: 'Война и мир', author: 'Лев Толстой' });
    prismaMock.request.findFirst.mockResolvedValue(null);
    prismaMock.request.create.mockResolvedValue({ id: 'ebook-1' });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
    const request = { json: async () => ({ ebook: { source: 'annas_archive', md5: MD5, title: 'Book', score: 100, format: 'pdf' } }) };

    const { POST } = await import('@/app/api/audiobooks/[asin]/select-ebook/route');
    await POST(asRequest(request), { params: Promise.resolve({ asin: 'B000000001' }) });

    const [, , , queuedName] = jobQueueMock.addStartDirectDownloadJob.mock.calls[0];
    expect(queuedName).toBe('Война и мир - Лев Толстой.pdf');
  });
});
