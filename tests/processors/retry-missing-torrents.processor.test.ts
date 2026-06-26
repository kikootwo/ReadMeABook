/**
 * Component: Retry Missing Torrents Processor Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

function futureDate(days = 30): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function pastDate(days = 30): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('processRetryMissingTorrents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: setting ON (default when absent)
    configMock.get.mockResolvedValue(null);
  });

  it('queues search jobs for awaiting_search requests with no release date', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-1',
        type: 'audiobook',
        status: 'awaiting_search',
        releaseDate: null,
        audiobook: { id: 'a1', title: 'Book', author: 'Author', audibleAsin: 'ASIN1' },
      },
    ]);

    const { processRetryMissingTorrents } = await import('@/lib/processors/retry-missing-torrents.processor');
    const result = await processRetryMissingTorrents({ jobId: 'job-1' });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({ id: 'a1', title: 'Book', author: 'Author' })
    );
    expect(prismaMock.request.update).not.toHaveBeenCalled();
  });

  it('transitions awaiting_search → awaiting_release when book is unreleased and setting ON', async () => {
    configMock.get.mockResolvedValue('true');
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-2',
        type: 'audiobook',
        status: 'awaiting_search',
        releaseDate: futureDate(30),
        audiobook: { id: 'a2', title: 'Future Book', author: 'Future Author', audibleAsin: 'ASIN2' },
      },
    ]);

    const { processRetryMissingTorrents } = await import('@/lib/processors/retry-missing-torrents.processor');
    const result = await processRetryMissingTorrents({ jobId: 'job-2' });

    expect(result.success).toBe(true);
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-2' },
      data: { status: 'awaiting_release' },
    });
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('transitions awaiting_release → awaiting_search and runs search when release date passed', async () => {
    configMock.get.mockResolvedValue('true');
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-3',
        type: 'audiobook',
        status: 'awaiting_release',
        releaseDate: pastDate(5),
        audiobook: { id: 'a3', title: 'Released Book', author: 'Some Author', audibleAsin: 'ASIN3' },
      },
    ]);

    const { processRetryMissingTorrents } = await import('@/lib/processors/retry-missing-torrents.processor');
    const result = await processRetryMissingTorrents({ jobId: 'job-3' });

    expect(result.success).toBe(true);
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-3' },
      data: { status: 'awaiting_search' },
    });
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith(
      'req-3',
      expect.objectContaining({ id: 'a3', title: 'Released Book', author: 'Some Author' })
    );
    expect(result.transitioned).toBe(1);
    expect(result.triggered).toBe(1);
  });

  it('leaves awaiting_release as-is when book is still unreleased', async () => {
    configMock.get.mockResolvedValue('true');
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-4',
        type: 'audiobook',
        status: 'awaiting_release',
        releaseDate: futureDate(60),
        audiobook: { id: 'a4', title: 'Still Future', author: 'Author', audibleAsin: 'ASIN4' },
      },
    ]);

    const { processRetryMissingTorrents } = await import('@/lib/processors/retry-missing-torrents.processor');
    const result = await processRetryMissingTorrents({ jobId: 'job-4' });

    expect(result.success).toBe(true);
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.transitioned).toBe(0);
  });

  it('runs search for awaiting_search with future date when setting is OFF', async () => {
    configMock.get.mockResolvedValue('false');
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-5',
        type: 'audiobook',
        status: 'awaiting_search',
        releaseDate: futureDate(10),
        audiobook: { id: 'a5', title: 'Off Setting Book', author: 'Author', audibleAsin: 'ASIN5' },
      },
    ]);

    const { processRetryMissingTorrents } = await import('@/lib/processors/retry-missing-torrents.processor');
    const result = await processRetryMissingTorrents({ jobId: 'job-5' });

    expect(result.success).toBe(true);
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
    expect(result.triggered).toBe(1);
  });

  it('reclaims requests orphaned in `searching` past the stale threshold', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 3 });
    prismaMock.request.findMany.mockResolvedValue([]);

    const { processRetryMissingTorrents } = await import('@/lib/processors/retry-missing-torrents.processor');
    const result = await processRetryMissingTorrents({ jobId: 'job-reap' });

    expect(result.success).toBe(true);
    expect(result.reclaimed).toBe(3);
    // Reaper resets stale `searching` rows to `awaiting_search` with a time guard.
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'searching',
          deletedAt: null,
          updatedAt: { lt: expect.any(Date) },
        }),
        data: expect.objectContaining({ status: 'awaiting_search' }),
      })
    );
  });

  it('reports zero reclaimed when nothing is stuck in `searching`', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.request.findMany.mockResolvedValue([]);

    const { processRetryMissingTorrents } = await import('@/lib/processors/retry-missing-torrents.processor');
    const result = await processRetryMissingTorrents({ jobId: 'job-noreap' });

    expect(result.success).toBe(true);
    expect(result.reclaimed).toBe(0);
  });
});
