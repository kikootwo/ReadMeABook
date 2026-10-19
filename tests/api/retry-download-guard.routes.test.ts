/**
 * Component: Admin Retry Download — stored-link check placement
 * Documentation: documentation/phase3/download-clients.md
 *
 * The stored link is only checked when the download is re-added; resuming
 * monitoring of a live torrent never uses it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addMonitorJob: vi.fn(), addDownloadJob: vi.fn() }));
const clientMock = vi.hoisted(() => ({ getDownload: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: any, handler: (r: unknown) => unknown) => handler(Object.assign(req, { user: { id: 'admin-1', sub: 'admin-1', role: 'admin' } })),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ getMany: async () => ({ prowlarr_url: 'http://prowlarr-new:9696', prowlarr_api_key: 'k' }) }),
}));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({ getClientServiceForProtocol: async () => clientMock }),
}));

const STALE_LINK = 'http://prowlarr-old:9696/1/download?link=abc';

describe('POST /api/admin/requests/[id]/retry-download', () => {
  beforeEach(() => {
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-1', status: 'failed', audiobook: { id: 'ab-1', title: 'Title', author: 'Author' },
    });
    prismaMock.downloadHistory.findFirst.mockResolvedValue({
      id: 'dh-1', magnetLink: STALE_LINK, downloadClient: 'qbittorrent', downloadClientId: 'hash-1',
      torrentName: 'Release', indexerName: 'Indexer', indexerId: 1, torrentSizeBytes: null,
      seeders: null, leechers: null, torrentHash: 'hash-1', torrentUrl: null,
    });
    prismaMock.request.update.mockResolvedValue({});
  });

  it('resumes monitoring a live torrent even when the stored link no longer matches Prowlarr', async () => {
    clientMock.getDownload.mockResolvedValue({ status: 'downloading' });
    const { POST } = await import('@/app/api/admin/requests/[id]/retry-download/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-1' }) });

    expect(response.status).toBe(200);
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('rejects re-adding a stored link that is not a Prowlarr download link or magnet', async () => {
    clientMock.getDownload.mockResolvedValue(null);
    const { POST } = await import('@/app/api/admin/requests/[id]/retry-download/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'req-1' }) });

    expect(response.status).toBe(400);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });
});
