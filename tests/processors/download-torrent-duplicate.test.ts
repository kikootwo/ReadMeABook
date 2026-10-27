/**
 * Component: Download Torrent Processor Tests (duplicate NZB and retried add, #329)
 * Documentation: documentation/phase3/sabnzbd.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';
import { UnusableDownloadSourceError } from '@/lib/interfaces/download-client.interface';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({
  get: vi.fn(),
  getMany: vi.fn().mockResolvedValue({ prowlarr_api_key: null }),
}));
const jobQueueMock = createJobQueueMock();
const blocklistMock = vi.hoisted(() => ({ addAutoBlock: vi.fn() }));
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/blocklist.service', () => blocklistMock);
vi.mock('@/lib/integrations/prowlarr.service', () => ({
  ProwlarrService: { isNZBResult: vi.fn(() => true) },
}));

const release = (n: number) => ({
  indexer: `Indexer ${n}`,
  indexerId: n,
  title: `Book - Author - Release ${n}`,
  size: 100 * 1024 * 1024,
  seeders: 0,
  publishDate: new Date(),
  downloadUrl: `http://indexer.example/get/release-${n}.nzb`,
  guid: `guid-${n}`,
  format: 'M4B',
  protocol: 'usenet',
});

const payload = {
  requestId: 'req-329',
  audiobook: { id: 'book-1', title: 'Book', author: 'Author' },
  torrent: release(1),
  alternateTorrents: [release(2)],
  jobId: 'job-329',
};

const goneError = () => new UnusableDownloadSourceError(
  'SABnzbd already has "release-1" as a finished download, but its files are not on disk',
  'Already in SABnzbd, files gone'
);

describe('processDownloadTorrent: SABnzbd duplicates and retries (#329)', () => {
  let sab: { clientType: string; protocol: string; addDownload: ReturnType<typeof vi.fn>; resumeDownload: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook', user: { plexUsername: 'testuser' } });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-329' });
    configMock.getMany.mockResolvedValue({ prowlarr_api_key: null });
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    blocklistMock.addAutoBlock.mockResolvedValue({ blocked: null, wasNew: true });
    sab = { clientType: 'sabnzbd', protocol: 'usenet', addDownload: vi.fn(), resumeDownload: vi.fn().mockResolvedValue(undefined) };
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(sab);
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({ id: 'sab-1', type: 'sabnzbd', enabled: true, category: 'readmeabook' });
  });

  it('blocklists a duplicate whose files are gone and grabs the next release', async () => {
    sab.addDownload
      .mockRejectedValueOnce(goneError())
      .mockResolvedValueOnce({ id: 'SABnzbd_nzo_2', alreadyInClient: false });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    const result = await processDownloadTorrent(payload);

    expect(blocklistMock.addAutoBlock).toHaveBeenCalledTimes(1);
    expect(blocklistMock.addAutoBlock).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-329',
      releaseName: 'Book - Author - Release 1',
      indexerName: 'Indexer 1',
      indexerId: 1,
      source: 'download_fail',
      reason: 'Already in SABnzbd, files gone',
      jobId: 'job-329',
    }));
    expect(result).toMatchObject({ success: true, downloadClientId: 'SABnzbd_nzo_2' });
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith('req-329', 'dh-329', 'SABnzbd_nzo_2', 'sabnzbd', 3);
  });

  it('a taken-over duplicate is tracked as this request\'s download', async () => {
    sab.addDownload.mockResolvedValueOnce({ id: 'SABnzbd_nzo_existing', alreadyInClient: true });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await processDownloadTorrent(payload);

    expect(prismaMock.downloadHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nzbId: 'SABnzbd_nzo_existing', downloadClientId: 'SABnzbd_nzo_existing', addedByRmab: false }),
    });
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith('req-329', 'dh-329', 'SABnzbd_nzo_existing', 'sabnzbd', 3);
    expect(blocklistMock.addAutoBlock).not.toHaveBeenCalled();
  });

  it('an unusable source without a blocklist reason is skipped without blocklisting, unchanged', async () => {
    sab.addDownload
      .mockRejectedValueOnce(new UnusableDownloadSourceError('Invalid redirect location'))
      .mockResolvedValueOnce({ id: 'SABnzbd_nzo_2', alreadyInClient: false });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await processDownloadTorrent(payload);

    expect(blocklistMock.addAutoBlock).not.toHaveBeenCalled();
    expect(sab.addDownload).toHaveBeenCalledTimes(2);
  });

  it('tells the client a Bull retry is a retry, so it checks before adding again', async () => {
    sab.addDownload.mockResolvedValueOnce({ id: 'SABnzbd_nzo_first_try', alreadyInClient: true });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await processDownloadTorrent(payload, { attemptsMade: 1 });

    expect(sab.addDownload).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ retry: true }));
  });

  it('passes the release title to a usenet client, which matches an existing job by it', async () => {
    sab.addDownload.mockResolvedValueOnce({ id: 'SABnzbd_nzo_1', alreadyInClient: false });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await processDownloadTorrent(payload);

    expect(sab.addDownload).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ releaseTitle: 'Book - Author - Release 1' }));
  });

  describe('a held job that waits paused', () => {
    const heldPaused = () => {
      sab.addDownload.mockResolvedValueOnce({ id: 'SABnzbd_nzo_paused', alreadyInClient: true, paused: true });
    };

    it('is resumed when RMAB added that job for an earlier download', async () => {
      heldPaused();
      prismaMock.downloadHistory.findFirst.mockResolvedValueOnce({ id: 'dh-earlier' });

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
      await processDownloadTorrent(payload);

      expect(prismaMock.downloadHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ downloadClient: 'sabnzbd', addedByRmab: true }),
      }));
      expect(sab.resumeDownload).toHaveBeenCalledWith('SABnzbd_nzo_paused');
      expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith('req-329', 'dh-329', 'SABnzbd_nzo_paused', 'sabnzbd', 3);
    });

    it('is tracked but left paused when RMAB did not add it', async () => {
      heldPaused();
      prismaMock.downloadHistory.findFirst.mockResolvedValueOnce(null);

      const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
      await processDownloadTorrent(payload);

      expect(sab.resumeDownload).not.toHaveBeenCalled();
      expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith('req-329', 'dh-329', 'SABnzbd_nzo_paused', 'sabnzbd', 3);
    });
  });

  it('a first attempt is not a retry', async () => {
    sab.addDownload.mockResolvedValueOnce({ id: 'SABnzbd_nzo_1', alreadyInClient: false });

    const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
    await processDownloadTorrent(payload, { attemptsMade: 0 });

    expect(sab.addDownload.mock.calls[0][1]).not.toHaveProperty('retry');
  });
});
