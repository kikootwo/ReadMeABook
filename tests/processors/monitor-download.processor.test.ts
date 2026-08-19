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

  // ---------------------------------------------------------------------------
  // TempPathEnabled relocation check (#209): the completion branch must treat a
  // download as relocated when downloadPath is equal-to/under savePath, comparing
  // separator-agnostically so Windows backslash paths organize immediately. When
  // the file is genuinely still in a temp dir outside savePath, the existing
  // wait/retry protection must be preserved byte-for-byte.
  // ---------------------------------------------------------------------------

  /** Build a `completed` torrent client mock with the given save/download paths. */
  const relocationClientMock = (savePath: string, downloadPath: string) => ({
    clientType: 'qbittorrent',
    protocol: 'torrent',
    getDownload: vi.fn().mockResolvedValue({
      id: 'hash-reloc',
      name: 'Book',
      size: 0,
      bytesDownloaded: 0,
      progress: 1.0,
      status: 'completed',
      downloadSpeed: 0,
      eta: 0,
      category: 'readmeabook',
      savePath,
      downloadPath,
    }),
  });

  /** Stub the deps the completion branch needs to reach addOrganizeJob. */
  const stubCompletionDeps = () => {
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-reloc',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      remotePathMappingEnabled: false,
    });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-reloc',
      audiobook: { id: 'a-reloc' },
      deletedAt: null,
    });
  };

  it('organizes immediately when a Windows backslash path is already relocated (#209)', async () => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      relocationClientMock('E:\\Torrents\\ReadMeABook', 'E:\\Torrents\\ReadMeABook\\Book.m4b')
    );
    stubCompletionDeps();

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-reloc',
      downloadHistoryId: 'dh-reloc',
      downloadClientId: 'hash-reloc',
      downloadClient: 'qbittorrent',
      jobId: 'job-reloc',
    });

    expect(result.completed).toBe(true);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalled();
    // Must NOT re-schedule a relocation wait.
    expect(jobQueueMock.addMonitorJob).not.toHaveBeenCalled();
  });

  it('preserves the wait/retry protection when a Windows file is still in a temp dir (#209)', async () => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      relocationClientMock('E:\\Torrents\\ReadMeABook', 'E:\\Torrents\\incomplete\\Book')
    );
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-reloc',
      downloadHistoryId: 'dh-reloc',
      downloadClientId: 'hash-reloc',
      downloadClient: 'qbittorrent',
      jobId: 'job-reloc',
    });

    // Exact existing behavior: completed:false + pathWaitCount:1, no organize.
    expect(result).toMatchObject({ success: true, completed: false, pathWaitCount: 1 });
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
    // Re-scheduled with the same delay/arg shape: first wait → delay 2, lastProgress 100,
    // stallCount 0, pathWaitCount 1.
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith(
      'req-reloc', 'dh-reloc', 'hash-reloc', 'qbittorrent', 2, 100, 0, 1
    );
  });

  it('treats trailing-separator save paths as relocated (#209)', async () => {
    // Backslash trailing form.
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      relocationClientMock('E:\\Torrents\\ReadMeABook\\', 'E:\\Torrents\\ReadMeABook\\Book.m4b')
    );
    stubCompletionDeps();

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    let result = await processMonitorDownload({
      requestId: 'req-reloc',
      downloadHistoryId: 'dh-reloc',
      downloadClientId: 'hash-reloc',
      downloadClient: 'qbittorrent',
      jobId: 'job-reloc',
    });
    expect(result.completed).toBe(true);
    expect(jobQueueMock.addMonitorJob).not.toHaveBeenCalled();

    // Forward-slash trailing form.
    vi.clearAllMocks();
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      relocationClientMock('/downloads/', '/downloads/Book.m4b')
    );
    stubCompletionDeps();

    result = await processMonitorDownload({
      requestId: 'req-reloc',
      downloadHistoryId: 'dh-reloc',
      downloadClientId: 'hash-reloc',
      downloadClient: 'qbittorrent',
      jobId: 'job-reloc',
    });
    expect(result.completed).toBe(true);
    expect(jobQueueMock.addMonitorJob).not.toHaveBeenCalled();
  });

  it('leaves forward-slash (Linux/Docker) relocation behavior unchanged (#209)', async () => {
    // Already-relocated forward-slash path organizes.
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      relocationClientMock('/downloads/readmeabook', '/downloads/readmeabook/Book')
    );
    stubCompletionDeps();

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    let result = await processMonitorDownload({
      requestId: 'req-reloc',
      downloadHistoryId: 'dh-reloc',
      downloadClientId: 'hash-reloc',
      downloadClient: 'qbittorrent',
      jobId: 'job-reloc',
    });
    expect(result.completed).toBe(true);
    expect(jobQueueMock.addMonitorJob).not.toHaveBeenCalled();

    // Forward-slash genuine temp path still waits (protection preserved).
    vi.clearAllMocks();
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      relocationClientMock('/downloads/readmeabook', '/downloads/incomplete/Book')
    );
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});

    result = await processMonitorDownload({
      requestId: 'req-reloc',
      downloadHistoryId: 'dh-reloc',
      downloadClientId: 'hash-reloc',
      downloadClient: 'qbittorrent',
      jobId: 'job-reloc',
    });
    expect(result).toMatchObject({ success: true, completed: false, pathWaitCount: 1 });
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith(
      'req-reloc', 'dh-reloc', 'hash-reloc', 'qbittorrent', 2, 100, 0, 1
    );
  });

  it('treats an exact-equal single-file path as relocated (#209)', async () => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      relocationClientMock('E:\\Torrents\\ReadMeABook\\Book.m4b', 'E:\\Torrents\\ReadMeABook\\Book.m4b')
    );
    stubCompletionDeps();

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-reloc',
      downloadHistoryId: 'dh-reloc',
      downloadClientId: 'hash-reloc',
      downloadClient: 'qbittorrent',
      jobId: 'job-reloc',
    });

    expect(result.completed).toBe(true);
    expect(jobQueueMock.addMonitorJob).not.toHaveBeenCalled();
  });

  it('does not match a sibling-prefix save path as relocated (#209)', async () => {
    // /downloads2 must NOT be treated as under /downloads — proves the `+ '/'` boundary.
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      relocationClientMock('/downloads', '/downloads2/Book')
    );
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload({
      requestId: 'req-reloc',
      downloadHistoryId: 'dh-reloc',
      downloadClientId: 'hash-reloc',
      downloadClient: 'qbittorrent',
      jobId: 'job-reloc',
    });

    expect(result).toMatchObject({ success: true, completed: false, pathWaitCount: 1 });
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith(
      'req-reloc', 'dh-reloc', 'hash-reloc', 'qbittorrent', 2, 100, 0, 1
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
});


