/**
 * Component: Client-Reported Download Failure Tests (next release, #332)
 * Documentation: documentation/admin-features/release-blocklist.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));

import type { ClientFailureInput } from '@/lib/processors/client-failure';

const { MAX_CLIENT_FAILURES, handleClientReportedFailure, isReleaseFault, nextReleaseSearchJobId } =
  await import('@/lib/processors/client-failure');

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ClientFailureInput['logger'];

const request = {
  id: 'req-1',
  audiobook: { id: 'book-1', title: 'Book', author: 'Author', audibleAsin: 'B00TEST' },
  user: { plexUsername: 'user' },
};

const input = (overrides: Partial<ClientFailureInput> = {}): ClientFailureInput => ({
  requestId: 'req-1',
  downloadHistoryId: 'dh-1',
  clientType: 'sabnzbd',
  clientError: 'Out of retention',
  clientFailures: 0,
  logger,
  ...overrides,
});

const requestWrites = () => prismaMock.request.updateMany.mock.calls.map(([arg]) => arg.data);
const notifications = () => jobQueueMock.addNotificationJob.mock.calls.map((call) => call[5]);

describe('isReleaseFault', () => {
  it.each([
    // qBittorrent: the Web API gives no error text
    ['qbittorrent', 'qBittorrent reported an error', true],
    ['qbittorrent', undefined, true],
    ['qbittorrent', 'qBittorrent reports the files are missing (missingFiles)', false],
    // Transmission: only a local error fails a torrent
    ['transmission', 'File name too long', true],
    ['transmission', 'No space left on device', false],
    ['transmission', 'No data found! Ensure your drives are connected or use "Set Location". To re-download, remove the torrent and re-add it.', false],
    ['transmission', 'No such file or directory (/downloads/Book)', false],
    ['transmission', 'Input/output error', false],
    ['transmission', 'Transport endpoint is not connected', false],
    ['transmission', 'Stale file handle', false],
    ['transmission', 'Read-only file system', false],
    // Deluge
    ['deluge', 'Error: Permission denied', false],
    ['deluge', 'Missing or invalid torrent data!', false],
    ['deluge', 'The system cannot find the path specified.', false],
    ['deluge', 'Access is denied.', false],
    ['deluge', 'torrent has no valid pieces', true],
    // SABnzbd
    ['sabnzbd', 'Out of retention', true],
    ['sabnzbd', 'Repair failed, not enough repair blocks (12 short)', true],
    ['sabnzbd', 'Unpacking failed, archive requires a password', true],
    ['sabnzbd', 'Unpacking failed, write error or disk is full?', false],
    ['sabnzbd', 'Failed moving /incomplete/Book to /complete/Book', false],
    // NZBGet: raw history status first
    ['nzbget', 'FAILURE/PAR | Par: FAILURE', true],
    ['nzbget', 'FAILURE/UNPACK | Unpack: FAILURE', true],
    ['nzbget', 'DELETED/HEALTH | Delete: HEALTH | 812 failed articles (61%)', true],
    ['nzbget', 'DELETED/DUPE | Delete: DUPE', true],
    ['nzbget', 'DELETED/MANUAL | Delete: MANUAL', false],
    ['nzbget', 'FAILURE/MOVE', false],
    ['nzbget', 'FAILURE/UNPACK | Unpack: SPACE', false],
  ])('%s "%s" -> release fault %s', (clientType, text, expected) => {
    expect(isReleaseFault(clientType, text)).toBe(expected);
  });
});

describe('handleClientReportedFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    jobQueueMock.addSearchJob.mockResolvedValue('job-search');
    prismaMock.request.findUnique.mockResolvedValue(request);
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'dh-1' });
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.findUnique.mockResolvedValue({
      id: 'dh-1', torrentName: 'Author - Book [M4B]', torrentHash: null, nzbId: 'nzb-1', indexerName: 'Indexer', indexerId: 3,
    });
    prismaMock.blockedRelease.upsert.mockResolvedValue({ id: 'block-1', createdAt: new Date() });
  });

  it('automatic grab, first failure: blocks, goes back to searching, queues the next search with count 1, says attempt 2 of 3', async () => {
    await expect(handleClientReportedFailure(input())).resolves.toBe('next_release');

    expect(requestWrites()).toEqual([expect.objectContaining({ status: 'searching', progress: 0, errorMessage: null })]);
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({
      where: { id: 'dh-1' },
      data: { downloadStatus: 'failed', downloadError: 'Download failed in SABnzbd (Out of retention)' },
    });
    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ source: 'download_fail', releaseHash: 'nzb-1', reasonDetail: 'Out of retention' }),
    }));
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith(
      'req-1',
      { id: 'book-1', title: 'Book', author: 'Author', asin: 'B00TEST' },
      { clientFailures: 1, jobId: 'next-release-dh-1' }
    );
    expect(notifications()).toEqual(['Download failed in SABnzbd (Out of retention). Trying another release (attempt 2 of 3).']);
    // The block exists before the search runs, and the history row is failed before it
    const blockOrder = prismaMock.blockedRelease.upsert.mock.invocationCallOrder[0];
    const historyOrder = prismaMock.downloadHistory.update.mock.invocationCallOrder[0];
    const searchOrder = jobQueueMock.addSearchJob.mock.invocationCallOrder[0];
    expect(historyOrder).toBeLessThan(searchOrder);
    expect(blockOrder).toBeLessThan(searchOrder);
  });

  it('automatic grab, second failure: queues the next search with count 2 (attempt 3 of 3)', async () => {
    await expect(handleClientReportedFailure(input({ clientFailures: 1 }))).resolves.toBe('next_release');

    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', expect.anything(), { clientFailures: 2, jobId: 'next-release-dh-1' });
    expect(notifications()[0]).toContain('attempt 3 of 3');
  });

  it(`automatic grab, failure ${MAX_CLIENT_FAILURES} in a row: blocks and fails the request, no search`, async () => {
    await expect(handleClientReportedFailure(input({ clientFailures: 2 }))).resolves.toBe('failed');

    const message = '3 releases in a row failed in the download client; last: Download failed in SABnzbd (Out of retention)';
    expect(requestWrites()).toEqual([expect.objectContaining({ status: 'failed', errorMessage: message })]);
    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual([message]);
  });

  it('hand-picked grab (no count): blocks and fails as before, never moves on', async () => {
    await expect(handleClientReportedFailure(input({ clientFailures: undefined }))).resolves.toBe('failed');

    expect(requestWrites()).toEqual([expect.objectContaining({ status: 'failed', errorMessage: 'Download failed in SABnzbd (Out of retention)' })]);
    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual(['Download failed in SABnzbd (Out of retention)']);
  });

  it.each([
    ['automatic', 0],
    ['hand-picked', undefined],
  ])('not the release\'s fault (%s grab): fails, names the cause, blocks nothing, no search', async (_kind, clientFailures) => {
    const result = await handleClientReportedFailure(input({
      clientType: 'transmission', clientError: 'No space left on device', clientFailures,
    }));

    expect(result).toBe('failed');
    expect(requestWrites()).toEqual([expect.objectContaining({ status: 'failed' })]);
    expect(requestWrites()[0].errorMessage).toMatch(/^Download failed in Transmission \(No space left on device\): .*not the release.*not blocked/);
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual([requestWrites()[0].errorMessage]);
  });

  it('a cancel or delete at the guarded write wins: no history write, no block, no search, no notification', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });

    await expect(handleClientReportedFailure(input())).resolves.toBe('stopped');

    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });

  it('moves on only when the block was written: a blocklist write error fails the request as before', async () => {
    prismaMock.blockedRelease.upsert.mockRejectedValue(new Error('db down'));

    await expect(handleClientReportedFailure(input())).resolves.toBe('failed');

    expect(requestWrites()).toEqual([
      expect.objectContaining({ status: 'searching' }),
      expect.objectContaining({ status: 'failed', errorMessage: 'Download failed in SABnzbd (Out of retention)' }),
    ]);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual(['Download failed in SABnzbd (Out of retention)']);
  });

  it('moves on only when the block was written: a download with no release name fails as before', async () => {
    prismaMock.downloadHistory.findUnique.mockResolvedValue({ id: 'dh-1', torrentName: null });

    await expect(handleClientReportedFailure(input())).resolves.toBe('failed');

    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(requestWrites().at(-1)).toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('an older download (not the newest selected row) never changes the request or queues a search', async () => {
    prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'dh-newer' });

    await expect(handleClientReportedFailure(input())).resolves.toBe('stale');

    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
    // It still records its own failure and blocks its own release
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'dh-1' } }));
    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledTimes(1);
  });

  it('an older download of a cancelled request writes nothing', async () => {
    prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'dh-newer' });
    prismaMock.request.findUnique.mockResolvedValue({ status: 'cancelled', deletedAt: null });

    await expect(handleClientReportedFailure(input())).resolves.toBe('stopped');

    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.blockedRelease.upsert).not.toHaveBeenCalled();
  });

  it('an error after the next search is queued stays inside: no failed write, no second search', async () => {
    // First read: the audiobook for the search. Second read: the notification lookup, which throws.
    prismaMock.request.findUnique.mockResolvedValueOnce(request).mockRejectedValueOnce(new Error('connection reset'));

    await expect(handleClientReportedFailure(input())).resolves.toBe('next_release');

    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
    expect(requestWrites()).toEqual([expect.objectContaining({ status: 'searching' })]);
  });

  it('a search that cannot be queued ends the request failed instead of leaving it searching', async () => {
    jobQueueMock.addSearchJob.mockRejectedValue(new Error('redis down'));

    await expect(handleClientReportedFailure(input())).resolves.toBe('failed');

    expect(requestWrites()).toEqual([
      expect.objectContaining({ status: 'searching' }),
      expect.objectContaining({ status: 'failed', errorMessage: 'Download failed in SABnzbd (Out of retention)' }),
    ]);
    expect(notifications()).toEqual(['Download failed in SABnzbd (Out of retention)']);
  });

  it('a second run of the same failure asks for the same Bull job id (the queue ignores the duplicate)', async () => {
    await handleClientReportedFailure(input());
    await handleClientReportedFailure(input());

    const jobIds = jobQueueMock.addSearchJob.mock.calls.map((call) => call[2].jobId);
    expect(jobIds).toEqual([nextReleaseSearchJobId('dh-1'), nextReleaseSearchJobId('dh-1')]);
  });

  it('caps the client text kept in the message at 200 characters', async () => {
    await handleClientReportedFailure(input({ clientFailures: undefined, clientError: 'x'.repeat(500) }));

    expect(requestWrites()[0].errorMessage).toBe(`Download failed in SABnzbd (${'x'.repeat(200)})`);
  });
});
