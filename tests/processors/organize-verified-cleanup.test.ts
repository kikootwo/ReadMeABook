/**
 * Component: Verified-Import Cleanup Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * processOrganizeFiles with the organizer mocked to return explicit placement
 * records: cleanup must remove only what those records prove reached the
 * library, and must re-check the source just before removing it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const organizerMock = vi.hoisted(() => ({ organize: vi.fn(), organizeEbook: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));
const postProcess = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', () => ({ getFileOrganizer: () => organizerMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => ({ triggerLibraryScan: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/format-coercion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/format-coercion')>()),
  coerceToPlexCompatible: vi.fn(async (paths: string[]) => ({ renamed: [], warnings: [], errors: [], finalAudioFiles: paths })),
}));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({
    getAllClients: async () => [],
    getClientForProtocol: async () => null,
    getClientServiceForProtocol: async () => ({ clientType: 'sabnzbd', postProcess }),
  }),
}));

let root: string;
let downloads: string;
let media: string;
let indexers: Array<Record<string, unknown>>;

function mkfile(filePath: string, content = 'audio-bytes'): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function useCompletedDownload(downloadPath: string) {
  const row = {
    id: 'dh-1', requestId: 'req-1', indexerId: 7, downloadClientId: 'nzo_1', downloadClient: 'sabnzbd',
    downloadStatus: 'completed', downloadPath, createdAt: new Date(),
  };
  prismaMock.downloadHistory.findFirst.mockResolvedValue(row);
  prismaMock.downloadHistory.findUnique.mockImplementation(async ({ where }: { where?: { id?: string } }) =>
    where?.id === row.id ? row : null
  );
}

type Status = 'copied' | 'identical' | 'present' | 'differs' | 'failed';

/** Organizer result whose records give each listed source the given status. */
function organizeWith(target: string, statuses: Record<string, Status>, inventory?: { files?: string[]; complete?: boolean }) {
  const sources = Object.keys(statuses);
  organizerMock.organize.mockResolvedValue({
    success: true,
    targetPath: target,
    filesMovedCount: sources.length,
    errors: [],
    audioFiles: sources.map((s) => path.join(target, path.basename(s))),
    records: sources.map((source) => ({
      source,
      target: path.join(target, path.basename(source)),
      status: statuses[source],
      verified: statuses[source] === 'copied' || statuses[source] === 'identical',
    })),
    inventory: { kind: 'audio', files: inventory?.files ?? sources, complete: inventory?.complete ?? true },
  });
}

async function runOrganize(payload: Record<string, unknown>) {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({
    requestId: 'req-1', audiobookId: 'a1', jobId: 'job-1', ...payload,
  } as Parameters<typeof processOrganizeFiles>[0]);
}

function requestUpdateData() {
  return prismaMock.request.update.mock.calls
    .map((call: Array<{ data?: Record<string, unknown> }>) => call[0]?.data ?? {})
    .find((data: Record<string, unknown>) => data.status === 'downloaded');
}

describe('verified-import cleanup', () => {
  // The processor's first import is slow under a loaded parallel run; pay it once here
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-verified-')));
    downloads = path.join(root, 'downloads');
    media = path.join(root, 'media');
    fs.mkdirSync(downloads, { recursive: true });
    fs.mkdirSync(media, { recursive: true });
    indexers = [{ id: 7, protocol: 'usenet', removeAfterProcessing: true }];

    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'audiobook', user: { plexUsername: 'tester' },
    });
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a1', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: null, year: 2020,
    });
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) => {
      if (where?.key === 'media_dir') return { value: media };
      if (where?.key === 'download_dir') return { value: downloads };
      return null;
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockImplementation(async (key: string) => (key === 'prowlarr_indexers' ? JSON.stringify(indexers) : null));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('download cleanup', () => {
    let download: string;
    let parts: string[];
    const target = () => path.join(media, 'Author', 'Book');

    beforeEach(() => {
      download = path.join(downloads, 'Book.Name');
      parts = ['Part 1.mp3', 'Part 2.mp3', 'Part 3.mp3'].map((n) => mkfile(path.join(download, n)));
      useCompletedDownload(download);
    });

    it('keeps the download and its client history when one file was not imported, and says so on the request', async () => {
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: 'failed', [parts[2]]: 'copied' });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(parts.every((p) => fs.existsSync(p))).toBe(true);
      expect(postProcess).not.toHaveBeenCalled();
      expect(requestUpdateData()?.errorMessage).toBe('1 of 3 files not imported; source files kept');
    });

    it.each(['differs', 'present'] as const)('keeps the download when a file is only %s in the library', async (status) => {
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: status, [parts[2]]: 'copied' });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(download)).toBe(true);
      expect(postProcess).not.toHaveBeenCalled();
    });

    it('keeps the download when the source inventory was incomplete', async () => {
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: 'copied', [parts[2]]: 'copied' }, { complete: false });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(download)).toBe(true);
    });

    it('keeps the download when an audio file appears that the import never saw', async () => {
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: 'copied' }, { files: [parts[0], parts[1]] });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(parts[2])).toBe(true);
      expect(postProcess).not.toHaveBeenCalled();
    });

    it('removes the download and archives it when every file is verified, and clears the request message', async () => {
      mkfile(path.join(download, 'release.nfo'), 'nfo');
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: 'identical', [parts[2]]: 'copied' });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(download)).toBe(false);
      expect(postProcess).toHaveBeenCalledWith('nzo_1');
      expect(requestUpdateData()?.errorMessage).toBeNull();
    });

    it('compares existing library files only when a delete depends on it', async () => {
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: 'copied', [parts[2]]: 'copied' });
      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });
      expect(organizerMock.organize.mock.calls[0][6]).toEqual({ compareExisting: true });

      indexers = [{ id: 7, protocol: 'torrent', removeAfterProcessing: true }];
      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });
      expect(organizerMock.organize.mock.calls[1][6]).toEqual({ compareExisting: false });
    });
  });

  describe('request messages', () => {
    let download: string;
    let parts: string[];
    const target = () => path.join(media, 'Author', 'Book');

    beforeEach(() => {
      download = path.join(downloads, 'Book.Name');
      parts = ['Part 1.mp3', 'Part 2.mp3'].map((n) => mkfile(path.join(download, n)));
      useCompletedDownload(download);
    });

    it('a library that already has different files is not a failure: downloaded, source kept, no failure notification', async () => {
      organizeWith(target(), { [parts[0]]: 'differs', [parts[1]]: 'differs' });

      const result = await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(result.success).toBe(true);
      expect(requestUpdateData()?.errorMessage).toBe('already in the library with different content; source kept');
      expect(parts.every((p) => fs.existsSync(p))).toBe(true);
      expect(jobQueueMock.addNotificationJob.mock.calls.some((call: unknown[]) => call[0] === 'request_error')).toBe(false);
    });

    it('a merge kept outside the strict duration window says so instead of "not imported"', async () => {
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: 'copied' });
      const merged = await organizerMock.organize();
      merged.records = merged.records.map((r: Record<string, unknown>) => ({ ...r, verified: false }));
      organizerMock.organize.mockResolvedValue(merged);

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(requestUpdateData()?.errorMessage).toBe('merged file kept; sources kept');
      expect(fs.existsSync(download)).toBe(true);
    });

    it('an incomplete source listing is shown on the request', async () => {
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: 'copied' }, { complete: false });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(requestUpdateData()?.errorMessage).toBe('source folder could not be fully read; source files kept');
      expect(fs.existsSync(download)).toBe(true);
    });

    it('says when files went into the library without metadata tags, and why', async () => {
      organizeWith(target(), { [parts[0]]: 'copied', [parts[1]]: 'copied' });
      const placed = await organizerMock.organize();
      placed.records[1] = { ...placed.records[1], tagsDropped: 'the length could not be checked' };
      organizerMock.organize.mockResolvedValue(placed);

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(requestUpdateData()?.errorMessage).toBe('1 file imported without metadata tags (the length could not be checked)');
      // The untagged originals are verified copies: the download still goes
      expect(fs.existsSync(download)).toBe(false);
    });
  });

  describe('manual import source cleanup', () => {
    it('removes only the selected files whose import is verified', async () => {
      const source = path.join(downloads, 'manual', 'Book');
      const ok = mkfile(path.join(source, 'Part 1.mp3'));
      const bad = mkfile(path.join(source, 'Part 2.mp3'));
      organizeWith(path.join(media, 'Author', 'Book'), { [ok]: 'copied', [bad]: 'failed' });

      await runOrganize({ downloadPath: source, cleanupSource: true, selectedFiles: ['Part 1.mp3', 'Part 2.mp3'] });

      expect(fs.existsSync(ok)).toBe(false);
      expect(fs.existsSync(bad)).toBe(true);
    });

    it('keeps a whole staging folder when any audio file in it was not verified', async () => {
      const source = path.join(downloads, 'manual', 'Book');
      const ok = mkfile(path.join(source, 'Part 1.mp3'));
      const bad = mkfile(path.join(source, 'Part 2.mp3'));
      organizeWith(path.join(media, 'Author', 'Book'), { [ok]: 'copied', [bad]: 'differs' });

      await runOrganize({ downloadPath: source, cleanupSource: true });

      expect(fs.existsSync(ok)).toBe(true);
      expect(fs.existsSync(bad)).toBe(true);
    });
  });

  describe('ebook downloads', () => {
    beforeEach(() => {
      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
      });
    });

    it('keeps an ebook download folder that holds more ebook files than were imported', async () => {
      const download = path.join(downloads, 'Ebooks');
      const imported = mkfile(path.join(download, 'a-book.epub'), 'epub-a');
      const other = mkfile(path.join(download, 'b-other.epub'), 'epub-b');
      useCompletedDownload(download);
      organizerMock.organizeEbook.mockResolvedValue({
        success: true, targetPath: path.join(media, 'Author', 'Book'), format: 'epub', errors: [], sourceFile: imported,
        record: { source: imported, target: path.join(media, 'Author', 'Book', 'Book.epub'), status: 'copied', verified: true },
      });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(imported)).toBe(true);
      expect(fs.existsSync(other)).toBe(true);
      expect(postProcess).not.toHaveBeenCalled();
      expect(requestUpdateData()).toMatchObject({ status: 'downloaded', errorMessage: 'download kept: it holds several ebook files and only one was imported; remove it from the download client once you no longer need the others' });
    });

    it('says why a release with several ebook formats is kept', async () => {
      const download = path.join(downloads, 'Ebook.Formats');
      const imported = mkfile(path.join(download, 'Book.epub'), 'epub');
      const pdf = mkfile(path.join(download, 'Book.pdf'), 'pdf');
      useCompletedDownload(download);
      organizerMock.organizeEbook.mockResolvedValue({
        success: true, targetPath: path.join(media, 'Author', 'Book'), format: 'epub', errors: [], sourceFile: imported,
        record: { source: imported, target: path.join(media, 'Author', 'Book', 'Book.epub'), status: 'copied', verified: true },
      });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(requestUpdateData()).toMatchObject({ status: 'downloaded', errorMessage: 'download kept: it holds several ebook formats and only one was imported; remove it from the download client once you no longer need the others' });
      expect(fs.existsSync(pdf)).toBe(true);
    });

    it('adds no message for several ebook formats when the download is not removed anyway (torrent)', async () => {
      indexers = [{ id: 7, protocol: 'torrent', removeAfterProcessing: true }];
      const download = path.join(downloads, 'Ebook.Torrent');
      const imported = mkfile(path.join(download, 'Book.epub'), 'epub');
      mkfile(path.join(download, 'Book.pdf'), 'pdf');
      useCompletedDownload(download);
      organizerMock.organizeEbook.mockResolvedValue({
        success: true, targetPath: path.join(media, 'Author', 'Book'), format: 'epub', errors: [], sourceFile: imported,
        record: { source: imported, target: path.join(media, 'Author', 'Book', 'Book.epub'), status: 'copied', verified: true },
      });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(requestUpdateData()).toMatchObject({ status: 'downloaded', errorMessage: null });
    });

    it('clears a stale request message on a complete ebook import', async () => {
      const download = path.join(downloads, 'Ebook');
      const imported = mkfile(path.join(download, 'a-book.epub'), 'epub-a');
      useCompletedDownload(download);
      organizerMock.organizeEbook.mockResolvedValue({
        success: true, targetPath: path.join(media, 'Author', 'Book'), format: 'epub', errors: [], sourceFile: imported,
        record: { source: imported, target: path.join(media, 'Author', 'Book', 'Book.epub'), status: 'copied', verified: true },
      });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(requestUpdateData()).toMatchObject({ status: 'downloaded', errorMessage: null });
    });

    it('an ebook already in the library with different content is downloaded with a message, source kept', async () => {
      const download = path.join(downloads, 'Ebook');
      const imported = mkfile(path.join(download, 'a-book.epub'), 'epub-a');
      useCompletedDownload(download);
      organizerMock.organizeEbook.mockResolvedValue({
        success: true, targetPath: path.join(media, 'Author', 'Book'), format: 'epub', errors: [], sourceFile: imported,
        record: { source: imported, target: path.join(media, 'Author', 'Book', 'Book.epub'), status: 'differs', verified: false },
      });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(requestUpdateData()).toMatchObject({ status: 'downloaded', errorMessage: 'already in the library with different content; source kept' });
      expect(fs.existsSync(imported)).toBe(true);
    });

    it('removes an ebook download folder that holds only the imported ebook', async () => {
      const download = path.join(downloads, 'Ebook');
      const imported = mkfile(path.join(download, 'a-book.epub'), 'epub-a');
      mkfile(path.join(download, 'cover.jpg'), 'jpeg');
      useCompletedDownload(download);
      organizerMock.organizeEbook.mockResolvedValue({
        success: true, targetPath: path.join(media, 'Author', 'Book'), format: 'epub', errors: [], sourceFile: imported,
        record: { source: imported, target: path.join(media, 'Author', 'Book', 'Book.epub'), status: 'copied', verified: true },
      });

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(download)).toBe(false);
    });
  });
});
