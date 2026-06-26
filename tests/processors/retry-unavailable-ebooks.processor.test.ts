/**
 * Component: Retry Unavailable Ebooks Processor Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

describe('processRetryUnavailableEbooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets unavailable ebooks to awaiting_search and enqueues search jobs', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-1',
        type: 'ebook',
        status: 'unavailable',
        audiobook: { id: 'a1', title: 'Book One', author: 'Author One', audibleAsin: 'ASIN1' },
      },
      {
        id: 'req-2',
        type: 'ebook',
        status: 'unavailable',
        audiobook: { id: 'a2', title: 'Book Two', author: 'Author Two', audibleAsin: null },
      },
    ]);

    const { processRetryUnavailableEbooks } = await import('@/lib/processors/retry-unavailable-ebooks.processor');
    const result = await processRetryUnavailableEbooks({ jobId: 'job-1' });

    expect(result.success).toBe(true);
    expect(result.triggered).toBe(2);

    // Should reset status, clear searchAttempts, and clear errorMessage
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1' },
        data: expect.objectContaining({
          status: 'awaiting_search',
          searchAttempts: 0,
          errorMessage: null,
        }),
      })
    );

    // Should enqueue search jobs
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledTimes(2);
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({ id: 'a1', title: 'Book One' })
    );
  });

  it('returns zero triggered when no unavailable ebooks exist', async () => {
    prismaMock.request.findMany.mockResolvedValue([]);

    const { processRetryUnavailableEbooks } = await import('@/lib/processors/retry-unavailable-ebooks.processor');
    const result = await processRetryUnavailableEbooks({ jobId: 'job-2' });

    expect(result.success).toBe(true);
    expect(result.triggered).toBe(0);
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
  });

  it('continues processing remaining requests when one fails', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-fail',
        type: 'ebook',
        status: 'unavailable',
        audiobook: { id: 'a1', title: 'Fail Book', author: 'Author', audibleAsin: null },
      },
      {
        id: 'req-ok',
        type: 'ebook',
        status: 'unavailable',
        audiobook: { id: 'a2', title: 'OK Book', author: 'Author', audibleAsin: null },
      },
    ]);

    prismaMock.request.update
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce({});

    const { processRetryUnavailableEbooks } = await import('@/lib/processors/retry-unavailable-ebooks.processor');
    const result = await processRetryUnavailableEbooks({ jobId: 'job-3' });

    expect(result.success).toBe(true);
    expect(result.triggered).toBe(1);
  });
});
