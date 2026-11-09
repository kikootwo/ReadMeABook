/**
 * Component: Direct Download Processor Tests - a cancel sticks
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Fails on main: the direct ebook download wrote 'downloading' and then 'processing' by id,
 * undoing a cancel and importing the book anyway.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configServiceMock = vi.hoisted(() => ({ get: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addOrganizeJob: vi.fn(() => Promise.resolve()) }));
const ebookScraperMock = vi.hoisted(() => ({ extractDownloadUrl: vi.fn() }));
const fsMock = vi.hoisted(() => ({ mkdir: vi.fn(), stat: vi.fn(), unlink: vi.fn() }));
const axiosMock = vi.hoisted(() => vi.fn());
const createWriteStreamMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/ebook-scraper', () => ebookScraperMock);
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('fs', () => ({ createWriteStream: createWriteStreamMock }));
vi.mock('axios', () => ({ default: axiosMock }));

const job = { requestId: 'req-1', downloadHistoryId: 'dh-1', downloadUrl: 'https://slow.example.com/b', targetFilename: 'B.epub', jobId: 'j' };

beforeEach(() => {
  vi.clearAllMocks();
  configServiceMock.get.mockResolvedValue(null);
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.stat.mockResolvedValue({ size: 10 });
  prismaMock.downloadHistory.update.mockResolvedValue({});
  prismaMock.downloadHistory.findUnique.mockResolvedValue({ torrentUrl: JSON.stringify([job.downloadUrl]) });
  prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', audiobookId: 'ab-1' });
  ebookScraperMock.extractDownloadUrl.mockResolvedValue({ url: 'https://direct.example.com/b.epub', format: 'epub' });
  const writer: any = { on: vi.fn((event: string, cb: () => void) => { if (event === 'finish') setTimeout(cb, 0); return writer; }), close: vi.fn() };
  createWriteStreamMock.mockReturnValue(writer);
  axiosMock.mockResolvedValue({ data: { on: vi.fn().mockReturnThis(), pipe: vi.fn() }, headers: { 'content-length': '10' } });
});

async function run() {
  const { processStartDirectDownload } = await import('@/lib/processors/direct-download.processor');
  return processStartDirectDownload(job);
}

describe('processStartDirectDownload and a cancel', () => {
  it('a request cancelled before the download starts: nothing is downloaded and the status is not touched', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });

    const result = await run();

    expect(result).toMatchObject({ success: true });
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', deletedAt: null, status: { not: 'cancelled' } },
      data: expect.objectContaining({ status: 'downloading' }),
    });
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(axiosMock).not.toHaveBeenCalled();
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('a request cancelled during the download: not flipped to processing, not imported', async () => {
    prismaMock.request.updateMany
      .mockResolvedValueOnce({ count: 1 }) // downloading
      .mockResolvedValue({ count: 0 }); // processing: cancelled meanwhile

    const result = await run();

    expect(result).toMatchObject({ success: true });
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'req-1', deletedAt: null, status: { not: 'cancelled' } },
      data: expect.objectContaining({ status: 'processing' }),
    });
    expect(prismaMock.request.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: expect.any(String) }) }));
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });
});
