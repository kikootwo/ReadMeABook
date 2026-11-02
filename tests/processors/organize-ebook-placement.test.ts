/**
 * Component: Ebook Organize Placement Record Tests (#497, real organizer and filesystem)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * processOrganizeFiles for an ebook request with the real FileOrganizer.organizeEbook and
 * placeFile into a temp library: Request.placedEbookFiles gets an entry only when the import
 * copied the file (copied), and stays [] when the file was already there (present, identical,
 * differs). A record failure never fails the import.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));
const organizerHolder = vi.hoisted(() => ({ media: '', temp: '' }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/file-organizer')>();
  return { ...actual, getFileOrganizer: async () => new actual.FileOrganizer(organizerHolder.media, organizerHolder.temp) };
});
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => ({ triggerLibraryScan: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({
    getAllClients: async () => [],
    getClientForProtocol: async () => null,
    getClientServiceForProtocol: async () => null,
  }),
}));

let root: string;
let source: string;
let target: string;
/** What the request row holds in placed_ebook_files before this import. */
let existingRecord: unknown;

const sha = (data: string) => createHash('sha256').update(data).digest('hex');

async function runOrganize(cleanupSource: boolean) {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({ requestId: 'req-eb', audiobookId: 'ab-1', jobId: 'job-1', downloadPath: source, cleanupSource });
}

/** The placedEbookFiles values the import wrote (one per write). */
function recordWrites(): unknown[] {
  return prismaMock.request.update.mock.calls
    .map(([args]) => (args as { data: Record<string, unknown> }).data)
    .filter((data) => 'placedEbookFiles' in data)
    .map((data) => data.placedEbookFiles);
}

function expectDelivered() {
  expect(prismaMock.request.update).toHaveBeenCalledWith({ where: { id: 'req-eb' }, data: expect.objectContaining({ status: 'downloaded' }) });
}

describe('ebook organize: placement record (real FileOrganizer + placeFile)', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-497-org-')));
    organizerHolder.media = path.join(root, 'media');
    organizerHolder.temp = path.join(root, 'tmp');
    source = path.join(root, 'downloads', 'Book');
    target = path.join(organizerHolder.media, 'Author', 'Book');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(organizerHolder.temp, { recursive: true });
    existingRecord = null;

    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args?.select?.placedEbookFiles
        ? { placedEbookFiles: existingRecord }
        : { id: 'req-eb', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' } }
    );
    prismaMock.audiobook.findUnique.mockResolvedValue({ id: 'ab-1', title: 'Book', author: 'Author', narrator: null, audibleAsin: null, year: 2020 });
    prismaMock.downloadHistory.findFirst.mockResolvedValue(null);
    prismaMock.downloadHistory.findUnique.mockResolvedValue(null);
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) => {
      if (where?.key === 'audiobook_path_template') return { value: '{author}/{title}' };
      if (where?.key === 'media_dir') return { value: organizerHolder.media };
      if (where?.key === 'download_dir') return { value: path.join(root, 'downloads') };
      return null;
    });
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue(null);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('copied: a new file in the library is recorded with its path, size and sha256', async () => {
    fs.writeFileSync(path.join(source, 'Book.epub'), 'downloaded epub');

    const result = await runOrganize(false);

    expect(result.success).toBe(true);
    expectDelivered();
    const placed = path.join(target, 'Book.epub');
    expect(fs.readFileSync(placed, 'utf8')).toBe('downloaded epub');
    expect(recordWrites()).toEqual([[{ path: placed, size: 15, sha256: sha('downloaded epub'), placedAt: expect.any(String) }]]);
  });

  it.each([
    ['present (same size, not compared)', false, 'user epub bytes', 'downloaded epub'],
    ['identical (same bytes, compared)', true, 'downloaded epub', 'downloaded epub'],
    ['differs (same size, other bytes, compared)', true, 'user epub bytes', 'downloaded epub'],
    ['differs (other size)', false, 'the user\'s own longer edition', 'downloaded epub'],
  ])('%s: the library already had the file, so the record is [] and the file is untouched', async (_label, cleanupSource, inLibrary, downloaded) => {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'Book.epub'), inLibrary);
    fs.writeFileSync(path.join(source, 'Book.epub'), downloaded);

    const result = await runOrganize(cleanupSource);

    expect(result.success).toBe(true);
    expectDelivered();
    expect(recordWrites()).toEqual([[]]);
    expect(fs.readFileSync(path.join(target, 'Book.epub'), 'utf8')).toBe(inLibrary);
  });

  it('identical in place: a Manual Import of the library copy itself records nothing', async () => {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'Book.epub'), 'library epub');
    source = target;

    const result = await runOrganize(true);

    expect(result.success).toBe(true);
    expect(recordWrites()).toEqual([[]]);
    expect(fs.readFileSync(path.join(target, 'Book.epub'), 'utf8')).toBe('library epub');
  });

  it('a later import keeps the earlier entries and adds its own; same path: newest wins', async () => {
    const earlier = { path: path.join(target, 'Book.pdf'), size: 3, sha256: sha('pdf'), placedAt: '2026-01-01T00:00:00.000Z' };
    const stale = { path: path.join(target, 'Book.epub'), size: 1, sha256: sha('x'), placedAt: '2026-01-01T00:00:00.000Z' };
    existingRecord = [earlier, stale];
    fs.writeFileSync(path.join(source, 'Book.epub'), 'downloaded epub');

    await runOrganize(false);

    expect(recordWrites()).toEqual([[earlier, { path: path.join(target, 'Book.epub'), size: 15, sha256: sha('downloaded epub'), placedAt: expect.any(String) }]]);
  });

  it('an import that placed nothing keeps the earlier entries as they are', async () => {
    const earlier = { path: path.join(target, 'Book.pdf'), size: 3, sha256: sha('pdf'), placedAt: '2026-01-01T00:00:00.000Z' };
    existingRecord = [earlier];
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'Book.epub'), 'user epub bytes');
    fs.writeFileSync(path.join(source, 'Book.epub'), 'downloaded epub');

    await runOrganize(false);

    expect(recordWrites()).toEqual([[earlier]]);
  });

  it('a record write that fails does not fail the import (the file is then never deleted by a request delete)', async () => {
    fs.writeFileSync(path.join(source, 'Book.epub'), 'downloaded epub');
    prismaMock.request.update.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      if ('placedEbookFiles' in args.data) throw new Error('db write failed');
      return {};
    });

    const result = await runOrganize(false);

    expect(result.success).toBe(true);
    expectDelivered();
    expect(fs.existsSync(path.join(target, 'Book.epub'))).toBe(true);
  });
});
