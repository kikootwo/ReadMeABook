/**
 * Component: Download Torrent Processor Tests, a grab that ends a next-release chain (#332)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * The grab of the next release fails for good: the chain ends with the request `failed`, so the
 * requester gets one closing notification, on Bull's last attempt only. Outside a chain nothing
 * changes (no notification, as on main).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';
import { DownloadSourceError } from '@/lib/interfaces/download-client.interface';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getMany: vi.fn() }));
const jobQueueMock = createJobQueueMock();
const managerMock = vi.hoisted(() => ({ getClientForProtocol: vi.fn(), getClientServiceForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ ProwlarrService: { isNZBResult: () => false } }));

const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');

const CLOSING = 'Download failed: the next release could not be added to the download client';
const LAST = { attemptsMade: 2, attempts: 3 };

const payload = (clientFailures?: number) => ({
  requestId: 'req-1',
  audiobook: { id: 'a1', title: 'Book', author: 'Author' },
  torrent: {
    indexer: 'Indexer', indexerId: 1, title: 'Author - Book [M4B]', size: 50 * 1024 * 1024, seeders: 10,
    publishDate: new Date(), downloadUrl: 'magnet:?xt=urn:btih:abc', guid: 'guid-1', format: 'M4B', protocol: 'torrent',
  },
  jobId: 'job-1',
  ...(clientFailures !== undefined && { clientFailures }),
});

const failingClient = (error: Error) => {
  managerMock.getClientServiceForProtocol.mockResolvedValue({ clientType: 'qbittorrent', protocol: 'torrent', addDownload: vi.fn().mockRejectedValue(error) });
  managerMock.getClientForProtocol.mockResolvedValue({ id: 'client-1', type: 'qbittorrent', enabled: true, category: 'readmeabook' });
};

const notifications = () => jobQueueMock.addNotificationJob.mock.calls.map((call) => call[5]);

describe('processDownloadTorrent, the grab that ends a chain (#332)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.getMany.mockResolvedValue({ prowlarr_api_key: null });
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', type: 'audiobook', status: 'downloading', deletedAt: null,
      audiobook: { title: 'Book', author: 'Author' }, user: { plexUsername: 'user' },
    });
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  it('a permanent grab error on the last attempt: the request fails with one closing notification', async () => {
    failingClient(new Error('Torrent file is not valid'));

    await expect(processDownloadTorrent(payload(1), LAST)).rejects.toThrow('Torrent file is not valid');

    expect(prismaMock.request.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
    expect(notifications()).toEqual([CLOSING]);
  });

  it('a temporary grab error on the last attempt (the queue then marks it failed): one closing notification', async () => {
    failingClient(new DownloadSourceError('Grab failed: source returned HTTP 503', 503, 'https://prowlarr/1/download/x'));

    await expect(processDownloadTorrent(payload(2), LAST)).rejects.toThrow('HTTP 503');

    expect(notifications()).toEqual([CLOSING]);
  });

  it('with a retry still to come: no notification yet', async () => {
    failingClient(new Error('Torrent file is not valid'));

    await expect(processDownloadTorrent(payload(1), { attemptsMade: 0, attempts: 3 })).rejects.toThrow();

    expect(notifications()).toEqual([]);
  });

  it.each([undefined, 0])('outside a chain (count %s): no notification, as before', async (count) => {
    failingClient(new Error('Torrent file is not valid'));

    await expect(processDownloadTorrent(payload(count), LAST)).rejects.toThrow();

    expect(notifications()).toEqual([]);
  });

  it('a cancel that landed meanwhile: no notification', async () => {
    failingClient(new Error('Torrent file is not valid'));
    // The opening `downloading` write matches; the failed write meets the cancel
    prismaMock.request.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', type: 'audiobook', status: 'cancelled', deletedAt: null, user: { plexUsername: 'user' } });

    await expect(processDownloadTorrent(payload(1), LAST)).rejects.toThrow();

    expect(notifications()).toEqual([]);
  });

  it('a temporary error after a cancel: no notification', async () => {
    failingClient(new DownloadSourceError('Grab failed: source returned HTTP 503', 503, 'https://prowlarr/1/download/x'));
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', type: 'audiobook', status: 'cancelled', deletedAt: null, user: { plexUsername: 'user' } });

    await expect(processDownloadTorrent(payload(1), LAST)).rejects.toThrow();

    expect(notifications()).toEqual([]);
  });
});
