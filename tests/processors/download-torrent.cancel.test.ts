/**
 * Component: Download Torrent Processor Tests - a cancel that lands during the add (#228)
 * Documentation: documentation/backend/services/jobs.md
 *
 * Fails on main: the grab job checks for a cancel before the add only, so a cancel landing
 * between that check and the row's creation found no download to stop and the torrent ran on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getMany: vi.fn() }));
const jobQueueMock = createJobQueueMock();
const managerMock = vi.hoisted(() => ({ getClientForProtocol: vi.fn(), getClientServiceForProtocol: vi.fn() }));
const stepMock = vi.hoisted(() => ({ stopCancelledDownload: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/cancelled-download', () => stepMock);
vi.mock('@/lib/integrations/prowlarr.service', () => ({ ProwlarrService: { isNZBResult: vi.fn(() => false) } }));

const payload = {
  requestId: 'req-1',
  audiobook: { id: 'a1', title: 'Book', author: 'Author' },
  torrent: {
    indexer: 'Indexer', indexerId: 1, title: 'Book - Author', size: 1, seeders: 10, publishDate: new Date(),
    downloadUrl: 'magnet:?xt=urn:btih:abc', guid: 'guid-1', format: 'M4B', protocol: 'torrent',
  },
  jobId: 'job-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.request.updateMany.mockResolvedValue({ count: 1 }); // not cancelled before the add
  configMock.getMany.mockResolvedValue({ prowlarr_api_key: null });
  jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  managerMock.getClientServiceForProtocol.mockResolvedValue({
    clientType: 'qbittorrent', protocol: 'torrent', addDownload: vi.fn().mockResolvedValue({ id: 'hash-1', alreadyInClient: false }),
  });
  managerMock.getClientForProtocol.mockResolvedValue({ category: 'readmeabook' });
  prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
  stepMock.stopCancelledDownload.mockResolvedValue({ outcome: 'removed', detail: 'partial download' });
});

async function run() {
  const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
  return processDownloadTorrent(payload);
}

describe('processDownloadTorrent: cancel during the add', () => {
  it('a request cancelled after the row was created: the cancel step runs, no monitor, no grab notice', async () => {
    prismaMock.request.findUnique.mockImplementation(async (args: any) =>
      (args.select.status ? { status: 'cancelled', deletedAt: null } : { type: 'audiobook', user: { plexUsername: 'u' } }));

    const result = await run();

    expect(stepMock.stopCancelledDownload).toHaveBeenCalledWith('req-1');
    expect(result).toMatchObject({ success: true, download: 'removed' });
    expect(jobQueueMock.addMonitorJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
    // The row exists before the check
    expect(prismaMock.downloadHistory.create.mock.invocationCallOrder[0])
      .toBeLessThan(stepMock.stopCancelledDownload.mock.invocationCallOrder[0]);
  });

  it('a request still active: monitored as before', async () => {
    prismaMock.request.findUnique.mockImplementation(async (args: any) =>
      (args.select.status ? { status: 'downloading', deletedAt: null } : { type: 'audiobook', user: { plexUsername: 'u' } }));

    await run();

    expect(stepMock.stopCancelledDownload).not.toHaveBeenCalled();
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledTimes(1);
  });
});
