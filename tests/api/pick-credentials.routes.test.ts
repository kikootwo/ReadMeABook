/**
 * Component: Prowlarr Credentials Never Stored With or Returned in Picks
 * Documentation: documentation/phase3/download-clients.md
 *
 * With `prowlarr_url` = https://admin:S3cret@prowlarr.example, a picked link is
 * normalized onto the configured base WITHOUT credentials before it is stored,
 * and non-admin responses never include the stored pick.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;
const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addDownloadJob: vi.fn(), addNotificationJob: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler(authRequest),
}));
vi.mock('@/lib/middleware/interactive-search-access', () => ({ denyWithoutInteractiveSearchAccess: async () => null }));
vi.mock('@/lib/integrations/prowlarr-connection', async () => {
  const { parseProwlarrBase } = await import('@/lib/utils/prowlarr-url');
  const baseUrl = 'https://admin:S3cret@prowlarr.example';
  return { getProwlarrConnection: async () => ({ baseUrl, apiKey: 'k', base: parseProwlarrBase(baseUrl) }) };
});
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => null }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: async () => null }) }));

const PICK = 'http://prowlarr.example/1/download?link=a';
const NORMALIZED = 'https://prowlarr.example/1/download?link=a';
// What an older row could hold; the response must not echo it
const LEGACY_STORED = { downloadUrl: 'https://admin:S3cret@prowlarr.example/1/download?link=a' };
const torrent = { guid: 'g', title: 'T', size: 1, indexer: 'I', downloadUrl: PICK, publishDate: '2024-01-01' };

describe('picked Prowlarr links with configured credentials', () => {
  beforeEach(() => {
    authRequest = { user: { id: 'user-1', role: 'user' }, json: vi.fn() };
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', autoApproveRequests: false, plexUsername: 'u' });
    prismaMock.configuration.findUnique.mockResolvedValue(null);
  });

  it('request-with-torrent stores the pick without credentials and hides it from a non-admin', async () => {
    authRequest.json.mockResolvedValue({ audiobook: { asin: 'B000000001', title: 'T', author: 'A' }, torrent });
    prismaMock.request.findFirst.mockResolvedValue(null);
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: 'T', author: 'A' });
    prismaMock.request.create.mockResolvedValue({
      id: 'req-1', status: 'awaiting_approval', selectedTorrent: LEGACY_STORED,
      audiobook: { title: 'T', author: 'A' }, user: { id: 'user-1', plexUsername: 'u' },
    });

    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as any);
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(201);
    const stored = prismaMock.request.create.mock.calls[0][0].data.selectedTorrent;
    expect(stored.downloadUrl).toBe(NORMALIZED);
    expect(text).not.toContain('S3cret');
    expect(text).not.toContain('selectedTorrent');
  });

  it('select-torrent stores the pick without credentials and hides it from the owner', async () => {
    authRequest.json.mockResolvedValue({ torrent });
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-2', userId: 'user-1', status: 'awaiting_search', audiobook: { id: 'ab-1', title: 'T', author: 'A' },
    });
    prismaMock.request.update.mockResolvedValue({
      id: 'req-2', status: 'awaiting_approval', selectedTorrent: LEGACY_STORED, audiobook: { title: 'T', author: 'A' },
    });

    const { POST } = await import('@/app/api/requests/[id]/select-torrent/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-2' }) });
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(prismaMock.request.update.mock.calls[0][0].data.selectedTorrent.downloadUrl).toBe(NORMALIZED);
    expect(text).not.toContain('S3cret');
    expect(text).not.toContain('selectedTorrent');
  });
});
