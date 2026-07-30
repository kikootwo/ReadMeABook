import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processBulkImportBatch } from '@/lib/processors/bulk-import-batch.processor';

const prismaMock = vi.hoisted(() => ({
  audiobook: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  audibleCache: {
    findUnique: vi.fn(),
  },
  request: {
    create: vi.fn(),
  },
}));

const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn().mockResolvedValue('search-job-1'),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({}),
}));

describe('Async Bulk Import Batch Processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process batch items in chunks and enqueue search jobs', async () => {
    prismaMock.audiobook.create.mockResolvedValue({ id: 'book-1' } as any);
    prismaMock.request.create.mockResolvedValue({ id: 'req-1' } as any);

    const items = [
      { title: 'Dune', author: 'Frank Herbert' },
      { title: 'Hyperion', author: 'Dan Simmons' },
    ];

    const result = await processBulkImportBatch({
      userId: 'user-1',
      imports: items,
    });

    expect(result.success).toBe(true);
    expect(result.totalProcessed).toBe(2);
    expect(result.totalQueued).toBe(2);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(2);
  });
});
