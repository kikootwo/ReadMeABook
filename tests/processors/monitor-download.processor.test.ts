/**
 * Component: Monitor Download Processor Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const qbtMock = vi.hoisted(() => ({
  getTorrent: vi.fn(),
  getDownloadProgress: vi.fn(),
}));
const sabMock = vi.hoisted(() => ({
  getNZB: vi.fn(),
}));
const configMock = vi.hoisted(() => ({
  getMany: vi.fn(),
}));
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
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

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

describe('processMonitorDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  it('queues organize job when qBittorrent download completes', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-1',
        name: 'Book',
        size: 0,
        bytesDownloaded: 0,
        progress: 1.0,
        status: 'completed',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        downloadPath: '/remote/done/Book',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: true,
      remotePath: '/remote/done',
      localPath: '/downloads',
    });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-1',
      audiobook: { id: 'a1' },
      deletedAt: null,
    });

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-1',
      downloadHistoryId: 'dh-1',
      downloadClientId: 'hash-1',
      downloadClient: 'qbittorrent',
      jobId: 'job-1',
    });

    expect(result.completed).toBe(true);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-1',
      'a1',
      expect.stringMatching(/downloads[\\/]+Book/)
    );
    // Verify downloadPath is stored in download history on completion
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          downloadStatus: 'completed',
          downloadPath: expect.stringMatching(/downloads[\\/]+Book/),
        }),
      })
    );
  });

  it('re-schedules monitoring when download is still active', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-2',
        name: 'Book',
        size: 0,
        bytesDownloaded: 0,
        progress: 0.45,
        status: 'downloading',
        downloadSpeed: 100,
        eta: 60,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-2',
      downloadHistoryId: 'dh-2',
      downloadClientId: 'hash-2',
      downloadClient: 'qbittorrent',
      jobId: 'job-2',
    });

    expect(result.completed).toBe(false);
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith(
      'req-2',
      'dh-2',
      'hash-2',
      'qbittorrent',
      10,
      45,  // progressPercent passed as lastProgress
      0,   // stallCount reset (download is actively progressing)
    );
  });

  it('marks request failed when download fails and auto-blocks the release', async () => {
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockResolvedValue({
        id: 'hash-3',
        name: 'Book',
        size: 0,
        bytesDownloaded: 0,
        progress: 0.20,
        status: 'failed',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-3',
      audiobook: { title: 'Book', author: 'Author' },
      user: { plexUsername: 'user' },
    });
    prismaMock.downloadHistory.findUnique.mockResolvedValue({
      id: 'dh-3',
      torrentName: 'Book - Author [M4B]',
      torrentHash: 'hash-3',
      nzbId: null,
      indexerName: 'TestIndexer',
      indexerId: 4,
    });
    prismaMock.blockedRelease.upsert.mockResolvedValue({
      id: 'block-3',
      releaseName: 'Book - Author [M4B]',
      releaseKey: 'book - author [m4b]',
      createdAt: new Date(),
    });

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-3',
      downloadHistoryId: 'dh-3',
      downloadClientId: 'hash-3',
      downloadClient: 'qbittorrent',
      jobId: 'job-3',
    });

    expect(result.success).toBe(false);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId_releaseKey: { requestId: 'req-3', releaseKey: 'book - author [m4b]' } },
        create: expect.objectContaining({
          requestId: 'req-3',
          releaseName: 'Book - Author [M4B]',
          releaseHash: 'hash-3',
          source: 'download_fail',
          downloadHistoryId: 'dh-3',
        }),
      })
    );
  });

  it('does not auto-block when permanent failure is from connection-exhaustion path', async () => {
    // Simulate the connection-failure-exhausted fallthrough: getDownload rejects
    // with a transient connection error AND prevConnectionFailureCount is already
    // at the cap, so the processor enters PATH 3 (permanent error) without the
    // client ever reporting `failed`. That path must NOT auto-block.
    const econn = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), {
      code: 'ECONNREFUSED',
    });
    const qbtClientMock = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      getDownload: vi.fn().mockRejectedValue(econn),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-conn',
      audiobook: { title: 'Book', author: 'Author' },
      user: { plexUsername: 'user' },
    });

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    await expect(processMonitorDownload({
      requestId: 'req-conn',
      downloadHistoryId: 'dh-conn',
      downloadClientId: 'hash-conn',
      downloadClient: 'qbittorrent',
      jobId: 'job-conn',
      // Already at the cap — next call enters PATH 3 (permanent), not the
      // self-rescheduling retry branch.
      connectionFailureCount: 30,
    })).rejects.toThrow();

    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
    // CRITICAL: connection exhaustion is transient infra, not a release problem.
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
  });

  it('handles SABnzbd completion and queues organize job', async () => {
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      getDownload: vi.fn().mockResolvedValue({
        id: 'nzb-1',
        name: 'Book',
        size: 100,
        bytesDownloaded: 100,
        progress: 1.0,
        status: 'completed',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        downloadPath: '/usenet/complete/Book',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-2',
      type: 'sabnzbd',
      name: 'SABnzbd',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-4',
      audiobook: { id: 'a4' },
      deletedAt: null,
    });

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-4',
      downloadHistoryId: 'dh-4',
      downloadClientId: 'nzb-1',
      downloadClient: 'sabnzbd',
      jobId: 'job-4',
    });

    expect(result.completed).toBe(true);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-4',
      'a4',
      '/usenet/complete/Book'
    );
    // Verify downloadPath is stored in download history on completion
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          downloadStatus: 'completed',
          downloadPath: '/usenet/complete/Book',
        }),
      })
    );
  });

  it('handles NZBGet completion and queues organize job', async () => {
    const nzbgetClientMock = {
      clientType: 'nzbget',
      protocol: 'usenet',
      getDownload: vi.fn().mockResolvedValue({
        id: '42',
        name: 'Book',
        size: 200,
        bytesDownloaded: 200,
        progress: 1.0,
        status: 'completed',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        downloadPath: '/downloads/readmeabook/Book',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(nzbgetClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-nzbget',
      type: 'nzbget',
      name: 'NZBGet',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-nzbget',
      audiobook: { id: 'a-nzbget' },
      deletedAt: null,
    });

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-nzbget',
      downloadHistoryId: 'dh-nzbget',
      downloadClientId: '42',
      downloadClient: 'nzbget',
      jobId: 'job-nzbget',
    });

    expect(result.completed).toBe(true);
    // Verify it called getClientServiceForProtocol with 'usenet' (not 'torrent')
    expect(downloadClientManagerMock.getClientServiceForProtocol).toHaveBeenCalledWith('usenet');
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-nzbget',
      'a-nzbget',
      '/downloads/readmeabook/Book'
    );
  });

  it('does not mark request failed for transient NZB not found errors', async () => {
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      getDownload: vi.fn().mockResolvedValue(null),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    await expect(processMonitorDownload({
      requestId: 'req-5',
      downloadHistoryId: 'dh-5',
      downloadClientId: 'nzb-missing',
      downloadClient: 'sabnzbd',
      jobId: 'job-5',
    })).rejects.toThrow(/not found/i);

    expect(prismaMock.request.update).not.toHaveBeenCalled();
  });

  it('marks request failed when download client is unsupported', async () => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(null);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-6',
      audiobook: { title: 'Book', author: 'Author' },
      user: { plexUsername: 'user' },
    });

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    await expect(processMonitorDownload({
      requestId: 'req-6',
      downloadHistoryId: 'dh-6',
      downloadClientId: 'id-6',
      downloadClient: 'rtorrent',
      jobId: 'job-6',
    })).rejects.toThrow(/Unknown download client type: rtorrent/);

    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('marks request failed when SABnzbd completion lacks a download path', async () => {
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      getDownload: vi.fn().mockResolvedValue({
        id: 'nzb-2',
        name: 'Book',
        size: 100,
        bytesDownloaded: 100,
        progress: 1.0,
        status: 'completed',
        downloadSpeed: 0,
        eta: 0,
        category: 'readmeabook',
        downloadPath: undefined,
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-2',
      type: 'sabnzbd',
      name: 'SABnzbd',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-7',
      audiobook: { title: 'Book', author: 'Author' },
      user: { plexUsername: 'user' },
    });

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    await expect(processMonitorDownload({
      requestId: 'req-7',
      downloadHistoryId: 'dh-7',
      downloadClientId: 'nzb-2',
      downloadClient: 'sabnzbd',
      jobId: 'job-7',
    })).rejects.toThrow(/Download path not available/i);

    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('converts SABnzbd progress from 0.0-1.0 to 0-100 percentage', async () => {
    const sabClientMock = {
      clientType: 'sabnzbd',
      protocol: 'usenet',
      getDownload: vi.fn().mockResolvedValue({
        id: 'nzb-3',
        name: 'Book',
        size: 1000000000,
        bytesDownloaded: 350000000,
        progress: 0.35,
        status: 'downloading',
        downloadSpeed: 5000000,
        eta: 130,
        category: 'readmeabook',
      }),
    };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-8',
      downloadHistoryId: 'dh-8',
      downloadClientId: 'nzb-3',
      downloadClient: 'sabnzbd',
      jobId: 'job-8',
    });

    expect(result.completed).toBe(false);
    expect(result.progress).toBe(35); // Should be converted to 35 (not 0.35)

    // Verify database was updated with correct percentage (0-100, not 0.0-1.0)
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-8' },
        data: expect.objectContaining({
          progress: 35, // Should be 35, not 0.35
        }),
      })
    );
  });

  describe('Ebook Fallback Continuation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
      jobQueueMock.addSearchEbookJob.mockResolvedValue('job-fallback');
    });

    it('continues to next ebook candidate on SABnzbd monitor-stage failure with blocklist', async () => {
      const sabClientMock = {
        clientType: 'sabnzbd',
        protocol: 'usenet',
        getDownload: vi.fn().mockResolvedValue({
          id: 'nzb-ebook',
          name: 'Book - Author.epub',
          size: 1000000,
          bytesDownloaded: 0,
          progress: 0,
          status: 'failed',
          downloadSpeed: 0,
          eta: 0,
          category: 'readmeabook',
          errorMessage: 'Download failed (par2)',
        }),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-ebook',
        type: 'ebook',
        audiobook: { id: 'ab-1', title: 'Test Book', author: 'Test Author', audibleAsin: 'B001ASIN' },
        user: { plexUsername: 'user' },
      });
      prismaMock.request.update.mockResolvedValue({});
      prismaMock.downloadHistory.update.mockResolvedValue({});
      prismaMock.downloadHistory.findUnique.mockResolvedValue({
        id: 'dh-ebook',
        torrentName: 'Book - Author.epub',
        nzbId: 'nzb-ebook',
        indexerName: 'TestIndexer',
        indexerId: 1,
      });
      prismaMock.blockedRelease.upsert.mockResolvedValue({ id: 'block-1' });

      const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
      const result = await processMonitorDownload({
        requestId: 'req-ebook',
        downloadHistoryId: 'dh-ebook',
        downloadClientId: 'nzb-ebook',
        downloadClient: 'sabnzbd',
        jobId: 'job-ebook',
      });

      // Should blocklist the failed release
      expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            requestId: 'req-ebook',
            releaseName: 'Book - Author.epub',
            releaseHash: 'nzb-ebook',
            source: 'download_fail',
            reason: 'Download failed (par2)',
            downloadHistoryId: 'dh-ebook',
          }),
        })
      );

      // Should update progress first (always happens on every poll)
      expect(prismaMock.request.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'req-ebook' },
        data: {
          progress: 0,
          updatedAt: expect.any(Date),
        },
      });

      // Then update status to failed (default behavior)
      expect(prismaMock.request.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'req-ebook' },
        data: {
          status: 'failed',
          errorMessage: 'Download failed in sabnzbd',
          updatedAt: expect.any(Date),
        },
      });

      // Then transition from failed to searching for fallback
      expect(prismaMock.request.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'req-ebook' },
        data: {
          status: 'searching',
          errorMessage: 'Retrying next candidate after: Download failed in sabnzbd',
          updatedAt: expect.any(Date),
        },
      });

      // Should requeue search_ebook with isFallback=true
      expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
        'req-ebook',
        {
          id: 'ab-1',
          title: 'Test Book',
          author: 'Test Author',
          asin: 'B001ASIN',
        },
        undefined,
        { isFallback: true }
      );

      // Should NOT send failure notification
      expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();

      expect(result.continued).toBe(true);
      expect(result.message).toBe('ebook download failed, searching next candidate');
    });

    it('continues to next ebook candidate on qBittorrent monitor-stage failure with blocklist', async () => {
      const qbtClientMock = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        getDownload: vi.fn().mockResolvedValue({
          id: 'hash-ebook',
          name: 'Book - Author.epub',
          size: 1000000,
          bytesDownloaded: 0,
          progress: 0.2,
          status: 'failed',
          downloadSpeed: 0,
          eta: 0,
          category: 'readmeabook',
          errorMessage: 'Download failed (missing files)',
        }),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-ebook-torrent',
        type: 'ebook',
        audiobook: { id: 'ab-2', title: 'Another Book', author: 'Another Author', audibleAsin: 'B002ASIN' },
        user: { plexUsername: 'user' },
      });
      prismaMock.request.update.mockResolvedValue({});
      prismaMock.downloadHistory.update.mockResolvedValue({});
      prismaMock.downloadHistory.findUnique.mockResolvedValue({
        id: 'dh-ebook-torrent',
        torrentName: 'Book - Author.epub',
        torrentHash: 'hash-ebook',
        indexerName: 'TorrentIndexer',
        indexerId: 2,
      });
      prismaMock.blockedRelease.upsert.mockResolvedValue({ id: 'block-2' });

      const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
      const result = await processMonitorDownload({
        requestId: 'req-ebook-torrent',
        downloadHistoryId: 'dh-ebook-torrent',
        downloadClientId: 'hash-ebook',
        downloadClient: 'qbittorrent',
        jobId: 'job-ebook-torrent',
      });

      // Should blocklist the failed release
      expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            requestId: 'req-ebook-torrent',
            releaseName: 'Book - Author.epub',
            releaseHash: 'hash-ebook',
            source: 'download_fail',
            reason: 'Download failed (missing files)',
            downloadHistoryId: 'dh-ebook-torrent',
          }),
        })
      );

      // Should requeue search_ebook with isFallback=true
      expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
        'req-ebook-torrent',
        {
          id: 'ab-2',
          title: 'Another Book',
          author: 'Another Author',
          asin: 'B002ASIN',
        },
        undefined,
        { isFallback: true }
      );

      expect(result.continued).toBe(true);
    });

    it('does NOT continue on transient monitor states (downloading, paused, queued, checking)', async () => {
      const qbtClientMock = {
        clientType: 'qbittorrent',
        protocol: 'torrent',
        getDownload: vi.fn().mockResolvedValue({
          id: 'hash-transient',
          name: 'Book',
          size: 1000000,
          bytesDownloaded: 500000,
          progress: 0.5,
          status: 'paused', // Transient state
          downloadSpeed: 0,
          eta: 60,
          category: 'readmeabook',
        }),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(qbtClientMock);

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-ebook-transient',
        type: 'ebook',
        audiobook: { id: 'ab-3', title: 'Book', author: 'Author' },
        user: { plexUsername: 'user' },
      });
      prismaMock.request.update.mockResolvedValue({});
      prismaMock.downloadHistory.update.mockResolvedValue({});

      const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
      const result = await processMonitorDownload({
        requestId: 'req-ebook-transient',
        downloadHistoryId: 'dh-transient',
        downloadClientId: 'hash-transient',
        downloadClient: 'qbittorrent',
        jobId: 'job-transient',
      });

      // Should NOT blocklist
      expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();

      // Should NOT requeue search
      expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();

      // Should NOT send failure notification
      expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();

      expect(result.completed).toBe(false); // Still in progress
    });

    it('continues to next audiobook candidate on monitor-stage failure with blocklist', async () => {
      const sabClientMock = {
        clientType: 'sabnzbd',
        protocol: 'usenet',
        getDownload: vi.fn().mockResolvedValue({
          id: 'nzb-audiobook',
          name: 'Book - Author.m4b',
          size: 100000000,
          bytesDownloaded: 0,
          progress: 0,
          status: 'failed',
          downloadSpeed: 0,
          eta: 0,
          category: 'readmeabook',
          errorMessage: 'Download failed',
        }),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-audiobook',
        type: 'audiobook', // NOT ebook
        audiobook: { id: 'ab-4', title: 'Book', author: 'Author' },
        user: { plexUsername: 'user' },
      });
      prismaMock.request.update.mockResolvedValue({});
      prismaMock.downloadHistory.update.mockResolvedValue({});
      prismaMock.downloadHistory.findUnique.mockResolvedValue({
        id: 'dh-audiobook',
        torrentName: 'Book - Author.m4b',
        nzbId: 'nzb-audiobook',
        indexerName: 'TestIndexer',
        indexerId: 1,
      });
      prismaMock.blockedRelease.upsert.mockResolvedValue({ id: 'block-4' });

      const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
      const result = await processMonitorDownload({
        requestId: 'req-audiobook',
        downloadHistoryId: 'dh-audiobook',
        downloadClientId: 'nzb-audiobook',
        downloadClient: 'sabnzbd',
        jobId: 'job-audiobook',
      });

      // Should blocklist
      expect(prismaMock.blockedRelease.upsert).toHaveBeenCalled();

      // Should requeue search (audiobooks now DO continue)
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith(
        'req-audiobook',
        {
          id: 'ab-4',
          title: 'Book',
          author: 'Author',
        }
      );

      // Should NOT send failure notification
      expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();

      expect(result.continued).toBe(true);
    });

    it('handles ebook fallback when audiobook data is missing', async () => {
      const sabClientMock = {
        clientType: 'sabnzbd',
        protocol: 'usenet',
        getDownload: vi.fn().mockResolvedValue({
          id: 'nzb-missing',
          name: 'Book.epub',
          size: 1000000,
          bytesDownloaded: 0,
          progress: 0,
          status: 'failed',
          downloadSpeed: 0,
          eta: 0,
          category: 'readmeabook',
        }),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-missing-audiobook',
        type: 'ebook',
        audiobook: null, // Missing audiobook data
        user: { plexUsername: 'user' },
      });
      prismaMock.request.update.mockResolvedValue({});
      prismaMock.downloadHistory.update.mockResolvedValue({});
      prismaMock.downloadHistory.findUnique.mockResolvedValue({
        id: 'dh-missing',
        torrentName: 'Book.epub',
        nzbId: 'nzb-missing',
      });

      const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
      const result = await processMonitorDownload({
        requestId: 'req-missing-audiobook',
        downloadHistoryId: 'dh-missing',
        downloadClientId: 'nzb-missing',
        downloadClient: 'sabnzbd',
        jobId: 'job-missing',
      });

      // Should NOT requeue search (no audiobook data)
      expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();

      // Should NOT send notification (no audiobook data)
      expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();

      // Should stay failed
      expect(result.continued).toBeUndefined();
      expect(result.message).toBe('Download failed');
    });

    it('exhausts and stays failed when all candidates are blocklisted (handled by search-ebook)', async () => {
      // This test verifies the exhaustion scenario is handled by search-ebook.processor
      // When filterBlockedResults returns zero results, search-ebook sets status to awaiting_search
      // So this monitor test only needs to verify the requeue happens correctly
      const sabClientMock = {
        clientType: 'sabnzbd',
        protocol: 'usenet',
        getDownload: vi.fn().mockResolvedValue({
          id: 'nzb-exhaust',
          name: 'Book - Author.epub',
          size: 1000000,
          bytesDownloaded: 0,
          progress: 0,
          status: 'failed',
          downloadSpeed: 0,
          eta: 0,
          category: 'readmeabook',
        }),
      };
      downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sabClientMock);

      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-exhaust',
        type: 'ebook',
        audiobook: { id: 'ab-5', title: 'Book', author: 'Author', audibleAsin: 'B005ASIN' },
        user: { plexUsername: 'user' },
      });
      prismaMock.request.update.mockResolvedValue({});
      prismaMock.downloadHistory.update.mockResolvedValue({});
      prismaMock.downloadHistory.findUnique.mockResolvedValue({
        id: 'dh-exhaust',
        torrentName: 'Book - Author.epub',
        nzbId: 'nzb-exhaust',
        indexerName: 'Indexer',
        indexerId: 1,
      });
      prismaMock.blockedRelease.upsert.mockResolvedValue({ id: 'block-5' });

      const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
      const result = await processMonitorDownload({
        requestId: 'req-exhaust',
        downloadHistoryId: 'dh-exhaust',
        downloadClientId: 'nzb-exhaust',
        downloadClient: 'sabnzbd',
        jobId: 'job-exhaust',
      });

      // Should requeue search (exhaustion handled downstream)
      expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
        'req-exhaust',
        expect.objectContaining({
          id: 'ab-5',
          title: 'Book',
          author: 'Author',
          asin: 'B005ASIN',
        }),
        undefined,
        { isFallback: true }
      );

      expect(result.continued).toBe(true);
    });
  });
});


