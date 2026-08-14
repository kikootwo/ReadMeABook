/**
 * Component: Direct Download Fallback Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Tests for atomic fallback from direct download to indexer search.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';

const prismaMock = vi.hoisted(() => ({
  request: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  downloadHistory: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  jobEvent: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const jobQueueMock = vi.hoisted(() => ({
  addSearchEbookJob: vi.fn(),
  addSearchJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  getAudibleRegion: vi.fn(),
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

const ebookScraperMock = vi.hoisted(() => ({
  searchByAsin: vi.fn(),
  searchByTitle: vi.fn(),
  getSlowDownloadLinks: vi.fn(),
}));

vi.mock('@/lib/services/ebook-scraper', () => ebookScraperMock);

describe('Direct Download Fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.get.mockResolvedValue('true');
    ebookScraperMock.searchByAsin.mockResolvedValue(null);
    ebookScraperMock.searchByTitle.mockResolvedValue(null);
    prismaMock.jobEvent.create.mockResolvedValue({});
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
  });

  describe('triggerDirectDownloadFallback', () => {
    it('atomically claims fallback_triggered status and enqueues ebook search', async () => {
      const { triggerDirectDownloadFallback } = await import('@/lib/utils/direct-download-fallback');

      prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.request.findUnique.mockResolvedValue({
        audiobook: {
          id: 'ab-1',
          title: 'Test Book',
          author: 'Test Author',
        },
        parentRequestId: 'parent-1',
      });
      prismaMock.request.update.mockResolvedValue({});

      await triggerDirectDownloadFallback('req-1', 'dh-1', 'Zero download URLs available', 'ebook');

      expect(prismaMock.downloadHistory.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'dh-1',
          requestId: 'req-1',
          downloadStatus: 'downloading',
        },
        data: {
          downloadStatus: 'fallback_triggered',
          downloadError: 'Zero download URLs available',
        },
      });

      expect(jobQueueMock.addSearchEbookJob.mock.calls[0]).toEqual([
        'req-1',
        expect.objectContaining({
          id: 'ab-1',
          title: 'Test Book',
          author: 'Test Author',
        }),
        undefined,
        { isFallback: true },
      ]);

      expect(prismaMock.request.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          errorMessage: 'Zero download URLs available',
        },
      });
    });

    it('atomically claims fallback_triggered status and enqueues audiobook search', async () => {
      const { triggerDirectDownloadFallback } = await import('@/lib/utils/direct-download-fallback');

      prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.request.findUnique.mockResolvedValue({
        audiobook: {
          id: 'ab-1',
          title: 'Test Book',
          author: 'Test Author',
          audibleAsin: 'B001ASIN',
        },
      });
      prismaMock.request.update.mockResolvedValue({});

      await triggerDirectDownloadFallback('req-1', 'dh-1', 'Direct download failed', 'audiobook');

      expect(prismaMock.downloadHistory.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'dh-1',
          requestId: 'req-1',
          downloadStatus: 'downloading',
        },
        data: {
          downloadStatus: 'fallback_triggered',
          downloadError: 'Direct download failed',
        },
      });

      expect(jobQueueMock.addSearchJob.mock.calls[0]).toEqual([
        'req-1',
        expect.objectContaining({
          id: 'ab-1',
          title: 'Test Book',
          author: 'Test Author',
          asin: 'B001ASIN',
        }),
      ]);

      expect(prismaMock.request.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          errorMessage: 'Direct download failed',
        },
      });
    });

    it('does not enqueue search when claim fails (duplicate retry)', async () => {
      const { triggerDirectDownloadFallback } = await import('@/lib/utils/direct-download-fallback');

      prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 0 });

      await triggerDirectDownloadFallback('req-1', 'dh-1', 'All links exhausted', 'ebook');

      expect(prismaMock.downloadHistory.updateMany).toHaveBeenCalled();
      expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
      expect(prismaMock.request.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.request.update).not.toHaveBeenCalled();
    });

    it('does not overwrite terminal statuses (failed, completed)', async () => {
      const { triggerDirectDownloadFallback } = await import('@/lib/utils/direct-download-fallback');

      prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 0 });

      await triggerDirectDownloadFallback('req-1', 'dh-1', 'Late error', 'audiobook');

      expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    });

    it('does not overwrite existing fallback_triggered status', async () => {
      const { triggerDirectDownloadFallback } = await import('@/lib/utils/direct-download-fallback');

      prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 0 });

      await triggerDirectDownloadFallback('req-1', 'dh-1', 'Second attempt', 'ebook');

      expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
      expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    });

    it('includes isFallback=true in ebook search payload', async () => {
      const { triggerDirectDownloadFallback } = await import('@/lib/utils/direct-download-fallback');

      prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.request.findUnique.mockResolvedValue({
        audiobook: { id: 'ab-1', title: 'Test', author: 'Author' },
        parentRequestId: 'parent-1',
      });
      prismaMock.request.update.mockResolvedValue({});

      await triggerDirectDownloadFallback('req-1', 'dh-1', 'Exhausted links', 'ebook');

      expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          id: 'ab-1',
          title: 'Test',
          author: 'Author',
        }),
        undefined,
        { isFallback: true }
      );
    });
  });

  describe('Fallback search skips direct download sources', () => {
    it('skips direct download when isFallback=true in payload', async () => {
      const { processSearchEbook } = await import('@/lib/processors/search-ebook.processor');

      prismaMock.request.update.mockResolvedValue({
        customSearchTerms: null,
      });
      prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
      prismaMock.downloadHistory.update.mockResolvedValue({});

      configServiceMock.get.mockImplementation(async (key: string) => {
        if (key === 'ebook_annas_archive_enabled') return 'true';
        if (key === 'ebook_indexer_search_enabled') return 'false';
        return null;
      });

      await processSearchEbook({
        requestId: 'req-1',
        audiobook: {
          id: 'ab-1',
          title: 'Test Book',
          author: 'Test Author',
          asin: 'B001ASIN',
        },
        jobId: 'job-1',
        isFallback: true,
      });

      // Direct download sources should be skipped when isFallback=true
      expect(ebookScraperMock.searchByAsin).not.toHaveBeenCalled();
      expect(ebookScraperMock.searchByTitle).not.toHaveBeenCalled();
    });

    it('searches direct download sources when isFallback is not set', async () => {
      const { processSearchEbook } = await import('@/lib/processors/search-ebook.processor');

      prismaMock.request.update.mockResolvedValue({
        customSearchTerms: null,
      });
      prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
      prismaMock.downloadHistory.update.mockResolvedValue({});

      configServiceMock.get.mockImplementation(async (key: string) => {
        if (key === 'ebook_annas_archive_enabled') return 'true';
        if (key === 'ebook_indexer_search_enabled') return 'false';
        return null;
      });

      ebookScraperMock.searchByAsin.mockResolvedValue('md123');
      ebookScraperMock.getSlowDownloadLinks.mockResolvedValue([]);

      await processSearchEbook({
        requestId: 'req-1',
        audiobook: {
          id: 'ab-1',
          title: 'Test Book',
          author: 'Test Author',
          asin: 'B001ASIN',
        },
        jobId: 'job-1',
        // No isFallback field
      });

      // Direct download sources should be searched when isFallback is not set
      expect(ebookScraperMock.searchByAsin).toHaveBeenCalled();
    });
  });
});