/**
 * Component: Post-Organize Cleanup Safety Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * Drives processOrganizeFiles end to end with the organizer mocked but every
 * delete hitting real temp directories, so a wrong delete shows up as a
 * missing file rather than a mock call.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const organizerMock = vi.hoisted(() => ({ organize: vi.fn(), organizeEbook: vi.fn() }));
const libraryServiceMock = vi.hoisted(() => ({ triggerLibraryScan: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));
const formatCoercionMock = vi.hoisted(() => ({ coerceToPlexCompatible: vi.fn() }));
const clientState = vi.hoisted(() => ({
  clients: [] as Array<Record<string, unknown>>,
  failClients: false,
  corruptClients: false,
  postProcess: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', () => ({ getFileOrganizer: () => organizerMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/format-coercion', () => formatCoercionMock);
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({
    getAllClients: async () => clientState.clients,
    getClientForProtocol: async () => null,
    getClientServiceForProtocol: async () => ({ clientType: 'sabnzbd', postProcess: clientState.postProcess }),
  }),
}));

let root: string;
let downloads: string;
let media: string;
let downloadDirSetting: string;
let indexers: Array<Record<string, unknown>>;

function mkfile(filePath: string, content = 'audio-bytes'): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dh-1',
    requestId: 'req-1',
    indexerId: 7,
    downloadClientId: 'nzo_1',
    downloadClient: 'sabnzbd',
    downloadStatus: 'completed',
    downloadPath: path.join(downloads, 'Book.Name'),
    createdAt: new Date(),
    ...overrides,
  };
}

/** Newest row by request (what older code read) and the row by id return the same record. */
function useHistory(row: Record<string, unknown> | null) {
  prismaMock.downloadHistory.findFirst.mockResolvedValue(row);
  prismaMock.downloadHistory.findUnique.mockImplementation(async ({ where }: { where?: { id?: string } }) =>
    row && where?.id === row.id ? row : null
  );
}

function organizeInto(targetPath: string) {
  organizerMock.organize.mockResolvedValue({
    success: true,
    targetPath,
    filesMovedCount: 0,
    errors: [],
    audioFiles: [path.join(targetPath, 'Book.m4b')],
  });
}

async function runOrganize(payload: Record<string, unknown>) {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({
    requestId: 'req-1', audiobookId: 'a1', jobId: 'job-1', ...payload,
  } as Parameters<typeof processOrganizeFiles>[0]);
}

describe('post-organize cleanup safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-cleanup-')));
    downloads = path.join(root, 'downloads');
    media = path.join(root, 'media');
    fs.mkdirSync(downloads, { recursive: true });
    fs.mkdirSync(media, { recursive: true });
    downloadDirSetting = downloads;
    indexers = [{ id: 7, protocol: 'usenet', removeAfterProcessing: true }];
    clientState.clients = [];
    clientState.failClients = false;
    clientState.corruptClients = false;

    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'audiobook', user: { plexUsername: 'tester' },
    });
    prismaMock.request.findFirst.mockResolvedValue({ id: 'req-1', importAttempts: 0, maxImportRetries: 3 });
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a1', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: null, year: 2020,
    });
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) => {
      if (where?.key === 'media_dir') return { value: media };
      if (where?.key === 'download_dir') return { value: downloadDirSetting };
      if (where?.key === 'download_clients') {
        if (clientState.failClients) throw new Error('database unavailable');
        if (clientState.corruptClients) return { value: '[{"customPath": "sab"' };
        return clientState.clients.length > 0 ? { value: JSON.stringify(clientState.clients) } : null;
      }
      return null;
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'download_dir') return downloadDirSetting;
      if (key === 'media_dir') return media;
      if (key === 'prowlarr_indexers') return JSON.stringify(indexers);
      return null;
    });
    formatCoercionMock.coerceToPlexCompatible.mockImplementation(async (paths: string[]) => ({
      renamed: [], warnings: [], errors: [], finalAudioFiles: paths,
    }));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('manual import from a library folder keeps the folder when the newest download used a cleanup indexer', async () => {
    const target = path.join(media, 'Author', 'Book');
    const book = mkfile(path.join(target, 'Book.m4b'));
    mkfile(path.join(target, 'cover.jpg'), 'jpeg');
    useHistory(historyRow({ id: 'dh-old' }));
    organizeInto(target);

    const result = await runOrganize({ downloadPath: target });

    expect(result.success).toBe(true);
    expect(fs.existsSync(book)).toBe(true);
    expect(fs.readFileSync(path.join(target, 'cover.jpg'), 'utf8')).toBe('jpeg');
    expect(clientState.postProcess).not.toHaveBeenCalled();
  });

  it('manual import from the media root deletes nothing', async () => {
    const target = path.join(media, 'Author', 'Book');
    mkfile(path.join(target, 'Book.m4b'));
    const other = mkfile(path.join(media, 'Other Author', 'Other Book', 'Other.m4b'));
    useHistory(historyRow({ id: 'dh-old' }));
    organizeInto(target);

    await runOrganize({ downloadPath: media });

    expect(fs.existsSync(path.join(target, 'Book.m4b'))).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
    expect(clientState.postProcess).not.toHaveBeenCalled();
  });

  it('cleanupSource with source equal to the target keeps the library files', async () => {
    const target = path.join(media, 'Author', 'Book');
    const book = mkfile(path.join(target, 'Book.m4b'));
    useHistory(null);
    organizeInto(target);

    await runOrganize({ downloadPath: target, cleanupSource: true, selectedFiles: ['Book.m4b'] });

    expect(fs.existsSync(book)).toBe(true);
    expect(fs.readFileSync(book, 'utf8')).toBe('audio-bytes');
  });

  it('cleanupSource without file selection never removes the target folder', async () => {
    const target = path.join(media, 'Author', 'Book');
    const book = mkfile(path.join(target, 'Book.m4b'));
    useHistory(null);
    organizeInto(target);

    await runOrganize({ downloadPath: target, cleanupSource: true });

    expect(fs.existsSync(book)).toBe(true);
  });

  it('cleanupSource from another library folder still removes that source', async () => {
    const source = path.join(media, 'Unsorted', 'Book');
    const sourceFile = mkfile(path.join(source, 'Book.m4b'));
    const target = path.join(media, 'Author', 'Book');
    const targetFile = mkfile(path.join(target, 'Book.m4b'));
    useHistory(null);
    organizeInto(target);

    await runOrganize({ downloadPath: source, cleanupSource: true, selectedFiles: ['Book.m4b'] });

    expect(fs.existsSync(sourceFile)).toBe(false);
    expect(fs.existsSync(targetFile)).toBe(true);
  });

  it('removes a completed download folder and archives it in the client', async () => {
    const download = path.join(downloads, 'Book.Name');
    mkfile(path.join(download, 'Book.m4b'));
    const target = path.join(media, 'Author', 'Book');
    const targetFile = mkfile(path.join(target, 'Book.m4b'));
    useHistory(historyRow());
    organizeInto(target);

    await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

    expect(fs.existsSync(download)).toBe(false);
    expect(fs.existsSync(downloads)).toBe(true);
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(clientState.postProcess).toHaveBeenCalledWith('nzo_1');
  });

  it('derives the protocol from the download client when the indexer has none', async () => {
    indexers = [{ id: 7, removeAfterProcessing: true }];
    const download = path.join(downloads, 'Book.Name');
    mkfile(path.join(download, 'Book.m4b'));
    useHistory(historyRow());
    organizeInto(path.join(media, 'Author', 'Book'));

    await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

    expect(fs.existsSync(download)).toBe(false);
  });

  it('keeps a torrent download when the indexer protocol is missing', async () => {
    indexers = [{ id: 7, removeAfterProcessing: true }];
    const download = path.join(downloads, 'Book.Name');
    mkfile(path.join(download, 'Book.m4b'));
    useHistory(historyRow({ downloadClient: 'qbittorrent', downloadClientId: 'hash-1' }));
    organizeInto(path.join(media, 'Author', 'Book'));

    await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

    expect(fs.existsSync(download)).toBe(true);
  });

  it('skips download cleanup for imports that carry no download history id', async () => {
    const download = path.join(downloads, 'Book.Name');
    mkfile(path.join(download, 'Book.m4b'));
    useHistory(historyRow());
    organizeInto(path.join(media, 'Author', 'Book'));

    await runOrganize({ downloadPath: download });

    expect(fs.existsSync(download)).toBe(true);
    expect(clientState.postProcess).not.toHaveBeenCalled();
  });

  it('skips download cleanup when the job path differs from the stored download path', async () => {
    const download = path.join(downloads, 'Other.Folder');
    mkfile(path.join(download, 'Book.m4b'));
    useHistory(historyRow());
    organizeInto(path.join(media, 'Author', 'Book'));

    await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

    expect(fs.existsSync(download)).toBe(true);
  });

  it('the guard alone keeps a library folder when the stored download path points into the library', async () => {
    // Stored path == job path, so the provenance check passes; only the guard stands in the way.
    const incoming = path.join(media, 'incoming', 'Book.Name');
    const incomingFile = mkfile(path.join(incoming, 'Book.m4b'));
    useHistory(historyRow({ downloadPath: incoming }));
    organizeInto(path.join(media, 'Author', 'Book'));

    await runOrganize({ downloadPath: incoming, downloadHistoryId: 'dh-1' });

    expect(fs.existsSync(incomingFile)).toBe(true);
    expect(clientState.postProcess).not.toHaveBeenCalled();
  });

  it('removes a completed download inside a download dir nested in the library', async () => {
    downloadDirSetting = path.join(media, '_downloads');
    const download = path.join(downloadDirSetting, 'Book.Name');
    mkfile(path.join(download, 'Book.m4b'));
    useHistory(historyRow({ downloadPath: download }));
    organizeInto(path.join(media, 'Author', 'Book'));

    await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

    expect(fs.existsSync(download)).toBe(false);
    expect(fs.existsSync(downloadDirSetting)).toBe(true);
  });

  it('removes a completed ebook download and keeps the organized ebook folder', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
    });
    const download = path.join(downloads, 'Ebook.Name');
    mkfile(path.join(download, 'book.epub'), 'epub');
    const targetDir = path.join(media, 'Author', 'Book');
    const targetFile = mkfile(path.join(targetDir, 'Book.epub'), 'epub');
    organizerMock.organizeEbook.mockResolvedValue({ success: true, targetPath: targetDir, format: 'epub', errors: [] });
    useHistory(historyRow({ downloadPath: download }));

    const result = await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

    expect(result.success).toBe(true);
    expect(fs.existsSync(download)).toBe(false);
    expect(fs.existsSync(targetFile)).toBe(true);
  });

  it('ebook manual import from an audiobook folder removes only the imported epub', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
    });
    const audiobookDir = path.join(media, 'Author', 'Book');
    const audio = mkfile(path.join(audiobookDir, 'Book.m4b'));
    const cover = mkfile(path.join(audiobookDir, 'cover.jpg'), 'jpeg');
    const epub = mkfile(path.join(audiobookDir, 'book.epub'), 'epub');
    const ebookTarget = path.join(media, 'Ebooks', 'Author', 'Book');
    const organizedEpub = mkfile(path.join(ebookTarget, 'Book.epub'), 'epub');
    organizerMock.organizeEbook.mockResolvedValue({
      success: true, targetPath: ebookTarget, format: 'epub', errors: [], sourceFile: epub,
    });
    // The recycled request's newest history row is an old usenet download with cleanup enabled
    useHistory(historyRow({ id: 'dh-old' }));

    const result = await runOrganize({ downloadPath: audiobookDir, cleanupSource: true });

    expect(result.success).toBe(true);
    expect(fs.existsSync(audio)).toBe(true);
    expect(fs.existsSync(cover)).toBe(true);
    expect(fs.existsSync(epub)).toBe(false);
    expect(fs.existsSync(organizedEpub)).toBe(true);
    expect(clientState.postProcess).not.toHaveBeenCalled();
  });

  it('keeps an ebook re-imported from its own library folder', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
    });
    const targetDir = path.join(media, 'Author', 'Book');
    const targetFile = mkfile(path.join(targetDir, 'Book.epub'), 'epub');
    const audio = mkfile(path.join(targetDir, 'Book.m4b'));
    organizerMock.organizeEbook.mockResolvedValue({
      success: true, targetPath: targetDir, format: 'epub', errors: [], sourceFile: targetFile,
    });
    useHistory(historyRow({ id: 'dh-old' }));

    await runOrganize({ downloadPath: targetDir, cleanupSource: true });

    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.existsSync(audio)).toBe(true);
  });

  it('ebook source cleanup removes the file the organizer imported when a folder holds several epubs', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
    });
    const source = path.join(media, 'Unsorted', 'Ebooks');
    const first = mkfile(path.join(source, 'a-other-book.epub'), 'epub-a');
    const imported = mkfile(path.join(source, 'b-this-book.epub'), 'epub-b');
    const targetDir = path.join(media, 'Author', 'Book');
    organizerMock.organizeEbook.mockResolvedValue({
      success: true, targetPath: targetDir, format: 'epub', errors: [], sourceFile: imported,
    });
    useHistory(null);

    await runOrganize({ downloadPath: source, cleanupSource: true });

    expect(fs.existsSync(imported)).toBe(false);
    expect(fs.existsSync(first)).toBe(true);
  });

  it('removes a completed direct-download ebook file after organizing', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
    });
    const file = mkfile(path.join(downloads, 'Book.epub'), 'epub');
    const targetDir = path.join(media, 'Author', 'Book');
    const organized = mkfile(path.join(targetDir, 'Book.epub'), 'epub');
    organizerMock.organizeEbook.mockResolvedValue({
      success: true, targetPath: targetDir, format: 'epub', errors: [], sourceFile: file,
    });
    useHistory(historyRow({ downloadClient: 'direct', indexerId: null, downloadClientId: null, downloadPath: file }));

    await runOrganize({ downloadPath: file, downloadHistoryId: 'dh-1' });

    expect(organizerMock.organizeEbook.mock.calls[0][4]).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(organized)).toBe(true);
  });

  it('keeps a single library ebook file when the newest row is a direct download but the job is an import', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
    });
    const libraryFile = mkfile(path.join(media, 'Other', 'Book', 'Book.epub'), 'epub');
    const targetDir = path.join(media, 'Author', 'Book');
    organizerMock.organizeEbook.mockResolvedValue({
      success: true, targetPath: targetDir, format: 'epub', errors: [], sourceFile: libraryFile,
    });
    useHistory(historyRow({ id: 'dh-direct', downloadClient: 'direct', indexerId: null, downloadClientId: null, downloadPath: libraryFile }));

    await runOrganize({ downloadPath: libraryFile });

    // Organizer is told to keep its source; nothing else removes it
    expect(organizerMock.organizeEbook.mock.calls[0][4]).toBe(true);
    expect(fs.existsSync(libraryFile)).toBe(true);
  });

  it('keeps a direct-download file that the guard refuses', async () => {
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
    });
    const libraryFile = mkfile(path.join(media, 'Other', 'Book', 'Book.epub'), 'epub');
    organizerMock.organizeEbook.mockResolvedValue({
      success: true, targetPath: path.join(media, 'Author', 'Book'), format: 'epub', errors: [], sourceFile: libraryFile,
    });
    useHistory(historyRow({ downloadClient: 'direct', indexerId: null, downloadClientId: null, downloadPath: libraryFile }));

    await runOrganize({ downloadPath: libraryFile, downloadHistoryId: 'dh-1' });

    expect(fs.existsSync(libraryFile)).toBe(true);
  });

  describe('failed imports', () => {
    const failOrganize = () => {
      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1', userId: 'u1', type: 'audiobook', user: { plexUsername: 'tester' },
        audiobook: { title: 'Book', author: 'Author' },
      });
      organizerMock.organize.mockResolvedValue({
        success: false, targetPath: '', filesMovedCount: 0, audioFiles: [],
        errors: ["ENOENT: no such file or directory, open 'Book.m4b'"],
      });
    };
    const statuses = () =>
      prismaMock.request.update.mock.calls.map((call: Array<{ data?: { status?: string } }>) => call[0]?.data?.status);

    it.each([
      ['manual import (cleanupSource true)', true],
      ['bulk import (cleanupSource false)', false],
    ])('%s fails once without throwing or queueing a client-download retry', async (_label, cleanupSource) => {
      failOrganize();
      const source = path.join(media, 'Unsorted', 'Book');
      mkfile(path.join(source, 'Book.m4b'));
      useHistory(historyRow({ id: 'dh-old' }));

      const result = await runOrganize({ downloadPath: source, cleanupSource, selectedFiles: ['Book.m4b'] });

      expect(result).toMatchObject({ success: false });
      expect(statuses()).not.toContain('awaiting_import');
      const failedCall = prismaMock.request.update.mock.calls.find(
        (call: Array<{ data?: { status?: string } }>) => call[0]?.data?.status === 'failed'
      );
      const message = (failedCall?.[0] as { data: { errorMessage: string } }).data.errorMessage;
      expect(message).toContain(`Import from ${source} did not complete: ENOENT`);
      expect(message).not.toMatch(/failed: File organization failed/);
      expect(message).not.toContain('..');
      expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
      expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
      const notificationText = (jobQueueMock.addNotificationJob.mock.calls[0] as unknown[])[5] as string;
      expect(notificationText).not.toContain(source);
      expect(fs.existsSync(path.join(source, 'Book.m4b'))).toBe(true);
    });

    it('keeps the import retry for a download job queued before download history ids existed', async () => {
      failOrganize();
      const download = path.join(downloads, 'Book.Name');
      useHistory(historyRow());

      const result = await runOrganize({ downloadPath: download });

      expect(result).toMatchObject({ success: false });
      expect(statuses()).toContain('awaiting_import');
      expect(statuses()).not.toContain('failed');
    });
  });

  describe('whole-folder source cleanup', () => {
    it('never removes a library folder that holds other books', async () => {
      const source = path.join(media, 'Unsorted');
      const imported = mkfile(path.join(source, 'Book', 'Book.m4b'));
      const otherBook = mkfile(path.join(source, 'Other', 'Other.m4b'));
      useHistory(null);
      organizeInto(path.join(media, 'Author', 'Book'));

      await runOrganize({ downloadPath: source, cleanupSource: true });

      expect(fs.existsSync(imported)).toBe(true);
      expect(fs.existsSync(otherBook)).toBe(true);
    });

    it('still removes a whole staging folder under the download dir', async () => {
      const source = path.join(downloads, 'manual', 'Book');
      mkfile(path.join(source, 'Book.m4b'));
      useHistory(null);
      organizeInto(path.join(media, 'Author', 'Book'));

      await runOrganize({ downloadPath: source, cleanupSource: true });

      expect(fs.existsSync(source)).toBe(false);
      expect(fs.existsSync(downloads)).toBe(true);
    });
  });

  describe('empty-parent sweep', () => {
    it('never removes a client custom path root, even when empty', async () => {
      clientState.clients = [{ id: 'c1', type: 'sabnzbd', customPath: 'sab' }];
      const clientRoot = path.join(downloads, 'sab');
      const download = path.join(clientRoot, 'Book.Name');
      mkfile(path.join(download, 'Book.m4b'));
      useHistory(historyRow({ downloadPath: download }));
      organizeInto(path.join(media, 'Author', 'Book'));

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(download)).toBe(false);
      expect(fs.existsSync(clientRoot)).toBe(true);
    });

    it('does not climb from a download root inside the library into the library', async () => {
      // Mapped client root nested in the library; the imported ebook file sits directly in it
      prismaMock.request.findUnique.mockResolvedValue({
        id: 'req-1', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' },
      });
      const mappedRoot = path.join(media, 'mapped');
      clientState.clients = [{ id: 'c1', type: 'sabnzbd', remotePathMappingEnabled: true, localPath: mappedRoot }];
      const file = mkfile(path.join(mappedRoot, 'Book.epub'), 'epub');
      const targetDir = path.join(media, 'Author', 'Book');
      organizerMock.organizeEbook.mockResolvedValue({
        success: true, targetPath: targetDir, format: 'epub', errors: [], sourceFile: file,
      });
      useHistory(null);

      await runOrganize({ downloadPath: file, cleanupSource: true });

      expect(fs.existsSync(file)).toBe(false);
      expect(fs.existsSync(mappedRoot)).toBe(true);
    });
  });

  describe('fail closed', () => {
    it('keeps the download when the client list cannot be read', async () => {
      clientState.failClients = true;
      const download = path.join(downloads, 'Book.Name');
      mkfile(path.join(download, 'Book.m4b'));
      useHistory(historyRow());
      organizeInto(path.join(media, 'Author', 'Book'));

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(download)).toBe(true);
      expect(clientState.postProcess).not.toHaveBeenCalled();
    });

    it('keeps the download when the client list is corrupt', async () => {
      clientState.corruptClients = true;
      const download = path.join(downloads, 'Book.Name');
      mkfile(path.join(download, 'Book.m4b'));
      useHistory(historyRow());
      organizeInto(path.join(media, 'Author', 'Book'));

      await runOrganize({ downloadPath: download, downloadHistoryId: 'dh-1' });

      expect(fs.existsSync(download)).toBe(true);
      expect(clientState.postProcess).not.toHaveBeenCalled();
    });

    it('keeps manual-import sources when the client list cannot be read', async () => {
      clientState.failClients = true;
      const source = path.join(downloads, 'manual', 'Book');
      const file = mkfile(path.join(source, 'Book.m4b'));
      useHistory(null);
      organizeInto(path.join(media, 'Author', 'Book'));

      await runOrganize({ downloadPath: source, cleanupSource: true, selectedFiles: ['Book.m4b'] });

      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it('removes the real download folder when the job path runs through a symlinked parent', async () => {
    const real = path.join(downloads, 'real');
    const download = path.join(real, 'Book.Name');
    mkfile(path.join(download, 'Book.m4b'));
    const alias = path.join(downloads, 'alias');
    fs.symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const jobPath = path.join(alias, 'Book.Name');
    useHistory(historyRow({ downloadPath: jobPath }));
    organizeInto(path.join(media, 'Author', 'Book'));

    await runOrganize({ downloadPath: jobPath, downloadHistoryId: 'dh-1' });

    expect(fs.existsSync(download)).toBe(false);
    expect(fs.existsSync(downloads)).toBe(true);
  });
});
