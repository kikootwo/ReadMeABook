/**
 * Component: Direct Download Name Byte Limit Tests (#474)
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createPrismaMock } from '../helpers/prisma';

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

const MAX = 255;
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

/** Run a direct download that succeeds and return the file name it was written under */
async function downloadedName(targetFilename: string, format = 'epub'): Promise<string> {
  ebookScraperMock.extractDownloadUrl.mockResolvedValue({ url: `https://direct.example.com/book.${format}`, format });

  const { processStartDirectDownload } = await import('@/lib/processors/direct-download.processor');
  const result = await processStartDirectDownload({
    requestId: 'req-474',
    downloadHistoryId: 'dh-474',
    downloadUrl: 'https://slow.example.com/book',
    targetFilename,
    jobId: 'job-474',
  });

  expect(result.success).toBe(true);
  const targetPath = createWriteStreamMock.mock.calls[0][0] as string;
  expect(path.dirname(targetPath)).toBe(path.join('/downloads'));
  expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith('req-474', 'ab-474', targetPath, undefined, undefined, undefined, 'dh-474');
  return path.basename(targetPath);
}

/** At most 255 bytes, valid UTF-8, extension kept */
function expectFits(name: string, extension: string) {
  expect(bytes(name)).toBeLessThanOrEqual(MAX);
  expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);
  expect(name.endsWith(extension)).toBe(true);
}

describe('direct download name fits in 255 bytes (#474)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'downloads_dir') return '/downloads';
      if (key === 'ebook_sidecar_base_url') return 'https://annas-archive.gl';
      if (key === 'ebook_sidecar_preferred_format') return 'epub';
      return null;
    });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    prismaMock.downloadHistory.findUnique.mockResolvedValue({ torrentUrl: JSON.stringify(['https://slow.example.com/book']) });
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-474', audiobookId: 'ab-474', audiobook: { id: 'ab-474' } });

    const writeStream = {
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') setTimeout(cb, 0);
        return writeStream;
      }),
      close: vi.fn(),
    };
    createWriteStreamMock.mockReturnValue(writeStream);
    axiosMock.mockResolvedValue({
      data: { on: vi.fn().mockReturnThis(), pipe: vi.fn().mockReturnValue(writeStream) },
      headers: { 'content-length': '1000' },
    });
    fsMock.stat.mockResolvedValue({ size: 1000 });
  });

  it('a 300-byte ASCII name is cut to 255 bytes and keeps its extension', async () => {
    const name = await downloadedName(`${'T'.repeat(295)}.epub`);

    expectFits(name, '.epub');
    expect(name).toBe(`${'T'.repeat(250)}.epub`);
  });

  it('a long CJK name is cut between characters and keeps its extension', async () => {
    const stem = '吾輩は猫である - 夏目漱石 '.repeat(10).trim(); // 149 characters, under the old 200-character cap
    const name = await downloadedName(`${stem}.epub`, 'pdf');

    expectFits(name, '.pdf');
    expect(stem.startsWith(name.slice(0, -'.pdf'.length))).toBe(true);
    expect(bytes(name)).toBeGreaterThan(MAX - 10);
  });

  it('a 255-byte name is kept whole: the old 200-character cap cut it and its extension', async () => {
    expect(await downloadedName(`${'x'.repeat(250)}.epub`)).toBe(`${'x'.repeat(250)}.epub`);
  });

  it.each([
    ['Test Book.epub', 'epub', 'Test Book.epub'],
    ['Война и мир - Лев Толстой.epub', 'fb2', 'Война и мир - Лев Толстой.fb2'],
    ['Mistborn: The <Final> Empire - Brandon   Sanderson.epub', 'epub', 'Mistborn The Final Empire - Brandon Sanderson.epub'],
  ])('unchanged when it fits: %s', async (targetFilename, format, expected) => {
    expect(await downloadedName(targetFilename, format)).toBe(expected);
  });
});
