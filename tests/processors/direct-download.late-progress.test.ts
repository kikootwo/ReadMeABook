/**
 * Component: Direct Download, a late progress write on a processing request (#216)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * The stream's progress write is fire-and-forget, so it can land after the
 * `processing`/100 hand-off. A processing request below 100 reads "Merging
 * chapters N%", so the write is filtered to `downloading`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { fakeRequestRow } from '../helpers/request-row-fake';

const prismaMock = createPrismaMock();
const configServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({
  addOrganizeJob: vi.fn(() => Promise.resolve()),
  addMonitorDirectDownloadJob: vi.fn(() => Promise.resolve()),
}));
const ebookScraperMock = vi.hoisted(() => ({ extractDownloadUrl: vi.fn() }));
const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));
const axiosMock = vi.hoisted(() => vi.fn());
const createWriteStreamMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/ebook-scraper', () => ebookScraperMock);
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('fs', () => ({ createWriteStream: createWriteStreamMock }));
vi.mock('axios', () => ({ default: axiosMock }));

describe('direct download: stream progress write (#216)', () => {
  let clock = 1_000_000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    configServiceMock.get.mockResolvedValue(null);
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.findUnique.mockResolvedValue({ torrentUrl: JSON.stringify(['https://slow.example.com/book']) });
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', audiobookId: 'ab-1', audiobook: { id: 'ab-1' } });
    ebookScraperMock.extractDownloadUrl.mockResolvedValue({ url: 'https://direct.example.com/book.epub', format: 'epub' });
    fsMock.stat.mockResolvedValue({ size: 1000 });

    const writeStream = {
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') setTimeout(cb, 0);
        return writeStream;
      }),
      close: vi.fn(),
    };
    createWriteStreamMock.mockReturnValue(writeStream);
    let onData: (chunk: Buffer) => void = () => {};
    const data = {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') onData = cb;
        return data;
      }),
      // Half the file arrives 5 s in: the stream queues a 50% progress write
      pipe: vi.fn(() => {
        clock += 5000;
        onData(Buffer.alloc(500));
        return writeStream;
      }),
    };
    axiosMock.mockResolvedValue({ data, headers: { 'content-length': '1000' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a progress write that lands after the processing hand-off changes nothing', async () => {
    const fake = fakeRequestRow(
      prismaMock.request,
      { id: 'req-1', status: 'pending', progress: 0, deletedAt: null },
      { holdProgressOnlyWrites: true }
    );
    const { processStartDirectDownload } = await import('@/lib/processors/direct-download.processor');

    await expect(processStartDirectDownload({
      requestId: 'req-1',
      downloadHistoryId: 'dh-1',
      downloadUrl: 'https://slow.example.com/book',
      targetFilename: 'Book.epub',
      jobId: 'job-1',
    })).resolves.toMatchObject({ success: true });
    expect(fake.row).toMatchObject({ status: 'processing', progress: 100 });

    await expect(fake.releaseHeld()).resolves.toBe(1); // the 50% write lands now

    expect(fake.row).toMatchObject({ status: 'processing', progress: 100 });
  });
});
