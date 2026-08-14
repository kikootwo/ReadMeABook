/**
 * Component: Ranked Continuation Tests (Audiobooks)
 * Documentation: documentation/phase3/README.md
 *
 * Tests for ranked-hierarchy continuation after permanent download failures.
 * Verifies that audiobooks (like ebooks) continue through ranked candidates.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  request: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  downloadHistory: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  jobEvent: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addDownloadJob: vi.fn(),
  addMonitorJob: vi.fn(),
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  getMany: vi.fn().mockResolvedValue({}),
  getAudibleRegion: vi.fn(),
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

const downloadClientManagerMock = vi.hoisted(() => ({
  getClientServiceForProtocol: vi.fn(),
  getClientForProtocol: vi.fn(),
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

const blocklistMock = vi.hoisted(() => ({
  addAutoBlock: vi.fn(),
}));

vi.mock('@/lib/services/blocklist.service', () => blocklistMock);

vi.mock('@/lib/utils/connection-errors', () => ({
  isTransientConnectionError: vi.fn(),
}));

describe('Ranked Continuation: Audiobooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.get.mockResolvedValue('true');
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    prismaMock.jobEvent.create.mockResolvedValue({});
  });

  describe('download-torrent.processor: permanent failure continuation', () => {
    it('blocklists failed release and requeues search_indexers for audiobooks', async () => {
      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');

      const mockClient = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        addDownload: vi.fn().mockRejectedValue(new Error('Download client rejected torrent')),
      };

      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(mockClient);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        category: 'audiobooks',
      });

      prismaMock.request.update.mockResolvedValueOnce({
        status: 'downloading',
        progress: 0,
        updatedAt: new Date(),
        user: { plexUsername: 'testuser' },
      });

      prismaMock.request.findUnique.mockResolvedValue({
        type: 'audiobook',
      });

      prismaMock.request.update.mockResolvedValueOnce({
        status: 'awaiting_search',
        errorMessage: 'Failed to add Test Torrent to download client, trying next candidate',
        updatedAt: new Date(),
      });

      const result = await processDownloadTorrent({
        requestId: 'req-1',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author' },
        torrent: {
          title: 'Test Torrent',
          size: 100 * 1024 * 1024,
          seeders: 5,
          format: 'm4b',
          indexer: 'TestIndexer',
          indexerId: 123,
          downloadUrl: 'magnet:?xt=urn:btih:test',
          infoHash: 'abc123',
          infoUrl: 'https://example.com/torrent/123',
        },
        jobId: 'job-1',
      });

      expect(result.success).toBe(false);
      expect(result.continuationTriggered).toBe(true);
      expect(result.blockedRelease).toBe('Test Torrent');

      // Should requeue search_indexers for audiobook
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', {
        id: 'ab-1',
        title: 'Test Book',
        author: 'Test Author',
      });
    });

    it('does NOT requeue for transient connection errors (audiobooks)', async () => {
      configServiceMock.getMany.mockResolvedValue({ prowlarr_api_key: null });
      
      const isTransientMock = (await import('@/lib/utils/connection-errors')).isTransientConnectionError;
      isTransientMock.mockReturnValue(true);

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');

      const mockClient = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        addDownload: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };

      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(mockClient);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        category: 'audiobooks',
      });

      prismaMock.request.update.mockResolvedValue({
        status: 'downloading',
        progress: 0,
        updatedAt: new Date(),
        user: { plexUsername: 'testuser' },
      });

      // Should throw for Bull retry on transient errors
      await expect(
        processDownloadTorrent({
          requestId: 'req-1',
          audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author' },
          torrent: {
            title: 'Test Torrent',
            size: 100 * 1024 * 1024,
            seeders: 5,
            format: 'm4b',
            indexer: 'TestIndexer',
            indexerId: 123,
            downloadUrl: 'magnet:?xt=urn:btih:test',
            infoHash: 'abc123',
            infoUrl: 'https://example.com/torrent/123',
          },
          jobId: 'job-1',
        })
      ).rejects.toThrow('ECONNREFUSED');

      // Should NOT requeue for transient errors
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
      expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    });
  });

  describe('monitor-download.processor: permanent failure continuation', () => {
    it('requeues search_indexers after permanent download failure for audiobooks', async () => {
      const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');

      const mockClient = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        getDownload: vi.fn().mockResolvedValue({
          progress: 0.5,
          status: 'failed',
          errorMessage: 'Download failed: missing files',
          downloadSpeed: 0,
          eta: 0,
        }),
      };

      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(mockClient);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        category: 'audiobooks',
        remotePathMappingEnabled: false,
      });

      prismaMock.request.update.mockResolvedValueOnce({
        status: 'failed',
        errorMessage: 'Download failed in qbittorrent',
        updatedAt: new Date(),
      });

      prismaMock.request.update.mockResolvedValueOnce({
        status: 'searching',
        errorMessage: 'Retrying next candidate after: Download failed in qbittorrent',
        updatedAt: new Date(),
      });

      prismaMock.downloadHistory.update.mockResolvedValueOnce({
        downloadStatus: 'failed',
        downloadError: 'Download failed in qbittorrent',
      });

      prismaMock.downloadHistory.findUnique.mockResolvedValue({
        torrentName: 'Failed Torrent',
        torrentHash: 'hash123',
        indexerName: 'TestIndexer',
        indexerId: 123,
      });

      prismaMock.request.findUnique.mockResolvedValue({
        type: 'audiobook',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author' },
        user: { plexUsername: 'testuser' },
      });

      const result = await processMonitorDownload({
        requestId: 'req-1',
        downloadHistoryId: 'dh-1',
        downloadClientId: 'dc-1',
        downloadClient: 'qbittorrent',
        jobId: 'job-1',
      });

      expect(result.continued).toBe(true);
      expect(result.message).toContain('audiobook download failed, searching next candidate');

      // Should requeue search_indexers for audiobook
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', {
        id: 'ab-1',
        title: 'Test Book',
        author: 'Test Author',
      });
    });

    it('does NOT continue on transient connection errors (audiobooks)', async () => {
      const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');

      const mockClient = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        getDownload: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };

      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(mockClient);
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        category: 'audiobooks',
        remotePathMappingEnabled: false,
      });

      prismaMock.request.update.mockResolvedValue({
        status: 'failed',
        errorMessage: 'Download client unreachable',
        updatedAt: new Date(),
      });

      await expect(
        processMonitorDownload({
          requestId: 'req-1',
          downloadHistoryId: 'dh-1',
          downloadClientId: 'dc-1',
          downloadClient: 'qbittorrent',
          jobId: 'job-1',
          prevConnectionFailures: 30, // Exceeded MAX_CONNECTION_FAILURES
        })
      ).rejects.toThrow();

      // Should NOT requeue for connection failures
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    });
  });
});