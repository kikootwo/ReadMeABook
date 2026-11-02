/**
 * Component: Download Torrent Processor Tests (Prowlarr links published on a proxy's address, #298)
 * Documentation: documentation/phase3/download-clients.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getMany: vi.fn() }));
const jobQueueMock = createJobQueueMock();
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({
  ProwlarrService: { isNZBResult: vi.fn(() => false) },
}));

const CONFIGURED = 'http://admin:S3cret@prowlarr:9696/prowlarr';
const KEY = 'prowlarr-key-298';

const payload = (downloadUrl: string) => ({
  requestId: 'req-298',
  audiobook: { id: 'book-298', title: 'Book', author: 'Author' },
  torrent: {
    indexer: 'Indexer',
    indexerId: 12,
    title: 'Book - Author',
    size: 50 * 1024 * 1024,
    seeders: 10,
    publishDate: new Date(),
    downloadUrl,
    guid: 'guid-298',
    format: 'M4B',
    protocol: 'torrent',
  },
  jobId: 'job-298',
});

describe('processDownloadTorrent: Prowlarr link published on another address (#298)', () => {
  let addDownload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-298' });
    configMock.getMany.mockResolvedValue({ prowlarr_url: CONFIGURED, prowlarr_api_key: KEY });
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    addDownload = vi.fn().mockResolvedValue({ id: 'hash-298', alreadyInClient: false });
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue({ clientType: 'qbittorrent', protocol: 'torrent', addDownload });
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({ id: 'client-1', type: 'qbittorrent', enabled: true });
  });

  it('grabs a proxy link from the configured Prowlarr, with the key scoped to that address', async () => {
    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent(payload('https://u:p@127.0.0.1:9663/otherapp/12/download?link=abc&file=Book'));

    expect(result.success).toBe(true);
    expect(addDownload).toHaveBeenCalledTimes(1);
    const [url, options] = addDownload.mock.calls[0];
    expect(url).toBe('http://admin:S3cret@prowlarr:9696/prowlarr/12/download?link=abc&file=Book');
    expect(options.sourceAuth).toEqual({ prowlarrBaseUrl: CONFIGURED, apiKey: KEY });
    // The configured credentials are only on the fetch, never stored
    expect(JSON.stringify(prismaMock.downloadHistory.create.mock.calls)).not.toContain('S3cret');
  });

  it('passes a foreign link that is not a proxy link through unchanged, as before', async () => {
    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await processDownloadTorrent(payload('https://tracker.example/12/download'));

    expect(addDownload.mock.calls[0][0]).toBe('https://tracker.example/12/download');
  });
});
