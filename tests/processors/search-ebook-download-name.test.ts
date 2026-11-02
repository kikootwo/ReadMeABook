/**
 * Component: E-book Direct Download Name from the Automatic Search (#474)
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configServiceMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addStartDirectDownloadJob: vi.fn(() => Promise.resolve()) }));
const ebookScraperMock = vi.hoisted(() => ({
  searchByAsin: vi.fn(),
  searchByTitle: vi.fn(),
  getSlowDownloadLinks: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/ebook-scraper', () => ebookScraperMock);

async function queuedName(title: string, author: string, format = 'epub'): Promise<string> {
  configServiceMock.get.mockImplementation(async (key: string) => {
    if (key === 'ebook_sidecar_preferred_format') return format;
    if (key === 'ebook_sidecar_base_url') return 'https://annas-archive.gl';
    if (key === 'ebook_annas_archive_enabled') return 'true';
    if (key === 'ebook_indexer_search_enabled') return 'false';
    return null;
  });

  const { processSearchEbook } = await import('@/lib/processors/search-ebook.processor');
  const result = await processSearchEbook({
    requestId: 'req-1',
    audiobook: { id: 'ab-1', title, author, asin: 'B001ASIN' },
    jobId: 'job-1',
  });

  expect(result.success).toBe(true);
  return jobQueueMock.addStartDirectDownloadJob.mock.calls[0][3] as string;
}

describe('automatic ebook search: queued download name (#474)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
    prismaMock.downloadHistory.update.mockResolvedValue({});
    ebookScraperMock.searchByAsin.mockResolvedValue('abc123md5');
    ebookScraperMock.getSlowDownloadLinks.mockResolvedValue(['https://slow1.example.com/abc123']);
  });

  it('a long Cyrillic title is cut and the author kept whole', async () => {
    const author = 'Фёдор Михайлович Достоевский'; // 54 bytes
    // 255 - '.epub' - ' - ' - author = 193 bytes of title: 96 letters
    expect(await queuedName('Ж'.repeat(150), author)).toBe(`${'Ж'.repeat(96)} - ${author}.epub`);
  });

  it('a shorter queued extension leaves room for any extension the downloader swaps in', async () => {
    const name = await queuedName('吾輩は猫である'.repeat(20), '夏目漱石', 'pdf');
    // '.pdf' is queued but '.epub' may be found: 254 bytes leave room for it
    expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(254);
    expect(name.endsWith(' - 夏目漱石.pdf')).toBe(true);
  });

  it('a name that fits is queued unchanged', async () => {
    expect(await queuedName('Test Book', 'Test Author')).toBe('Test Book - Test Author.epub');
  });
});
