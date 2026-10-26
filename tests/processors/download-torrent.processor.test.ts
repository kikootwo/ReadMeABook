/**
 * Component: Download Torrent Processor Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';
import { DownloadSourceError, UnusableDownloadSourceError } from '@/lib/interfaces/download-client.interface';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({
  get: vi.fn(),
  getMany: vi.fn().mockResolvedValue({ prowlarr_api_key: null }),
}));
const jobQueueMock = createJobQueueMock();
const qbtMock = vi.hoisted(() => ({ addTorrent: vi.fn() }));
const sabMock = vi.hoisted(() => ({ addNZB: vi.fn() }));

const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/integrations/qbittorrent.service', () => ({
  getQBittorrentService: () => qbtMock,
}));

vi.mock('@/lib/integrations/sabnzbd.service', () => ({
  getSABnzbdService: () => sabMock,
}));

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  ProwlarrService: {
    isNZBResult: vi.fn((result: any) => {
      // Detect NZB by URL pattern or protocol field
      return result.downloadUrl?.endsWith('.nzb') || result.protocol === 'usenet';
    }),
  },
}));

describe('processDownloadTorrent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // An active request: the stop guard's conditional status writes match one row
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    // Restore default implementations cleared by clearAllMocks
    configMock.getMany.mockResolvedValue({ prowlarr_api_key: null });
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  const torrentPayload = {
    requestId: 'req-1',
    audiobook: { id: 'a1', title: 'Book', author: 'Author' },
    torrent: {
      indexer: 'Indexer',
      indexerId: 1,
      title: 'Book - Author',
      size: 50 * 1024 * 1024,
      seeders: 10,
      publishDate: new Date(),
      downloadUrl: 'magnet:?xt=urn:btih:abc',
      guid: 'guid-1',
      format: 'M4B',
      protocol: 'torrent',
    },
    jobId: 'job-1',
  };

  const nzbPayload = {
    requestId: 'req-2',
    audiobook: { id: 'a2', title: 'Book2', author: 'Author2' },
    torrent: {
      indexer: 'UsenetIndexer',
      indexerId: 2,
      title: 'Book2 - Author2',
      size: 100 * 1024 * 1024,
      seeders: 0,
      publishDate: new Date(),
      downloadUrl: 'http://indexer.com/download/file.nzb',
      guid: 'guid-2',
      format: 'M4B',
      protocol: 'usenet',
    },
    jobId: 'job-2',
  };

  it('routes torrent downloads to qBittorrent', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      addDownload: vi.fn().mockResolvedValue('hash-1'),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      enabled: true,
      category: 'readmeabook',
    });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent(torrentPayload);

    expect(result.success).toBe(true);
    expect(downloadClientManagerMock.getClientServiceForProtocol).toHaveBeenCalledWith('torrent');
    expect(qbtClientMock.addDownload).toHaveBeenCalled();
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith(
      'req-1',
      'dh-1',
      'hash-1',
      'qbittorrent',
      3
    );
  });

  it('routes NZB downloads to SABnzbd', async () => {
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      addDownload: vi.fn().mockResolvedValue('nzb-1'),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-2',
      type: 'sabnzbd',
      enabled: true,
      category: 'readmeabook',
    });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-2' });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent(nzbPayload);

    expect(result.success).toBe(true);
    expect(downloadClientManagerMock.getClientServiceForProtocol).toHaveBeenCalledWith('usenet');
    expect(sabClientMock.addDownload).toHaveBeenCalled();
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith(
      'req-2',
      'dh-2',
      'nzb-1',
      'sabnzbd',
      3
    );
  });

  it('throws error when no client configured for protocol', async () => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(null);
    prismaMock.request.update.mockResolvedValue({});

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');

    await expect(processDownloadTorrent(torrentPayload)).rejects.toThrow(
      'No torrent download client configured'
    );

    expect(downloadClientManagerMock.getClientServiceForProtocol).toHaveBeenCalledWith('torrent');
  });

  it('detects protocol from result and routes appropriately', async () => {
    // Torrent result
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      addDownload: vi.fn().mockResolvedValue('hash-1'),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValueOnce(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValueOnce({
      id: 'client-1',
      type: 'qbittorrent',
      enabled: true,
      category: 'readmeabook',
    });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await processDownloadTorrent(torrentPayload);

    expect(downloadClientManagerMock.getClientServiceForProtocol).toHaveBeenCalledWith('torrent');

    // NZB result
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      addDownload: vi.fn().mockResolvedValue('nzb-1'),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValueOnce(sabClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValueOnce({
      id: 'client-2',
      type: 'sabnzbd',
      enabled: true,
      category: 'readmeabook',
    });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-2' });

    await processDownloadTorrent(nzbPayload);

    expect(downloadClientManagerMock.getClientServiceForProtocol).toHaveBeenCalledWith('usenet');
  });

  it('tries the next ranked release when an indexer grab returns 500', async () => {
    const fallbackTorrent = {
      ...torrentPayload.torrent,
      indexer: 'Healthy Indexer',
      indexerId: 2,
      title: 'Book - Author - Fallback',
      downloadUrl: 'https://prowlarr/2/download/fallback',
      guid: 'guid-fallback',
    };
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      addDownload: vi.fn()
        .mockRejectedValueOnce(new DownloadSourceError(
          'Grab failed: source returned HTTP 500',
          500,
          'https://prowlarr/1/download/limited'
        ))
        .mockResolvedValueOnce('fallback-hash'),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      enabled: true,
      category: 'readmeabook',
    });
    prismaMock.request.findUnique.mockResolvedValue({
      type: 'audiobook',
      user: { plexUsername: 'testuser' },
    });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-fallback' });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent({
      ...torrentPayload,
      torrent: {
        ...torrentPayload.torrent,
        downloadUrl: 'https://prowlarr/1/download/limited',
      },
      alternateTorrents: [fallbackTorrent],
    });

    expect(result.success).toBe(true);
    expect(result.torrent.title).toBe(fallbackTorrent.title);
    expect(qbtClientMock.addDownload).toHaveBeenNthCalledWith(
      1,
      'https://prowlarr/1/download/limited',
      expect.anything()
    );
    expect(qbtClientMock.addDownload).toHaveBeenNthCalledWith(
      2,
      fallbackTorrent.downloadUrl,
      expect.anything()
    );
    expect(prismaMock.downloadHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          indexerName: 'Healthy Indexer',
          torrentName: fallbackTorrent.title,
          downloadClientId: 'fallback-hash',
        }),
      })
    );
  });

  it('leaves the request retryable when every ranked grab is temporarily unavailable', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      addDownload: vi.fn().mockRejectedValue(new DownloadSourceError(
        'Grab failed: source returned HTTP 429',
        429,
        'https://prowlarr/1/download/limited'
      )),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      enabled: true,
      category: 'readmeabook',
    });
    prismaMock.request.findUnique.mockResolvedValue({
      type: 'audiobook',
      user: { plexUsername: 'testuser' },
    });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await expect(processDownloadTorrent({
      ...torrentPayload,
      torrent: {
        ...torrentPayload.torrent,
        downloadUrl: 'https://prowlarr/1/download/limited',
      },
    })).rejects.toThrow('Indexer returned HTTP 429');

    expect(prismaMock.request.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
    expect(prismaMock.downloadHistory.create).not.toHaveBeenCalled();
  });

  const setupQbit = (addDownload: ReturnType<typeof vi.fn>) => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue({ clientType: 'qbittorrent', protocol: 'torrent', addDownload });
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({ id: 'client-1', type: 'qbittorrent', enabled: true, category: 'readmeabook' });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
  };
  const second = { ...torrentPayload.torrent, title: 'Second', guid: 'guid-2', downloadUrl: 'magnet:?xt=urn:btih:def' };

  it('skips a release with a malformed magnet before trying any client', async () => {
    const addDownload = vi.fn().mockResolvedValue('hash-2');
    setupQbit(addDownload);

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent({
      ...torrentPayload,
      torrent: { ...torrentPayload.torrent, downloadUrl: 'magnet:?xt=urn:btih:abc\nhttp://x.example/y' },
      alternateTorrents: [second],
    } as any);

    expect(result.success).toBe(true);
    expect(addDownload).toHaveBeenCalledTimes(1);
    expect(addDownload.mock.calls[0][0]).toBe('magnet:?xt=urn:btih:def');
  });

  it('ignores null alternates instead of crashing', async () => {
    const addDownload = vi.fn().mockResolvedValue('hash-1');
    setupQbit(addDownload);

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent({ ...torrentPayload, alternateTorrents: [null, second] } as any);

    expect(result.success).toBe(true);
    expect(addDownload).toHaveBeenCalledTimes(1);
  });

  it('skips a release whose source is unusable and grabs the next one', async () => {
    const addDownload = vi.fn()
      .mockRejectedValueOnce(new UnusableDownloadSourceError('Invalid redirect location: magnet:'))
      .mockResolvedValueOnce('hash-2');
    setupQbit(addDownload);

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent({ ...torrentPayload, alternateTorrents: [second] } as any);

    expect(result.success).toBe(true);
    expect(addDownload).toHaveBeenCalledTimes(2);
  });

  it('keeps an earlier temporary failure retryable when the last release is unusable', async () => {
    const addDownload = vi.fn()
      .mockRejectedValueOnce(new DownloadSourceError('Grab failed: source returned HTTP 429', 429, 'https://prowlarr'))
      .mockRejectedValueOnce(new UnusableDownloadSourceError('Invalid redirect location: magnet:'));
    setupQbit(addDownload);

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await expect(processDownloadTorrent({ ...torrentPayload, alternateTorrents: [second] } as any))
      .rejects.toThrow('HTTP 429');

    expect(prismaMock.request.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
  });

  describe('cancelled or deleted requests', () => {
    const liveOnly = { id: 'req-1', deletedAt: null, status: { not: 'cancelled' } };

    it('adds nothing to the client when the request was cancelled before the job ran', async () => {
      // e.g. cancelled during the search, or between Bull retries
      prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
      // The shape main's plain update returned, so a run on main reaches the client call
      prismaMock.request.update.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
      const addDownload = vi.fn().mockResolvedValue('hash-1');
      setupQbit(addDownload);

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
      const result = await processDownloadTorrent(torrentPayload);

      expect(addDownload).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, requestId: 'req-1' });
      expect(prismaMock.request.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: liveOnly,
        data: expect.objectContaining({ status: 'downloading' }),
      }));
      expect(prismaMock.request.update).not.toHaveBeenCalled();
      expect(prismaMock.downloadHistory.create).not.toHaveBeenCalled();
      expect(jobQueueMock.addMonitorJob).not.toHaveBeenCalled();
    });

    it('leaves a cancel that lands during a permanent add failure in place', async () => {
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(null);
      // 'downloading' claim matches; the 'failed' write matches nothing (cancelled meanwhile)
      prismaMock.request.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
      await expect(processDownloadTorrent(torrentPayload)).rejects.toThrow('No torrent download client configured');

      expect(prismaMock.request.update).not.toHaveBeenCalled();
      expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
        where: liveOnly,
        data: expect.objectContaining({ status: 'failed' }),
      }));
      expect(prismaMock.request.update).not.toHaveBeenCalled();
    });
  });
});
