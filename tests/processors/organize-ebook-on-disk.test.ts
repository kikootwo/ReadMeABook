/**
 * Component: Organize Files Processor Tests, automatic ebook request after an audiobook import (#313)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * The audiobook organize creates an ebook request when auto-grab is on, unless the
 * book folder already holds an ebook file (real folders; the organizer is mocked).
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const organizerMock = vi.hoisted(() => ({ organize: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({
  addNotificationJob: vi.fn(() => Promise.resolve()),
  addSearchEbookJob: vi.fn(() => Promise.resolve()),
}));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', () => ({ getFileOrganizer: () => organizerMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => ({ triggerLibraryScan: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: vi.fn(async () => null) }),
}));
vi.mock('@/lib/utils/format-coercion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/format-coercion')>()),
  coerceToPlexCompatible: vi.fn(async (paths: string[]) => ({ renamed: [], warnings: [], errors: [], finalAudioFiles: paths })),
}));

let root: string;

async function bookFolder(files: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(root, 'book-'));
  for (const file of files) await fs.writeFile(path.join(dir, file), 'x');
  return dir;
}

async function organizeInto(targetPath: string) {
  organizerMock.organize.mockResolvedValue({
    success: true,
    targetPath,
    filesMovedCount: 1,
    errors: [],
    audioFiles: [path.join(targetPath, '01.mp3')],
  });
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({ requestId: 'req-1', audiobookId: 'a1', downloadPath: path.join(root, 'dl'), jobId: 'job-1' });
}

const ebookCreates = () =>
  prismaMock.request.create.mock.calls.filter(([args]) => (args as { data?: { type?: string } })?.data?.type === 'ebook');

describe('automatic ebook request after an audiobook import', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-313-org-'));
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', type: 'audiobook', userId: 'user-1', user: { plexUsername: 'u' } });
    prismaMock.request.findFirst.mockResolvedValue(null);
    prismaMock.request.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'ebook-new', ...args.data }));
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a1', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: 'ASIN1',
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockImplementation(async (key: string) => (key === 'ebook_annas_archive_enabled' ? 'true' : null));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([
    ['an epub', ['01.mp3', '02.mp3', 'Book.epub']],
    ['an azw3', ['01.mp3', '02.mp3', 'Book.azw3']],
  ])('creates no ebook request and fetches nothing when the folder already holds %s', async (_label, files) => {
    const dir = await bookFolder(files);
    const result = await organizeInto(dir);

    expect(result.success).toBe(true);
    expect(ebookCreates()).toHaveLength(0);
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect((await fs.readdir(dir)).sort()).toEqual([...files].sort());
  });

  it.each([
    ['an empty folder', []],
    ['a folder with only audio', ['01.mp3', '02.mp3', 'cover.jpg']],
  ])('creates the ebook request and fetches for %s (as before)', async (_label, files) => {
    const dir = await bookFolder(files);
    await organizeInto(dir);

    expect(ebookCreates()).toHaveLength(1);
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('ebook-new', expect.objectContaining({ id: 'a1' }));
  });

  it('creates the ebook request and fetches when the folder is missing (as before)', async () => {
    await organizeInto(path.join(root, 'gone'));

    expect(ebookCreates()).toHaveLength(1);
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledTimes(1);
  });
});
