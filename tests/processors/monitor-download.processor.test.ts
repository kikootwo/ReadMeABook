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
  });

  it('queues organize job when qBittorrent download completes', async () => {
    qbtMock.getTorrent.mockResolvedValue({
      content_path: '/remote/done/Book',
      save_path: '/remote/done',
      name: 'Book',
    });
    qbtMock.getDownloadProgress.mockReturnValue({
      percent: 100,
      state: 'completed',
      speed: 0,
      eta: 0,
    });
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
  });

  it('re-schedules monitoring when download is still active', async () => {
    qbtMock.getTorrent.mockResolvedValue({
      save_path: '/downloads',
      name: 'Book',
    });
    qbtMock.getDownloadProgress.mockReturnValue({
      percent: 45,
      state: 'downloading',
      speed: 100,
      eta: 60,
    });
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
      10
    );
  });

  it('marks request failed when download fails', async () => {
    qbtMock.getTorrent.mockResolvedValue({
      save_path: '/downloads',
      name: 'Book',
    });
    qbtMock.getDownloadProgress.mockReturnValue({
      percent: 20,
      state: 'failed',
      speed: 0,
      eta: 0,
    });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});

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
    sabMock.getNZB.mockResolvedValue({
      nzbId: 'nzb-1',
      size: 100,
      progress: 1,
      status: 'completed',
      downloadSpeed: 0,
      timeLeft: 0,
      downloadPath: '/usenet/complete/Book',
    });
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
  });

  it('does not mark request failed for transient NZB not found errors', async () => {
    sabMock.getNZB.mockResolvedValue(null);

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
    prismaMock.request.update.mockResolvedValue({});

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    await expect(processMonitorDownload({
      requestId: 'req-6',
      downloadHistoryId: 'dh-6',
      downloadClientId: 'id-6',
      downloadClient: 'deluge',
      jobId: 'job-6',
    })).rejects.toThrow(/not supported/i);

    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('marks request failed when SABnzbd completion lacks a download path', async () => {
    sabMock.getNZB.mockResolvedValue({
      nzbId: 'nzb-2',
      size: 100,
      progress: 1,
      status: 'completed',
      downloadSpeed: 0,
      timeLeft: 0,
      downloadPath: undefined,
    });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});

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
    sabMock.getNZB.mockResolvedValue({
      nzbId: 'nzb-3',
      size: 1000000000, // 1GB
      progress: 0.35, // 35% in decimal format (0.0-1.0)
      status: 'downloading',
      downloadSpeed: 5000000, // 5MB/s
      timeLeft: 130,
    });
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


