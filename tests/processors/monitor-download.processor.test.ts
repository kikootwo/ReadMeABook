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

  it('marks request failed when download fails', async () => {
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
      downloadClient: 'deluge',
      jobId: 'job-6',
    })).rejects.toThrow(/Unknown download client type: deluge/);

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
});


