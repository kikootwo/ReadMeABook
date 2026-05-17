/**
 * Component: Find Missing Ebooks Processor Tests
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

type CandidateRow = {
  parent_request_id: string;
  user_id: string;
  audiobook_id: string;
  custom_search_terms: string | null;
  audiobook_title: string;
  audiobook_author: string;
  audible_asin: string | null;
  ebook_request_id: string | null;
  ebook_status: string | null;
  ebook_auto_retry_count: number | null;
};

const baseRow = (overrides: Partial<CandidateRow> = {}): CandidateRow => ({
  parent_request_id: 'parent-1',
  user_id: 'user-1',
  audiobook_id: 'audio-1',
  custom_search_terms: null,
  audiobook_title: 'Test Book',
  audiobook_author: 'Test Author',
  audible_asin: 'ASIN0001',
  ebook_request_id: null,
  ebook_status: null,
  ebook_auto_retry_count: null,
  ...overrides,
});

/**
 * Default: all gates pass (auto-grab default ON when null; Anna's enabled).
 * Tests that want a different gate state can override before calling.
 */
const installDefaultGates = () => {
  configMock.get.mockImplementation(async (key: string) => {
    switch (key) {
      case 'ebook_auto_grab_enabled':
        return null; // null/absent => ON
      case 'ebook_annas_archive_enabled':
        return 'true';
      case 'ebook_indexer_search_enabled':
        return 'false';
      case 'ebook_sidecar_enabled':
        return null;
      default:
        return null;
    }
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultGates();
  // Default: $transaction runs the callback against the prismaMock surface.
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  // Default: each create call returns a stable ebook request id.
  prismaMock.request.create.mockImplementation(async (args: any) => ({
    id: 'new-ebook-1',
    ...args.data,
  }));
  prismaMock.request.update.mockResolvedValue({});
});

describe('processFindMissingEbooks — gating', () => {
  it('returns zeros when auto-grab is disabled (explicit false)', async () => {
    configMock.get.mockImplementation(async (key: string) =>
      key === 'ebook_auto_grab_enabled' ? 'false' : null
    );

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-1' });

    expect(result).toMatchObject({
      success: true,
      scanned: 0,
      gapsFound: 0,
      triggered: 0,
      created: 0,
      retried: 0,
      skippedInFlight: 0,
      skippedCancelled: 0,
      skippedCapHit: 0,
    });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
  });

  it('treats auto-grab unset (null) as ON and proceeds to source check', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      switch (key) {
        case 'ebook_auto_grab_enabled':
          return null;
        case 'ebook_annas_archive_enabled':
          return 'true';
        default:
          return null;
      }
    });
    prismaMock.$queryRaw.mockResolvedValue([]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-2' });

    expect(result.scanned).toBe(0);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns zeros when both new source keys disabled AND no legacy key', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      switch (key) {
        case 'ebook_auto_grab_enabled':
          return null;
        case 'ebook_annas_archive_enabled':
          return 'false';
        case 'ebook_indexer_search_enabled':
          return 'false';
        case 'ebook_sidecar_enabled':
          return null;
        default:
          return null;
      }
    });

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-3' });

    expect(result.scanned).toBe(0);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('legacy ebook_sidecar_enabled=true (with new keys absent) passes the source gate', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      switch (key) {
        case 'ebook_auto_grab_enabled':
          return null;
        case 'ebook_annas_archive_enabled':
          return null;
        case 'ebook_indexer_search_enabled':
          return null;
        case 'ebook_sidecar_enabled':
          return 'true';
        default:
          return null;
      }
    });
    prismaMock.$queryRaw.mockResolvedValue([]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-4' });

    expect(result.scanned).toBe(0);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('processFindMissingEbooks — fresh-gap creation', () => {
  it('creates a new ebook request when no live ebook child exists (audiobook downloaded)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({
        parent_request_id: 'parent-fresh',
        user_id: 'user-x',
        audiobook_id: 'audio-x',
        audiobook_title: 'Fresh Book',
        audiobook_author: 'Some Author',
        audible_asin: 'B09ABCDEFG',
        custom_search_terms: 'cst',
      }),
    ]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-5' });

    expect(prismaMock.request.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-x',
        audiobookId: 'audio-x',
        type: 'ebook',
        parentRequestId: 'parent-fresh',
        status: 'pending',
        progress: 0,
        customSearchTerms: 'cst',
        ebookAutoRetryCount: 1,
      },
    });
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
      'new-ebook-1',
      expect.objectContaining({
        id: 'audio-x',
        title: 'Fresh Book',
        author: 'Some Author',
        asin: 'B09ABCDEFG',
      })
    );
    expect(result).toMatchObject({
      scanned: 1,
      gapsFound: 1,
      triggered: 1,
      created: 1,
      retried: 0,
      skippedInFlight: 0,
      skippedCancelled: 0,
      skippedCapHit: 0,
    });
  });

  it('also creates for audiobook in `available` state (both statuses in scope)', async () => {
    // The query is responsible for filtering by status; here we just confirm
    // that the processor doesn't add a second status guard in JS that would
    // reject a row coming back from SQL.
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({
        parent_request_id: 'parent-available',
        audiobook_title: 'Available Book',
      }),
    ]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-6' });

    expect(result.created).toBe(1);
    expect(prismaMock.request.create).toHaveBeenCalled();
  });

  it('omits asin when audiobook has no audibleAsin', async () => {
    prismaMock.$queryRaw.mockResolvedValue([baseRow({ audible_asin: null })]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    await processFindMissingEbooks({ jobId: 'job-6b' });

    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
      'new-ebook-1',
      expect.objectContaining({ asin: undefined })
    );
  });
});

describe('processFindMissingEbooks — branch skips', () => {
  it('skips when most-recent ebook child is already downloaded (defensive)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({
        ebook_request_id: 'ebook-1',
        ebook_status: 'downloaded',
        ebook_auto_retry_count: 0,
      }),
    ]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-7' });

    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    // skipped-has-companion is intentionally not surfaced as its own counter —
    // admin can derive from scanned - gapsFound - skippedInFlight - skippedCancelled - skippedCapHit.
    expect(result).toMatchObject({
      scanned: 1,
      gapsFound: 0,
      triggered: 0,
      skippedInFlight: 0,
      skippedCancelled: 0,
      skippedCapHit: 0,
    });
  });

  it.each([
    'pending',
    'awaiting_approval',
    'searching',
    'downloading',
    'processing',
    'awaiting_search',
    'awaiting_release',
  ])('skips when most-recent ebook child status is in-flight: %s', async (status) => {
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({ ebook_request_id: 'ebook-1', ebook_status: status }),
    ]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: `job-inflight-${status}` });

    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(result.skippedInFlight).toBe(1);
    expect(result.gapsFound).toBe(0);
  });

  it('skips when most-recent ebook child status is cancelled', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({ ebook_request_id: 'ebook-1', ebook_status: 'cancelled' }),
    ]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-cancelled' });

    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(result.skippedCancelled).toBe(1);
  });
});

describe('processFindMissingEbooks — retry path', () => {
  it('retries a failed ebook child with counter < cap, increments counter', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({
        ebook_request_id: 'ebook-fail-1',
        ebook_status: 'failed',
        ebook_auto_retry_count: 3,
      }),
    ]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-retry' });

    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'ebook-fail-1' },
      data: {
        status: 'pending',
        progress: 0,
        errorMessage: null,
        ebookAutoRetryCount: 4,
      },
    });
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
      'ebook-fail-1',
      expect.objectContaining({ id: 'audio-1' })
    );
    expect(result).toMatchObject({
      retried: 1,
      created: 0,
      gapsFound: 1,
      triggered: 1,
      skippedCapHit: 0,
    });
  });

  it('skips a warn ebook child whose counter is at the cap (5)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({
        ebook_request_id: 'ebook-cap',
        ebook_status: 'warn',
        ebook_auto_retry_count: 5,
      }),
    ]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-cap' });

    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(result.skippedCapHit).toBe(1);
    expect(result.retried).toBe(0);
  });

  it('retries a failed ebook child with null counter, sets counter to 1', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({
        ebook_request_id: 'ebook-null-counter',
        ebook_status: 'failed',
        ebook_auto_retry_count: null,
      }),
    ]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-null' });

    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'ebook-null-counter' },
      data: {
        status: 'pending',
        progress: 0,
        errorMessage: null,
        ebookAutoRetryCount: 1,
      },
    });
    expect(result.retried).toBe(1);
  });
});

describe('processFindMissingEbooks — error isolation', () => {
  it('rolls back the counter when addSearchEbookJob throws, then continues with next candidate', async () => {
    // Two candidates: first one's enqueue will throw, second should still process.
    prismaMock.$queryRaw.mockResolvedValue([
      baseRow({
        parent_request_id: 'parent-throw',
        audiobook_id: 'audio-throw',
        ebook_request_id: 'ebook-throw',
        ebook_status: 'failed',
        ebook_auto_retry_count: 2,
      }),
      baseRow({
        parent_request_id: 'parent-ok',
        audiobook_id: 'audio-ok',
        ebook_request_id: 'ebook-ok',
        ebook_status: 'failed',
        ebook_auto_retry_count: 0,
      }),
    ]);

    jobQueueMock.addSearchEbookJob
      .mockRejectedValueOnce(new Error('queue blew up'))
      .mockResolvedValueOnce('bull-job-id');

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-throw' });

    // Counter rolled back on the throwing candidate:
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'ebook-throw' },
      data: { ebookAutoRetryCount: { decrement: 1 } },
    });
    // Second candidate still processed:
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'ebook-ok' },
      data: {
        status: 'pending',
        progress: 0,
        errorMessage: null,
        ebookAutoRetryCount: 1,
      },
    });
    // gapsFound counts both attempted gaps; only the second succeeds in being triggered.
    expect(result.gapsFound).toBe(2);
    expect(result.retried).toBe(1);
    expect(result.created).toBe(0);
  });
});

describe('processFindMissingEbooks — return shape', () => {
  it('exposes all observable counters in the result', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
    const result = await processFindMissingEbooks({ jobId: 'job-shape' });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        scanned: 0,
        gapsFound: 0,
        triggered: 0,
        created: 0,
        retried: 0,
        skippedInFlight: 0,
        skippedCancelled: 0,
        skippedCapHit: 0,
      })
    );
  });
});
