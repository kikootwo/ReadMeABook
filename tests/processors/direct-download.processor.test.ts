/**
 * Component: Direct Download Processor Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

const jobQueueMock = vi.hoisted(() => ({
  addOrganizeJob: vi.fn(() => Promise.resolve()),
  addMonitorDirectDownloadJob: vi.fn(() => Promise.resolve()),
}));

const ebookScraperMock = vi.hoisted(() => ({
  extractDownloadUrl: vi.fn(),
}));

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

const axiosMock = vi.hoisted(() => vi.fn());

const createWriteStreamMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/ebook-scraper', () => ebookScraperMock);

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock('fs', () => ({
  createWriteStream: createWriteStreamMock,
}));

vi.mock('axios', () => ({
  default: axiosMock,
}));

describe('processStartDirectDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'downloads_dir') return '/downloads';
      if (key === 'ebook_sidecar_base_url') return 'https://annas-archive.gl';
      if (key === 'ebook_sidecar_preferred_format') return 'epub';
      return null;
    });
  });

  it('updates request status to downloading', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.findUnique.mockResolvedValue({
      torrentUrl: JSON.stringify(['https://slow.example.com/book']),
    });

    // Mock successful download
    ebookScraperMock.extractDownloadUrl.mockResolvedValue({
      url: 'https://direct.example.com/book.epub',
      format: 'epub',
    });

    // Mock axios stream
    const mockWriteStream = {
      on: vi.fn((event, cb) => {
        if (event === 'finish') setTimeout(cb, 10);
        return mockWriteStream;
      }),
      close: vi.fn(),
    };
    createWriteStreamMock.mockReturnValue(mockWriteStream);

    const mockDataStream = {
      on: vi.fn().mockReturnThis(),
      pipe: vi.fn().mockReturnValue(mockWriteStream),
    };
    axiosMock.mockResolvedValue({
      data: mockDataStream,
      headers: { 'content-length': '1000000' },
    });

    fsMock.stat.mockResolvedValue({ size: 1000000 });
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1',
      audiobookId: 'ab-1',
      audiobook: { id: 'ab-1' },
    });

    const { processStartDirectDownload } = await import('@/lib/processors/direct-download.processor');

    const result = await processStartDirectDownload({
      requestId: 'req-1',
      downloadHistoryId: 'dh-1',
      downloadUrl: 'https://slow.example.com/book',
      targetFilename: 'Test Book.epub',
      jobId: 'job-1',
    });

    // Check status updates
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: expect.objectContaining({
        status: 'downloading',
        progress: 0,
      }),
    });

    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({
      where: { id: 'dh-1' },
      data: expect.objectContaining({
        downloadStatus: 'downloading',
      }),
    });
  });

  it('triggers organize job after successful download', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.findUnique.mockResolvedValue({
      torrentUrl: JSON.stringify(['https://slow.example.com/book']),
    });

    ebookScraperMock.extractDownloadUrl.mockResolvedValue({
      url: 'https://direct.example.com/book.epub',
      format: 'epub',
    });

    const mockWriteStream = {
      on: vi.fn((event, cb) => {
        if (event === 'finish') setTimeout(cb, 10);
        return mockWriteStream;
      }),
      close: vi.fn(),
    };
    createWriteStreamMock.mockReturnValue(mockWriteStream);

    const mockDataStream = {
      on: vi.fn().mockReturnThis(),
      pipe: vi.fn().mockReturnValue(mockWriteStream),
    };
    axiosMock.mockResolvedValue({
      data: mockDataStream,
      headers: { 'content-length': '500000' },
    });

    fsMock.stat.mockResolvedValue({ size: 500000 });
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-2',
      audiobookId: 'ab-2',
      audiobook: { id: 'ab-2' },
    });

    const { processStartDirectDownload } = await import('@/lib/processors/direct-download.processor');

    const result = await processStartDirectDownload({
      requestId: 'req-2',
      downloadHistoryId: 'dh-2',
      downloadUrl: 'https://slow.example.com/book2',
      targetFilename: 'Another Book.epub',
      jobId: 'job-2',
    });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-2',
      'ab-2',
      expect.stringContaining('Another Book.epub')
    );
  });

  it('marks request as failed when all download attempts fail', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.findUnique.mockResolvedValue({
      torrentUrl: JSON.stringify([
        'https://slow1.example.com/book',
        'https://slow2.example.com/book',
      ]),
    });

    // All extract attempts fail
    ebookScraperMock.extractDownloadUrl.mockResolvedValue(null);

    const { processStartDirectDownload } = await import('@/lib/processors/direct-download.processor');

    const result = await processStartDirectDownload({
      requestId: 'req-3',
      downloadHistoryId: 'dh-3',
      downloadUrl: 'https://slow1.example.com/book',
      targetFilename: 'Failed Book.epub',
      jobId: 'job-3',
    });

    expect(result.success).toBe(false);
    // Verify the second call (final failure status update)
    expect(prismaMock.request.update).toHaveBeenLastCalledWith({
      where: { id: 'req-3' },
      data: expect.objectContaining({
        status: 'failed',
      }),
    });
    expect(prismaMock.downloadHistory.update).toHaveBeenLastCalledWith({
      where: { id: 'dh-3' },
      data: expect.objectContaining({
        downloadStatus: 'failed',
      }),
    });
  });

  it('uses FlareSolverr when configured', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.findUnique.mockResolvedValue({
      torrentUrl: JSON.stringify(['https://slow.example.com/book']),
    });

    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'downloads_dir') return '/downloads';
      if (key === 'ebook_sidecar_base_url') return 'https://annas-archive.gl';
      if (key === 'ebook_sidecar_preferred_format') return 'epub';
      if (key === 'ebook_sidecar_flaresolverr_url') return 'http://flaresolverr:8191';
      return null;
    });

    ebookScraperMock.extractDownloadUrl.mockResolvedValue({
      url: 'https://direct.example.com/book.epub',
      format: 'epub',
    });

    const mockWriteStream = {
      on: vi.fn((event, cb) => {
        if (event === 'finish') setTimeout(cb, 10);
        return mockWriteStream;
      }),
      close: vi.fn(),
    };
    createWriteStreamMock.mockReturnValue(mockWriteStream);

    const mockDataStream = {
      on: vi.fn().mockReturnThis(),
      pipe: vi.fn().mockReturnValue(mockWriteStream),
    };
    axiosMock.mockResolvedValue({
      data: mockDataStream,
      headers: { 'content-length': '500000' },
    });

    fsMock.stat.mockResolvedValue({ size: 500000 });
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-4',
      audiobookId: 'ab-4',
      audiobook: { id: 'ab-4' },
    });

    const { processStartDirectDownload } = await import('@/lib/processors/direct-download.processor');

    await processStartDirectDownload({
      requestId: 'req-4',
      downloadHistoryId: 'dh-4',
      downloadUrl: 'https://slow.example.com/book',
      targetFilename: 'Flare Book.epub',
      jobId: 'job-4',
    });

    expect(ebookScraperMock.extractDownloadUrl).toHaveBeenCalledWith(
      'https://slow.example.com/book',
      'https://annas-archive.gl',
      'epub',
      expect.anything(),
      'http://flaresolverr:8191'
    );
  });

  it('handles errors and updates request status', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.findUnique.mockRejectedValue(new Error('Database error'));

    const { processStartDirectDownload } = await import('@/lib/processors/direct-download.processor');

    await expect(processStartDirectDownload({
      requestId: 'req-5',
      downloadHistoryId: 'dh-5',
      downloadUrl: 'https://slow.example.com/book',
      targetFilename: 'Error Book.epub',
      jobId: 'job-5',
    })).rejects.toThrow('Database error');

    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-5' },
      data: expect.objectContaining({
        status: 'failed',
        errorMessage: 'Database error',
      }),
    });
  });
});

describe('processMonitorDirectDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns completed status when download file exists', async () => {
    fsMock.stat.mockResolvedValue({ size: 1000000 });
    prismaMock.request.update.mockResolvedValue({});

    const { processMonitorDirectDownload } = await import('@/lib/processors/direct-download.processor');

    const result = await processMonitorDirectDownload({
      requestId: 'req-m1',
      downloadHistoryId: 'dh-m1',
      downloadId: 'dl_unknown',
      targetPath: '/downloads/book.epub',
      expectedSize: 1000000,
      jobId: 'job-m1',
    });

    expect(result.success).toBe(true);
    expect(result.completed).toBe(true);
  });

  it('returns not found when download is not tracked', async () => {
    fsMock.stat.mockRejectedValue(new Error('ENOENT'));

    const { processMonitorDirectDownload } = await import('@/lib/processors/direct-download.processor');

    const result = await processMonitorDirectDownload({
      requestId: 'req-m2',
      downloadHistoryId: 'dh-m2',
      downloadId: 'dl_missing',
      targetPath: '/downloads/missing.epub',
      expectedSize: 500000,
      jobId: 'job-m2',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});
