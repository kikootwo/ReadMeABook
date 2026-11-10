/**
 * Component: Download Cleanup in a Category ReadMeABook Did Not Create (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * A usenet category that already existed in the client (another app's) can put that app's files
 * next to the job. Cleanup then unlinks only the verified imported files and removes a folder only
 * when it became empty; ReadMeABook's own category keeps the whole-folder removal.
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
const usenet = vi.hoisted(() => ({ config: null as null | Record<string, unknown> }));

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
    getClientForProtocol: async () => usenet.config,
    getClientServiceForProtocol: async () => ({ clientType: 'sabnzbd', postProcess }),
  }),
}));

let root: string;
let downloads: string;
let media: string;

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

function organizeAllCopied(target: string, sources: string[]) {
  organizerMock.organize.mockResolvedValue({
    success: true,
    targetPath: target,
    filesMovedCount: sources.length,
    errors: [],
    audioFiles: sources.map((s) => path.join(target, path.basename(s))),
    records: sources.map((source) => ({ source, target: path.join(target, path.basename(source)), status: 'copied', verified: true })),
    inventory: { kind: 'audio', files: sources, complete: true },
  });
}

async function runOrganize(downloadPath: string) {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({
    requestId: 'req-1', audiobookId: 'a1', jobId: 'job-1', downloadPath, downloadHistoryId: 'dh-1',
  } as Parameters<typeof processOrganizeFiles>[0]);
}

describe('cleanup in a usenet category ReadMeABook did not create', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-shared-cat-')));
    downloads = path.join(root, 'downloads');
    media = path.join(root, 'media');
    fs.mkdirSync(downloads, { recursive: true });
    fs.mkdirSync(media, { recursive: true });
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', userId: 'u1', type: 'audiobook', user: { plexUsername: 'tester' } });
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'a1', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: null, year: 2020,
    });
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) => {
      if (where?.key === 'media_dir') return { value: media };
      if (where?.key === 'download_dir') return { value: downloads };
      return null;
    });
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockImplementation(async (key: string) =>
      key === 'prowlarr_indexers' ? JSON.stringify([{ id: 7, protocol: 'usenet', removeAfterProcessing: true }]) : null
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const target = () => path.join(media, 'Author', 'Book');

  it('another app\'s file next to the job survives; only the imported files go', async () => {
    usenet.config = { type: 'sabnzbd', category: 'books' }; // no ownedCategory: it already existed
    const folder = path.join(downloads, 'other-app');
    const parts = ['Book - 01.mp3', path.join('CD2', 'Book - 02.mp3')].map((n) => mkfile(path.join(folder, n)));
    const foreign = mkfile(path.join(folder, 'Other Book.epub'), 'other app');
    useCompletedDownload(folder);
    organizeAllCopied(target(), parts);

    await runOrganize(folder);

    expect(parts.some((p) => fs.existsSync(p))).toBe(false);
    expect(fs.existsSync(path.join(folder, 'CD2'))).toBe(false); // emptied by the import
    expect(fs.readFileSync(foreign, 'utf8')).toBe('other app');
    expect(postProcess).toHaveBeenCalledWith('nzo_1');
  });

  it('a folder holding only the imported files is removed once empty', async () => {
    usenet.config = { type: 'sabnzbd', category: 'books' };
    const folder = path.join(downloads, 'books', 'Book.Name');
    const parts = ['Part 1.mp3', 'Part 2.mp3'].map((n) => mkfile(path.join(folder, n)));
    useCompletedDownload(folder);
    organizeAllCopied(target(), parts);

    await runOrganize(folder);

    expect(fs.existsSync(folder)).toBe(false);
  });

  it('ReadMeABook\'s own category keeps the whole-folder removal (extras go with it)', async () => {
    usenet.config = { type: 'sabnzbd', category: 'books', ownedCategory: 'books' };
    const folder = path.join(downloads, 'Book.Name');
    const parts = ['Part 1.mp3'].map((n) => mkfile(path.join(folder, n)));
    mkfile(path.join(folder, 'release.nfo'), 'nfo');
    useCompletedDownload(folder);
    organizeAllCopied(target(), parts);

    await runOrganize(folder);

    expect(fs.existsSync(folder)).toBe(false);
  });
});
