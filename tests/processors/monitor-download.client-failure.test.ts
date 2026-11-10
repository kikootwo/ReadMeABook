/**
 * Component: Monitor Download Processor Tests (next release after a client failure, #332)
 * Documentation: documentation/admin-features/release-blocklist.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const configMock = vi.hoisted(() => ({ getMany: vi.fn() }));
const managerMock = vi.hoisted(() => ({ getClientForProtocol: vi.fn(), getClientServiceForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');

const basePayload = {
  requestId: 'req-1',
  downloadHistoryId: 'dh-1',
  downloadClientId: 'hash-1',
  downloadClient: 'qbittorrent' as const,
  jobId: 'job-1',
};

const activeRequest = {
  id: 'req-1',
  status: 'downloading',
  deletedAt: null,
  audiobook: { id: 'book-1', title: 'Book', author: 'Author', audibleAsin: null },
  user: { plexUsername: 'user' },
};

const qbitReporting = (info: Record<string, unknown>) => ({
  clientType: 'qbittorrent',
  protocol: 'torrent',
  getDownload: vi.fn().mockResolvedValue({
    id: 'hash-1', name: 'Book', size: 100, bytesDownloaded: 40, progress: 0.4, status: 'downloading',
    downloadSpeed: 100, eta: 60, category: 'readmeabook', downloadPath: '/downloads/Book', ...info,
  }),
});

const monitorCallChains = () => jobQueueMock.addMonitorJob.mock.calls.map((call) => call[9]);
const failedWrites = () => prismaMock.request.updateMany.mock.calls.filter(([arg]) => arg.data.status === 'failed');

describe('processMonitorDownload carries the automatic chain count (#332)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    prismaMock.request.findUnique.mockResolvedValue(activeRequest);
    prismaMock.request.findFirst.mockResolvedValue(activeRequest);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'dh-1' });
    prismaMock.downloadHistory.findUnique.mockResolvedValue({
      id: 'dh-1', torrentName: 'Author - Book [MP3]', torrentHash: 'hash-1', nzbId: null, indexerName: 'Indexer', indexerId: 1,
    });
    prismaMock.blockedRelease.upsert.mockResolvedValue({ id: 'block-1', createdAt: new Date() });
    managerMock.getClientForProtocol.mockResolvedValue({ remotePathMappingEnabled: false });
  });

  it('the progress re-queue carries the count; a hand-picked download stays without one', async () => {
    managerMock.getClientServiceForProtocol.mockResolvedValue(qbitReporting({}));

    await processMonitorDownload({ ...basePayload, clientFailures: 1 });
    await processMonitorDownload(basePayload);

    expect(jobQueueMock.addMonitorJob.mock.calls[0]).toEqual(['req-1', 'dh-1', 'hash-1', 'qbittorrent', 10, 40, 0, undefined, undefined, { clientFailures: 1 }]);
    expect(jobQueueMock.addMonitorJob.mock.calls[1]).toEqual(['req-1', 'dh-1', 'hash-1', 'qbittorrent', 10, 40, 0]);
  });

  it('the save-path wait re-queue carries the count', async () => {
    managerMock.getClientServiceForProtocol.mockResolvedValue(qbitReporting({
      status: 'completed', progress: 1, savePath: '/downloads/done', downloadPath: '/downloads/incomplete/Book',
    }));

    await processMonitorDownload({ ...basePayload, clientFailures: 0 });

    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith('req-1', 'dh-1', 'hash-1', 'qbittorrent', 2, 100, 0, 1, undefined, { clientFailures: 0 });
  });

  it('the connection back-off re-queue carries the count', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), { code: 'ECONNREFUSED' });
    managerMock.getClientServiceForProtocol.mockResolvedValue({
      clientType: 'qbittorrent', protocol: 'torrent', getDownload: vi.fn().mockRejectedValue(refused),
    });

    await processMonitorDownload({ ...basePayload, clientFailures: 2, lastProgress: 30, stallCount: 1 });

    expect(monitorCallChains()).toEqual([{ clientFailures: 2 }]);
    expect(jobQueueMock.addMonitorJob.mock.calls[0][8]).toBe(1); // connectionFailureCount
  });

  it('a client failure of an automatic grab blocks the release and queues the next search', async () => {
    managerMock.getClientServiceForProtocol.mockResolvedValue(qbitReporting({ status: 'failed', errorMessage: 'qBittorrent reported an error' }));

    const result = await processMonitorDownload({ ...basePayload, clientFailures: 0 });

    expect(result).toMatchObject({ success: false, completed: true, message: 'Download failed, searching for another release' });
    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', { id: 'book-1', title: 'Book', author: 'Author', asin: undefined },
      { clientFailures: 1, jobId: 'next-release-dh-1' });
    expect(failedWrites()).toHaveLength(0);
  });

  it('an error after the next search is queued never reaches the generic failure path', async () => {
    managerMock.getClientServiceForProtocol.mockResolvedValue(qbitReporting({ status: 'failed', errorMessage: 'qBittorrent reported an error' }));
    // Reads: cancel guard, the rerun guard's status, search audiobook, then the notification lookup throws
    prismaMock.request.findUnique
      .mockResolvedValueOnce(activeRequest)
      .mockResolvedValueOnce(activeRequest)
      .mockResolvedValueOnce(activeRequest)
      .mockRejectedValueOnce(new Error('connection reset'));

    await expect(processMonitorDownload({ ...basePayload, clientFailures: 0 })).resolves.toMatchObject({ completed: true });

    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
    expect(failedWrites()).toHaveLength(0);
  });

  it.each([
    ['no client configured', () => managerMock.getClientServiceForProtocol.mockResolvedValue(null), 'No qbittorrent client configured'],
    ['client unreachable 30 times', () => managerMock.getClientServiceForProtocol.mockResolvedValue({
      clientType: 'qbittorrent', protocol: 'torrent',
      getDownload: vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), { code: 'ECONNREFUSED' })),
    }), 'ECONNREFUSED'],
  ])('%s: the request fails as before, nothing is blocked, no next search', async (_name, arrange, message) => {
    arrange();

    await expect(processMonitorDownload({ ...basePayload, clientFailures: 0, connectionFailureCount: 29 })).rejects.toThrow(message);

    expect(failedWrites()).toHaveLength(1);
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('a download removed by hand is still left to Bull retries: no write, no block, no next search', async () => {
    managerMock.getClientServiceForProtocol.mockResolvedValue({
      clientType: 'qbittorrent', protocol: 'torrent', getDownload: vi.fn().mockResolvedValue(null),
    });

    await expect(processMonitorDownload({ ...basePayload, clientFailures: 0 })).rejects.toThrow('not found');

    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });
});
