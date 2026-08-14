/**
 * Component: Download Torrent Processor Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

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

vi.mock('@/lib/services/blocklist.service', () => ({
  addAutoBlock: vi.fn(),
  isReleaseBlocked: vi.fn(),
}));

vi.mock('@/lib/utils/connection-errors', () => ({
  isTransientConnectionError: vi.fn(),
}));

describe('processDownloadTorrent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    prismaMock.request.update.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
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
    prismaMock.request.update.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
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

  it('handles error when no client configured for protocol', async () => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(null);
    prismaMock.request.update.mockResolvedValue({ type: 'other' });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'other' });
    const blocklistModule = await import('@/lib/services/blocklist.service');
    blocklistModule.addAutoBlock.mockResolvedValue({ blocked: { id: 'block-1' }, wasNew: true });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent(torrentPayload);

    // Should handle gracefully with continuation
    expect(result.success).toBe(false);
    expect(result.continuationTriggered).toBe(true);
    expect(blocklistModule.addAutoBlock).toHaveBeenCalled();
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
    prismaMock.request.update.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
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

  describe('Ebook fallback behavior', () => {
    let addAutoBlockMock: any;
    let isTransientConnectionErrorMock: any;

    beforeEach(async () => {
      // Import mocked functions
      const blocklistModule = await import('@/lib/services/blocklist.service');
      const connectionErrorsModule = await import('@/lib/utils/connection-errors');
      addAutoBlockMock = blocklistModule.addAutoBlock;
      isTransientConnectionErrorMock = connectionErrorsModule.isTransientConnectionError;

      // Reset mocks
      vi.clearAllMocks();
      configMock.getMany.mockResolvedValue({ prowlarr_api_key: null });
      jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
      isTransientConnectionErrorMock.mockReturnValue(false); // Non-transient error
      addAutoBlockMock.mockResolvedValue({ blocked: { id: 'block-1' }, wasNew: true });
    });

    const ebookTorrentPayload = {
      requestId: 'ebook-req-1',
      audiobook: { id: 'a1', title: 'Ebook Book', author: 'Ebook Author' },
      torrent: {
        indexer: 'MAM',
        indexerId: 10,
        title: 'Ebook Book - Ebook Author [EPUB]',
        size: 2 * 1024 * 1024, // 2MB
        seeders: 5,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:abc123',
        guid: 'guid-ebook-1',
        infoHash: 'abc123',
        format: 'epub',
        protocol: 'torrent',
      },
      jobId: 'job-ebook-1',
    };

    const ebookNzbPayload = {
      requestId: 'ebook-req-2',
      audiobook: { id: 'a2', title: 'Ebook Book2', author: 'Ebook Author2' },
      torrent: {
        indexer: 'UsenetIndexer',
        indexerId: 20,
        title: 'Ebook Book2 - Ebook Author2 [EPUB]',
        size: 3 * 1024 * 1024, // 3MB
        seeders: 0,
        publishDate: new Date(),
        downloadUrl: 'http://indexer.com/download/ebook.nzb',
        guid: 'guid-ebook-2',
        format: 'epub',
        protocol: 'usenet',
      },
      jobId: 'job-ebook-2',
    };

    it('permanent torrent handoff failure on ebook request: blocks release and requeues search', async () => {
      const qbtClientMock = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        addDownload: vi.fn().mockRejectedValue(new Error('500 Internal Server Error from Prowlarr')),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-1',
        type: 'qbittorrent',
        enabled: true,
        category: 'readmeabook',
      });
      prismaMock.request.update.mockImplementation(async (args: any) => {
        if (args.where.id === 'ebook-req-1' && args.data.status === 'downloading') {
          return { type: 'ebook', user: { plexUsername: 'testuser' } };
        }
        if (args.where.id === 'ebook-req-1' && args.data.status === 'awaiting_search') {
          return { id: 'ebook-req-1', status: 'awaiting_search' };
        }
        return {};
      });
      prismaMock.request.findUnique.mockResolvedValue({ type: 'ebook' });

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
      const result = await processDownloadTorrent(ebookTorrentPayload);

      // Should not throw - handled gracefully
      expect(result.success).toBe(false);
      expect(result.continuationTriggered).toBe(true);
      expect(result.blockedRelease).toBe('Ebook Book - Ebook Author [EPUB]');

      // Should blocklist the failed release
      expect(addAutoBlockMock).toHaveBeenCalledWith({
        requestId: 'ebook-req-1',
        releaseName: 'Ebook Book - Ebook Author [EPUB]',
        releaseHash: 'abc123',
        indexerName: 'MAM',
        indexerId: 10,
        source: 'download_fail',
        reason: 'Download client add failed: 500 Internal Server Error from Prowlarr',
        reasonDetail: '500 Internal Server Error from Prowlarr',
        jobId: 'job-ebook-1',
      });

      // Should update request status to awaiting_search (NOT failed)
      expect(prismaMock.request.update).toHaveBeenCalledWith({
        where: { id: 'ebook-req-1' },
        data: {
          status: 'awaiting_search',
          errorMessage: 'Failed to add Ebook Book - Ebook Author [EPUB] to download client, trying next candidate',
          updatedAt: expect.any(Date),
        },
      });

      // Should requeue ebook search with fallback flag
      expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
        'ebook-req-1',
        { id: 'a1', title: 'Ebook Book', author: 'Ebook Author' },
        'epub',
        { isFallback: true }
      );

      // Should NOT throw error (handled gracefully)
      expect(qbtClientMock.addDownload).toHaveBeenCalled();
    });

    it('permanent SAB add failure on ebook request: blocks release and requeues search', async () => {
      const sabClientMock = {
        clientType: 'sabnzbd',
        protocol: 'usenet',
        addDownload: vi.fn().mockRejectedValue(new Error('429 Too Many Requests')),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-2',
        type: 'sabnzbd',
        enabled: true,
        category: 'readmeabook',
      });
      prismaMock.request.update.mockImplementation(async (args: any) => {
        if (args.where.id === 'ebook-req-2' && args.data.status === 'downloading') {
          return { type: 'ebook', user: { plexUsername: 'testuser' } };
        }
        if (args.where.id === 'ebook-req-2' && args.data.status === 'awaiting_search') {
          return { id: 'ebook-req-2', status: 'awaiting_search' };
        }
        return {};
      });
      prismaMock.request.findUnique.mockResolvedValue({ type: 'ebook' });

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
      const result = await processDownloadTorrent(ebookNzbPayload);

      expect(result.success).toBe(false);
      expect(result.continuationTriggered).toBe(true);
      expect(result.blockedRelease).toBe('Ebook Book2 - Ebook Author2 [EPUB]');

      // Should blocklist the failed release (NZB has no infoHash)
      expect(addAutoBlockMock).toHaveBeenCalledWith({
        requestId: 'ebook-req-2',
        releaseName: 'Ebook Book2 - Ebook Author2 [EPUB]',
        releaseHash: undefined,
        indexerName: 'UsenetIndexer',
        indexerId: 20,
        source: 'download_fail',
        reason: 'Download client add failed: 429 Too Many Requests',
        reasonDetail: '429 Too Many Requests',
        jobId: 'job-ebook-2',
      });

      // Should requeue search with fallback
      expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
        'ebook-req-2',
        { id: 'a2', title: 'Ebook Book2', author: 'Ebook Author2' },
        'epub',
        { isFallback: true }
      );
    });

    it('transient client-unreachable error on ebook request: retries without blocklisting or requeue', async () => {
      isTransientConnectionErrorMock.mockReturnValue(true); // Transient error
      const qbtClientMock = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        addDownload: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-1',
        type: 'qbittorrent',
        enabled: true,
        category: 'readmeabook',
      });
      prismaMock.request.update.mockResolvedValue({ type: 'ebook', user: { plexUsername: 'testuser' } });

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');

      // Should throw for Bull retry
      await expect(processDownloadTorrent(ebookTorrentPayload)).rejects.toThrow('ECONNREFUSED');

      // Should NOT blocklist
      expect(addAutoBlockMock).not.toHaveBeenCalled();

      // Should NOT update request to awaiting_search
      expect(prismaMock.request.update).toHaveBeenCalledTimes(1); // Only the initial 'downloading' update
      expect(prismaMock.request.update).toHaveBeenCalledWith({
        where: { id: 'ebook-req-1' },
        data: {
          status: 'downloading',
          progress: 0,
          updatedAt: expect.any(Date),
        },
        include: { user: { select: { plexUsername: true } } },
      });

      // Should NOT requeue search
      expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    });

    it('audiobook requests also use ranked-hierarchy continuation on permanent error', async () => {
      const audiobookPayload = {
        requestId: 'ab-req-1',
        audiobook: { id: 'a3', title: 'Audiobook Book', author: 'Audiobook Author' },
        torrent: {
          indexer: 'Indexer',
          indexerId: 30,
          title: 'Audiobook Book - Audiobook Author [M4B]',
          size: 200 * 1024 * 1024, // 200MB
          seeders: 10,
          publishDate: new Date(),
          downloadUrl: 'magnet:?xt=urn:btih:def456',
          guid: 'guid-ab-1',
          infoHash: 'def456',
          format: 'M4B',
          protocol: 'torrent',
        },
        jobId: 'job-ab-1',
      };

      const qbtClientMock = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        addDownload: vi.fn().mockRejectedValue(new Error('500 Internal Server Error')),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-1',
        type: 'qbittorrent',
        enabled: true,
        category: 'readmeabook',
      });
      prismaMock.request.update.mockImplementation(async (args: any) => {
        if (args.where.id === 'ab-req-1' && args.data.status === 'downloading') {
          return { type: 'audiobook', user: { plexUsername: 'testuser' } };
        }
        if (args.where.id === 'ab-req-1' && args.data.status === 'awaiting_search') {
          return { id: 'ab-req-1', status: 'awaiting_search' };
        }
        return {};
      });
      prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook' });

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
      const result = await processDownloadTorrent(audiobookPayload);

      // Should not throw - handled gracefully
      expect(result.success).toBe(false);
      expect(result.continuationTriggered).toBe(true);
      expect(result.blockedRelease).toBe('Audiobook Book - Audiobook Author [M4B]');

      // Should blocklist the failed release
      expect(addAutoBlockMock).toHaveBeenCalledWith({
        requestId: 'ab-req-1',
        releaseName: 'Audiobook Book - Audiobook Author [M4B]',
        releaseHash: 'def456',
        indexerName: 'Indexer',
        indexerId: 30,
        source: 'download_fail',
        reason: 'Download client add failed: 500 Internal Server Error',
        reasonDetail: '500 Internal Server Error',
        jobId: 'job-ab-1',
      });

      // Should update request status to awaiting_search (NOT failed)
      expect(prismaMock.request.update).toHaveBeenCalledWith({
        where: { id: 'ab-req-1' },
        data: {
          status: 'awaiting_search',
          errorMessage: 'Failed to add Audiobook Book - Audiobook Author [M4B] to download client, trying next candidate',
          updatedAt: expect.any(Date),
        },
      });

      // Should requeue audiobook search
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith(
        'ab-req-1',
        { id: 'a3', title: 'Audiobook Book', author: 'Audiobook Author' }
      );
    });

    it('does NOT increment searchAttempts - search_ebook.processor already does this', async () => {
      const qbtClientMock = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        addDownload: vi.fn().mockRejectedValue(new Error('500 Error')),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-1',
        type: 'qbittorrent',
        enabled: true,
        category: 'readmeabook',
      });
      prismaMock.request.update.mockImplementation(async (args: any) => {
        if (args.where.id === 'ebook-req-1' && args.data.status === 'downloading') {
          return { type: 'ebook', user: { plexUsername: 'testuser' } };
        }
        if (args.where.id === 'ebook-req-1' && args.data.status === 'awaiting_search') {
          // Verify NO searchAttempts increment here
          expect(args.data.searchAttempts).toBeUndefined();
          return { id: 'ebook-req-1', status: 'awaiting_search' };
        }
        return {};
      });
      prismaMock.request.findUnique.mockResolvedValue({ type: 'ebook' });

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
      await processDownloadTorrent(ebookTorrentPayload);

      // Check that update was called without searchAttempts increment
      const awaitingSearchCall = prismaMock.request.update.mock.calls.find(
        (call: any) => call[0]?.data?.status === 'awaiting_search'
      );
      expect(awaitingSearchCall).toBeDefined();
      expect(awaitingSearchCall[0].data.searchAttempts).toBeUndefined();
    });
  });
});
