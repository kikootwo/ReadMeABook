/**
 * Component: Stall-Limit Failure Handler Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { JobActivityTracker } from '@/lib/services/job-activity-tracker';

type Module = typeof import('@/lib/services/job-stall-failure');
let handleStallLimitFailure: Module['handleStallLimitFailure'];
const STALL_LIMIT_MESSAGE = 'job stalled more than allowable limit';
const INTERRUPTED_DOWNLOAD_MESSAGE = 'Download was interrupted when the app stopped. Try the download again.';

const stalled = () => new Error(STALL_LIMIT_MESSAGE);
const clientImport = { requestId: 'req-1', audiobookId: 'book-1', downloadPath: '/downloads/book', downloadHistoryId: 'hist-1' };
const PROCESSING = { id: 'req-1', status: 'processing', deletedAt: null };

describe('handleStallLimitFailure', () => {
  let tracker: JobActivityTracker;

  beforeEach(async () => {
    ({ handleStallLimitFailure } = await import('@/lib/services/job-stall-failure'));
    vi.clearAllMocks();
    tracker = new JobActivityTracker();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('organize_files', () => {
    it('moves a client download import cut twice from processing to awaiting_import, counting a retry', async () => {
      prismaMock.request.findFirst.mockResolvedValue({ importAttempts: 1, maxImportRetries: 5 });

      await handleStallLimitFailure({ id: '7', name: 'organize_files', data: clientImport }, stalled(), tracker);

      expect(prismaMock.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: PROCESSING }));
      expect(prismaMock.request.updateMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
        where: { ...PROCESSING, importAttempts: 1 },
        data: expect.objectContaining({
          status: 'awaiting_import',
          importAttempts: 2,
          lastImportAt: expect.any(Date),
          errorMessage: 'Import was interrupted when the app stopped; it will be retried. Retry 2/5',
        }),
      });
    });

    it('moves it to warn at the import retry limit', async () => {
      prismaMock.request.findFirst.mockResolvedValue({ importAttempts: 4, maxImportRetries: 5 });

      await handleStallLimitFailure({ id: '7', name: 'organize_files', data: clientImport }, stalled(), tracker);

      expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
        where: { ...PROCESSING, importAttempts: 4 },
        data: expect.objectContaining({ status: 'warn', importAttempts: 5 }),
      });
    });

    it('leaves a request that is no longer processing (downloaded, available, cancelled or deleted) alone', async () => {
      prismaMock.request.findFirst.mockResolvedValue(null); // the status filter matched nothing

      await handleStallLimitFailure({ id: '7', name: 'organize_files', data: clientImport }, stalled(), tracker);

      expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['manual import', true],
      ['bulk import', false],
    ])('a %s cut twice ends failed with "run the import again", never awaiting_import', async (_label, cleanupSource) => {
      const data = { requestId: 'req-1', audiobookId: 'book-1', downloadPath: '/imports/book', cleanupSource };

      await handleStallLimitFailure({ id: '8', name: 'organize_files', data }, stalled(), tracker);

      expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.request.updateMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
        where: PROCESSING,
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: 'Import from /imports/book was interrupted when the app stopped. Run the import again.',
        }),
      });
    });

    it('leaves the request alone while an organize job for it still runs in this process', async () => {
      tracker.trackActive({ id: '9', name: 'organize_files', data: { requestId: 'req-1' } }, new Promise(() => undefined));

      await handleStallLimitFailure({ id: '7', name: 'organize_files', data: clientImport }, stalled(), tracker);

      expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('start_direct_download', () => {
    const data = { requestId: 'req-1', downloadHistoryId: 'hist-1', downloadUrl: 'https://example.invalid/x', targetFilename: 'x.epub' };

    it('fails a request still downloading its selected download and marks that download failed', async () => {
      prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'hist-1' });

      await handleStallLimitFailure({ id: '5', name: 'start_direct_download', data }, stalled(), tracker);

      expect(prismaMock.downloadHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { requestId: 'req-1', selected: true },
        orderBy: { createdAt: 'desc' },
      }));
      expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'downloading', deletedAt: null },
        data: expect.objectContaining({ status: 'failed', errorMessage: INTERRUPTED_DOWNLOAD_MESSAGE }),
      });
      expect(prismaMock.downloadHistory.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'hist-1' }),
        data: { downloadStatus: 'failed', downloadError: INTERRUPTED_DOWNLOAD_MESSAGE },
      });
    });

    it('never marks a download row recorded as removed (a cancel in the same instant wins)', async () => {
      prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'hist-1' });

      await handleStallLimitFailure({ id: '5', name: 'start_direct_download', data }, stalled(), tracker);

      expect(prismaMock.downloadHistory.updateMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.downloadHistory.updateMany.mock.calls[0][0].where).toEqual({
        id: 'hist-1',
        OR: [{ downloadStatus: null }, { downloadStatus: { not: 'removed' } }],
      });
    });

    it('leaves a request that already moved on to processing alone', async () => {
      prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'hist-1' });
      prismaMock.request.updateMany.mockResolvedValue({ count: 0 });

      await handleStallLimitFailure({ id: '5', name: 'start_direct_download', data }, stalled(), tracker);

      expect(prismaMock.downloadHistory.updateMany).not.toHaveBeenCalled();
    });

    it('leaves the request alone when the job is not for its current selected download', async () => {
      prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'hist-2' });

      await handleStallLimitFailure({ id: '5', name: 'start_direct_download', data }, stalled(), tracker);

      expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.downloadHistory.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('changes nothing', () => {
    it.each([
      ['a failure that is not the stall limit', { id: '7', name: 'organize_files', data: clientImport }, new Error('ENOENT: no such file')],
      ['a null job', null, stalled()],
      ['a job without requestId', { id: '7', name: 'organize_files', data: { downloadPath: '/x' } }, stalled()],
      ['an empty requestId', { id: '7', name: 'organize_files', data: { ...clientImport, requestId: '' } }, stalled()],
      ['another job type', { id: '7', name: 'search_indexers', data: { requestId: 'req-1' } }, stalled()],
    ])('for %s', async (_label, job, error) => {
      await handleStallLimitFailure(job, error, tracker);

      expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.downloadHistory.findFirst).not.toHaveBeenCalled();
    });

    it('and never throws when the database write fails', async () => {
      prismaMock.request.findFirst.mockRejectedValue(new Error('db down'));
      await expect(
        handleStallLimitFailure({ id: '7', name: 'organize_files', data: clientImport }, stalled(), tracker)
      ).resolves.toBeUndefined();
    });
  });
});
