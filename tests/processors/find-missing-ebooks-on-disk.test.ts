/**
 * Component: Find Missing Ebooks Processor Tests, an ebook already on disk (#313)
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
/** Audiobook rows the "other book in this folder" lookup reads (filtered like the real query). */
let books: Array<{ id: string; filePath: string | null }> = [];

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));

let root: string;

async function bookFolder(files: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(root, 'book-'));
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), 'x');
  }
  return dir;
}

const row = (filePath: string | null, overrides: Record<string, unknown> = {}) => ({
  parent_request_id: 'parent-1',
  user_id: 'user-1',
  audiobook_id: 'audio-1',
  custom_search_terms: null,
  audiobook_title: 'Test Book',
  audiobook_author: 'Test Author',
  audible_asin: 'ASIN0001',
  audiobook_file_path: filePath,
  ebook_request_id: null,
  ebook_status: null,
  ebook_auto_retry_count: null,
  ...overrides,
});

async function run(rows: unknown[]) {
  prismaMock.$queryRaw.mockResolvedValue(rows);
  const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
  return processFindMissingEbooks({ jobId: 'job-313' });
}

beforeEach(async () => {
  vi.clearAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-313-'));
  configMock.get.mockImplementation(async (key: string) => (key === 'ebook_annas_archive_enabled' ? 'true' : null));
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
  prismaMock.request.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'new-ebook-1', ...args.data }));
  prismaMock.request.update.mockResolvedValue({});
  jobQueueMock.addSearchEbookJob.mockResolvedValue(undefined);
  books = [];
  prismaMock.audiobook.findMany.mockImplementation(async (args: { where?: { id?: { not?: string } } }) =>
    books.filter((book) => book.filePath !== null && book.id !== args?.where?.id?.not)
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('processFindMissingEbooks with an ebook already in the book folder', () => {
  it.each([
    ['an epub', ['01.mp3', '02.mp3', 'Book.epub']],
    ['an azw3', ['01.mp3', '02.mp3', 'Book.azw3']],
  ])('creates no ebook request and fetches nothing for %s next to the mp3s', async (_label, files) => {
    const dir = await bookFolder(files);
    const result = await run([row(dir)]);

    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, gapsFound: 0, triggered: 0, created: 0, skippedOnDisk: 1 });
    // The user's file is left exactly where it was
    expect((await fs.readdir(dir)).sort()).toEqual([...files].sort());
  });

  it('does not retry a failed ebook request once a file is on disk', async () => {
    const dir = await bookFolder(['01.mp3', 'Book.epub']);
    const result = await run([
      row(dir, { ebook_request_id: 'ebook-1', ebook_status: 'failed', ebook_auto_retry_count: 1 }),
    ]);

    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 0, triggered: 0, skippedOnDisk: 1 });
  });

  it('leaves an in-flight ebook request alone when a file is on disk', async () => {
    const dir = await bookFolder(['01.mp3', 'Book.epub']);
    const result = await run([row(dir, { ebook_request_id: 'ebook-1', ebook_status: 'awaiting_search' })]);

    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ triggered: 0, skippedInFlight: 1 });
  });
});

describe('processFindMissingEbooks without an ebook in the book folder (as before)', () => {
  it.each([
    ['an empty folder', async () => bookFolder([])],
    ['a missing folder', async () => path.join(root, 'gone')],
    ['a folder with only audio', async () => bookFolder(['01.mp3', '02.mp3', 'cover.jpg'])],
    ['an ebook only in a subfolder', async () => bookFolder(['01.mp3', 'Other/Other.epub'])],
    ['no folder on record', async () => null],
  ])('creates the ebook request and fetches for %s', async (_label, makePath) => {
    const result = await run([row(await makePath())]);

    expect(prismaMock.request.create).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('new-ebook-1', expect.objectContaining({ id: 'audio-1' }));
    expect(result).toMatchObject({ created: 1, triggered: 1 });
  });

  it('retries a failed ebook request when the folder holds only audio', async () => {
    const dir = await bookFolder(['01.mp3']);
    const result = await run([
      row(dir, { ebook_request_id: 'ebook-1', ebook_status: 'failed', ebook_auto_retry_count: 1 }),
    ]);

    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('ebook-1', expect.anything());
    expect(result).toMatchObject({ retried: 1 });
  });

  it('reads the book folder from the audiobook row in the candidate query', async () => {
    await run([]);
    const sql = (prismaMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/a\.file_path\s+AS audiobook_file_path/);
  });
});

describe('processFindMissingEbooks with a PDF in the book folder', () => {
  it('fetches when a PDF booklet is the only ebook-type file', async () => {
    const dir = await bookFolder(['01.mp3', 'Companion Booklet.pdf', 'cover.jpg']);
    const result = await run([row(dir)]);

    expect(prismaMock.request.create).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('new-ebook-1', expect.objectContaining({ id: 'audio-1' }));
    expect(result).toMatchObject({ created: 1, triggered: 1, skippedOnDisk: 0 });
  });

  it('skips when an epub sits beside the PDF', async () => {
    const dir = await bookFolder(['01.mp3', 'Companion Booklet.pdf', 'Book.epub']);
    const result = await run([row(dir)]);

    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: 0, triggered: 0, skippedOnDisk: 1 });
  });
});

describe('processFindMissingEbooks with two books in one folder', () => {
  it("still creates the second book's ebook request when the first book's ebook is in the folder", async () => {
    const dir = await bookFolder(['A - 01.mp3', 'A.epub', 'B - 01.mp3']);
    books = [{ id: 'audio-A', filePath: dir }, { id: 'audio-B', filePath: dir }];
    const result = await run([
      row(dir, {
        parent_request_id: 'parent-A',
        audiobook_id: 'audio-A',
        audiobook_title: 'Book A',
        ebook_request_id: 'ebook-A',
        ebook_status: 'downloaded',
      }),
      row(dir, { parent_request_id: 'parent-B', audiobook_id: 'audio-B', audiobook_title: 'Book B' }),
    ]);

    expect(prismaMock.request.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ audiobookId: 'audio-B', parentRequestId: 'parent-B' }) })
    );
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('new-ebook-1', expect.objectContaining({ id: 'audio-B' }));
    expect(result).toMatchObject({ scanned: 2, created: 1, triggered: 1, skippedOnDisk: 0 });
  });
});
