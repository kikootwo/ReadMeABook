/**
 * Component: Search Ebook Processor Refused Status Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * A paced ebook search can wait in the queue while another search (RSS monitor,
 * fetch-ebook, manual search) downloads the book. Like the audiobook search
 * (#591), the job then refuses a request already past searching: no status
 * write, no second downloadHistory row, no second download (#601).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  getAudibleRegion: vi.fn().mockResolvedValue('us'),
}));

const jobQueueMock = vi.hoisted(() => ({
  addStartDirectDownloadJob: vi.fn(() => Promise.resolve()),
  addDownloadJob: vi.fn(() => Promise.resolve()),
}));

const ebookScraperMock = vi.hoisted(() => ({
  searchByAsin: vi.fn(),
  searchByTitle: vi.fn(),
  getSlowDownloadLinks: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/ebook-scraper', () => ebookScraperMock);

type StatusFilter = { not?: string; notIn?: string[]; in?: string[] };

/** One request row; updateMany applies its status filter the way the database does */
const row = { status: 'pending', deletedAt: null as Date | null };

function matches(filter: StatusFilter): boolean {
  if (filter.not !== undefined) return row.status !== filter.not;
  if (filter.notIn) return !filter.notIn.includes(row.status);
  if (filter.in) return filter.in.includes(row.status);
  return true;
}

async function runSearch() {
  const { processSearchEbook } = await import('@/lib/processors/search-ebook.processor');
  return processSearchEbook({
    requestId: 'req-1',
    audiobook: { id: 'ab-1', title: 'Paced Book', author: 'Jane Writer', asin: 'B00PACED1' },
    jobId: 'job-1',
  });
}

describe('processSearchEbook refuses a request past searching (#601)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row.status = 'pending';
    row.deletedAt = null;
    prismaMock.request.updateMany.mockImplementation(async ({ where, data }: { where: { status?: StatusFilter }; data: { status?: string } }) => {
      if (row.deletedAt !== null || !matches(where.status ?? {})) return { count: 0 };
      if (data.status) row.status = data.status;
      return { count: 1 };
    });
    prismaMock.request.update.mockImplementation(async ({ data }: { data: { status?: string } }) => {
      if (data.status) row.status = data.status;
      return { ...row };
    });
    prismaMock.request.findUnique.mockImplementation(async () => ({
      id: 'req-1', ...row, customSearchTerms: null, parentRequest: null,
    }));
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
    prismaMock.downloadHistory.update.mockResolvedValue({});
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'ebook_sidecar_preferred_format') return 'epub';
      if (key === 'ebook_annas_archive_enabled') return 'true';
      if (key === 'ebook_indexer_search_enabled') return 'false';
      return null;
    });
    ebookScraperMock.searchByAsin.mockResolvedValue('md5paced');
    ebookScraperMock.getSlowDownloadLinks.mockResolvedValue(['https://slow.example.com/paced']);
  });

  it.each(['downloading', 'available'])('leaves a request now %s and its download alone', async (status) => {
    row.status = status;

    const result = await runSearch();

    expect(result).toEqual(expect.objectContaining({ success: true, requestId: 'req-1' }));
    expect(result.message).toContain(`is ${status}`);
    expect(row.status).toBe(status);
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(ebookScraperMock.searchByAsin).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addStartDirectDownloadJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('still searches and downloads a pending request', async () => {
    const result = await runSearch();

    expect(result.success).toBe(true);
    expect(ebookScraperMock.searchByAsin).toHaveBeenCalled();
    expect(prismaMock.downloadHistory.create).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addStartDirectDownloadJob).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('searching');
  });

  it('does not write awaiting_search over a download that started during the search', async () => {
    // Another search picks a release while this one is still looking; this one finds nothing
    ebookScraperMock.searchByAsin.mockImplementation(async () => {
      row.status = 'downloading';
      return null;
    });
    ebookScraperMock.searchByTitle.mockResolvedValue(null);

    const result = await runSearch();

    expect(row.status).toBe('downloading');
    expect(result).toEqual(expect.objectContaining({ success: true, requestId: 'req-1' }));
    expect(result.message).toContain('not re-queued');
    expect(prismaMock.request.update).not.toHaveBeenCalled();
  });
});
