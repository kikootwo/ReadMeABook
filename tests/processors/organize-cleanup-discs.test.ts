/**
 * Component: Manual Import "remove source" on multi-disc folders (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * processOrganizeFiles end to end with the REAL organizer (merge and tagging
 * off) on real temp folders, so a wrong delete shows up as a missing file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => ({ triggerLibraryScan: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }),
}));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({
    getAllClients: async () => [],
    getClientForProtocol: async () => null,
    getClientServiceForProtocol: async () => null,
  }),
}));
vi.mock('@/lib/utils/format-coercion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/format-coercion')>()),
  coerceToPlexCompatible: vi.fn(async (paths: string[]) => ({ renamed: [], warnings: [], errors: [], finalAudioFiles: paths })),
}));
vi.mock('@/lib/utils/audio-duration', () => ({ probeStreamDurationMs: vi.fn(async () => 60000) }));
vi.mock('@/lib/utils/chapter-merger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/chapter-merger')>()),
  probeAudioFile: vi.fn(async () => ({ duration: 1000 })),
}));

let root: string;
let downloads: string;
let media: string;
let book: string;
let target: string;

function mkfile(rel: string, base = book, content?: string): string {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content ?? `bytes of ${rel}`);
  return full;
}

function listAll(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

const DISC_FILES = ['Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 2/01.m4a', 'Disc 2/02.m4a'];

async function runOrganize(payload: Record<string, unknown>) {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({
    requestId: 'req-1', audiobookId: 'a1', jobId: 'job-1', downloadPath: book, ...payload,
  } as Parameters<typeof processOrganizeFiles>[0]);
}

describe('remove source after a multi-disc manual import', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-cleanup-discs-')));
    downloads = path.join(root, 'downloads');
    media = path.join(root, 'media');
    book = path.join(downloads, 'Book [B0E2E43401]');
    target = path.join(media, 'Author', 'Book');
    fs.mkdirSync(media, { recursive: true });
    DISC_FILES.forEach((f) => mkfile(f));
    ['Extras/bonus.m4a', 'Disc 1/Disc 1.cue', 'Disc 2/playlist.m3u', 'Disc 1/cover.jpg', 'folder.jpg'].forEach((f) => mkfile(f));

    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', userId: 'u1', type: 'audiobook', user: { plexUsername: 't' } });
    prismaMock.request.findFirst.mockResolvedValue({ id: 'req-1', importAttempts: 0, maxImportRetries: 3 });
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a1', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: null, year: 2020,
    });
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) => {
      if (where?.key === 'media_dir') return { value: media };
      if (where?.key === 'download_dir') return { value: downloads };
      if (where?.key === 'audiobook_path_template') return { value: '{author}/{title}' };
      return null;
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'download_dir') return downloads;
      if (key === 'media_dir') return media;
      return null;
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes only the verified disc files; Extras, cue/m3u, covers and the library stay', async () => {
    const result = await runOrganize({ cleanupSource: true, selectedFiles: DISC_FILES });
    expect(result.success).toBe(true);
    expect(listAll(target)).toEqual(['Disc 1-01.m4a', 'Disc 1-02.m4a', 'Disc 2-01.m4a', 'Disc 2-02.m4a', 'cover.jpg']);
    // Empty disc folders are left behind; everything that is not a selected disc file stays
    expect(listAll(book)).toEqual(['Disc 1/Disc 1.cue', 'Disc 1/cover.jpg', 'Disc 2/playlist.m3u', 'Extras/bonus.m4a', 'folder.jpg']);
  });

  it('keeps a source whose library copy differs, and never touches the library file', async () => {
    mkfile('Disc 2-01.m4a', target, 'the library has other bytes');
    const result = await runOrganize({ cleanupSource: true, selectedFiles: DISC_FILES });
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(target, 'Disc 2-01.m4a'), 'utf8')).toBe('the library has other bytes');
    expect(fs.existsSync(path.join(book, 'Disc 2', '01.m4a'))).toBe(true);
    expect(fs.existsSync(path.join(book, 'Disc 1', '01.m4a'))).toBe(false);
  });

  it("selected '/' entries match the organizer's walk on this platform's separators", async () => {
    await runOrganize({ cleanupSource: true, selectedFiles: ['Disc 2/02.m4a', 'Disc 1/01.m4a'] });
    expect(listAll(target)).toEqual(['01.m4a', '02.m4a', 'cover.jpg']);
    expect(fs.existsSync(path.join(book, 'Disc 1', '01.m4a'))).toBe(false);
    expect(fs.existsSync(path.join(book, 'Disc 2', '02.m4a'))).toBe(false);
    expect(fs.existsSync(path.join(book, 'Disc 1', '02.m4a'))).toBe(true);
  });

  it('an in-place import of the library folder stops with nothing changed and nothing removed', async () => {
    DISC_FILES.forEach((f) => mkfile(f, target));
    const before = listAll(target);
    const result = await runOrganize({ downloadPath: target, cleanupSource: true, selectedFiles: DISC_FILES });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/nothing was changed/);
    expect(listAll(target)).toEqual(before);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
  });

  it.each([
    ['one disc of the library folder', ['Disc 1/01.m4a', 'Disc 1/02.m4a']],
    ['a root file plus one disc', ['Intro.m4a', 'Disc 2/01.m4a']],
  ])('%s, remove source on: stops with nothing changed and nothing removed', async (_label, selectedFiles) => {
    [...DISC_FILES, 'Intro.m4a'].forEach((f) => mkfile(f, target));
    const before = listAll(target);
    const result = await runOrganize({ downloadPath: target, cleanupSource: true, selectedFiles });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/nothing was changed/);
    expect(listAll(target)).toEqual(before);
  });

  it('one disc from a download folder (not in place) still imports and removes just those files', async () => {
    const result = await runOrganize({ cleanupSource: true, selectedFiles: ['Disc 1/01.m4a', 'Disc 1/02.m4a'] });
    expect(result.success).toBe(true);
    expect(listAll(target)).toEqual(['01.m4a', '02.m4a', 'cover.jpg']);
    expect(fs.existsSync(path.join(book, 'Disc 1', '01.m4a'))).toBe(false);
    expect(fs.existsSync(path.join(book, 'Disc 2', '01.m4a'))).toBe(true);
  });
});
