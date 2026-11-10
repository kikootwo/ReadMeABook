/**
 * Component: Monitor Download Processor Tests (cancelled / deleted requests)
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
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

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

const payload = {
  requestId: 'req-1',
  downloadHistoryId: 'dh-1',
  downloadClientId: 'hash-1',
  downloadClient: 'transmission',
  jobId: 'job-1',
};

const activeRequest = {
  id: 'req-1',
  status: 'downloading',
  deletedAt: null,
  audiobook: { id: 'book-1', title: 'Book', author: 'Author' },
  user: { plexUsername: 'user' },
};

/** A Transmission client whose torrent reports the given unified status. */
const clientReporting = (status: 'completed' | 'failed', errorMessage?: string) => ({
  clientType: 'transmission',
  protocol: 'torrent',
  getDownload: vi.fn().mockResolvedValue({
    id: 'hash-1',
    name: 'Book',
    size: 100,
    bytesDownloaded: status === 'completed' ? 100 : 40,
    progress: status === 'completed' ? 1 : 0.4,
    status,
    downloadSpeed: 0,
    eta: 0,
    category: 'readmeabook',
    downloadPath: '/downloads/Book',
    errorMessage,
  }),
});

const stubFailedRelease = () => {
  prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'dh-1' }); // the request's current download
  prismaMock.downloadHistory.findUnique.mockResolvedValue({
    id: 'dh-1',
    torrentName: 'Book - Author [M4B]',
    torrentHash: 'hash-1',
    nzbId: null,
    indexerName: 'TestIndexer',
    indexerId: 4,
  });
  prismaMock.blockedRelease.upsert.mockResolvedValue({
    id: 'block-1',
    releaseName: 'Book - Author [M4B]',
    releaseKey: 'book - author [m4b]',
    createdAt: new Date(),
  });
};

const expectNoFailedWrite = () => {
  expect(prismaMock.request.update).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
  );
};

describe('processMonitorDownload with a cancelled or deleted request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    prismaMock.request.findUnique.mockResolvedValue(activeRequest);
    prismaMock.request.findFirst.mockResolvedValue(activeRequest);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.downloadHistory.update.mockResolvedValue({});
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'transmission',
      name: 'Transmission',
      enabled: true,
      remotePathMappingEnabled: false,
    });
  });

  it.each([
    ['cancelled', { status: 'cancelled', deletedAt: null }],
    ['deleted', { status: 'downloading', deletedAt: new Date() }],
    ['missing', null],
  ])('stops monitoring a %s request: no client call, no write, no re-queue', async (reason, row) => {
    prismaMock.request.findUnique.mockResolvedValue(row);
    const client = clientReporting('completed');
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(client);

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload(payload);

    expect(result).toMatchObject({ success: true, completed: true });
    expect(result.message).toContain(reason);
    expect(client.getDownload).not.toHaveBeenCalled();
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.updateMany).not.toHaveBeenCalled();
    expect(jobQueueMock.addMonitorJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('does not import a download that finishes after the request was cancelled', async () => {
    // Active at the start of this poll, cancelled by the time the download finished
    prismaMock.request.findUnique
      .mockResolvedValueOnce(activeRequest)
      .mockResolvedValueOnce({ ...activeRequest, status: 'cancelled' });
    prismaMock.request.findFirst.mockResolvedValue({ ...activeRequest, status: 'cancelled' });
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(clientReporting('completed'));

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload(payload);

    expect(result).toMatchObject({ success: true, completed: true });
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('leaves a cancel that lands during a client-reported failure in place', async () => {
    // The conditional write matches no row: the request was cancelled meanwhile
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    stubFailedRelease();
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      clientReporting('failed', 'No space left on device')
    );

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload(payload);

    expect(result).toMatchObject({ success: true, completed: true });
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req-1', deletedAt: null, status: { not: 'cancelled' } } })
    );
    expectNoFailedWrite();
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });

  it('leaves a cancel that lands during a permanent monitor error in place', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(null);

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload(payload);

    expect(result).toMatchObject({ success: true, completed: true });
    expectNoFailedWrite();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });

  it('still marks an active request failed and auto-blocks a local Transmission error', async () => {
    stubFailedRelease();
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      clientReporting('failed', 'File name too long')
    );

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    const result = await processMonitorDownload(payload);

    expect(result.success).toBe(false);
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({
      where: { id: 'dh-1' },
      data: { downloadStatus: 'failed', downloadError: 'Download failed in Transmission' },
    });
    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ source: 'download_fail', reasonDetail: 'File name too long' }),
      })
    );
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_error', 'req-1', 'Book', 'Author', 'user', 'Download failed in Transmission'
    );
  });

  it('marks an active request failed without blocking when the disk is full (#332)', async () => {
    stubFailedRelease();
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(
      clientReporting('failed', 'No space left on device')
    );

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    await processMonitorDownload(payload);

    expect(prismaMock.request.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_error', 'req-1', 'Book', 'Author', 'user', expect.stringContaining('not the release')
    );
  });

  it('still marks an active request failed and notifies on a permanent monitor error', async () => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(null);

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    await expect(processMonitorDownload(payload)).rejects.toThrow('No transmission client configured');

    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', deletedAt: null, status: { not: 'cancelled' } },
      data: expect.objectContaining({ status: 'failed', errorMessage: 'No transmission client configured' }),
    });
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_error', 'req-1', 'Book', 'Author', 'user', 'No transmission client configured'
    );
  });
});

describe('processMonitorDownload never overwrites a row recorded as removed (#228)', () => {
  const NOT_REMOVED = { OR: [{ downloadStatus: null }, { downloadStatus: { not: 'removed' } }] };

  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    prismaMock.request.findUnique.mockResolvedValue(activeRequest);
    prismaMock.request.findFirst.mockResolvedValue(activeRequest);
    prismaMock.request.update.mockResolvedValue({});
    // A cancel recorded the row removed while this poll was in flight: the conditional writes match nothing
    prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 0 });
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1', type: 'transmission', name: 'Transmission', enabled: true, remotePathMappingEnabled: false,
    });
  });

  it('the per-poll status write and the completion write both skip a removed row (NULL statuses still written)', async () => {
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(clientReporting('completed'));

    const { processMonitorDownload } = await import('@/lib/processors/monitor-download.processor');
    await processMonitorDownload(payload);

    const writes = prismaMock.downloadHistory.updateMany.mock.calls.map(([args]: any[]) => args);
    expect(writes.map((w: any) => w.data.downloadStatus)).toEqual(['completed', 'completed']);
    for (const write of writes) {
      expect(write.where).toEqual({ id: 'dh-1', ...NOT_REMOVED });
    }
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ downloadStatus: expect.stringMatching(/^(downloading|completed|seeding)$/) }) })
    );
  });
});
