/**
 * Component: In-place import stop flag (organizer options)
 * Documentation: documentation/features/multi-disc-folders.md
 *
 * processOrganizeFiles with the organizer mocked: Manual and Bulk Import ask
 * for the in-place stop, a download never does.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const organizerMock = vi.hoisted(() => ({ organize: vi.fn(), organizeEbook: vi.fn() }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', () => ({ getFileOrganizer: () => organizerMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => ({ triggerLibraryScan: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }),
}));
vi.mock('@/lib/utils/format-coercion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/format-coercion')>()),
  coerceToPlexCompatible: vi.fn(async (paths: string[]) => ({ renamed: [], warnings: [], errors: [], finalAudioFiles: paths })),
}));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({
    getAllClients: async () => [],
    getClientForProtocol: async () => null,
    getClientServiceForProtocol: async () => ({ clientType: 'sabnzbd', postProcess: vi.fn(async () => undefined) }),
  }),
}));

let root: string;
let downloads: string;
let media: string;

async function runOrganize(payload: Record<string, unknown>) {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({
    requestId: 'req-1', audiobookId: 'a1', jobId: 'job-1', ...payload,
  } as Parameters<typeof processOrganizeFiles>[0]);
}

describe('in-place import stop flag', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-stop-flag-')));
    downloads = path.join(root, 'downloads');
    media = path.join(root, 'media');
    fs.mkdirSync(media, { recursive: true });

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
    configMock.get.mockImplementation(async (key: string) =>
      key === 'prowlarr_indexers' ? JSON.stringify([{ id: 7, protocol: 'usenet', removeAfterProcessing: true }]) : null
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('asks the organizer for the in-place stop on Manual and Bulk Import, never on a download', async () => {
    const source = path.join(downloads, 'manual', 'Book');
    const file = path.join(source, 'Part 1.mp3');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(file, 'audio-bytes');
    const target = path.join(media, 'Author', 'Book');
    organizerMock.organize.mockResolvedValue({
      success: true, targetPath: target, filesMovedCount: 1, errors: [],
      audioFiles: [path.join(target, 'Part 1.mp3')],
      records: [{ source: file, target: path.join(target, 'Part 1.mp3'), status: 'copied', verified: true }],
      inventory: { kind: 'audio', files: [file], complete: true },
    });
    const row = {
      id: 'dh-1', requestId: 'req-1', indexerId: 7, downloadClientId: 'nzo_1', downloadClient: 'sabnzbd',
      downloadStatus: 'completed', downloadPath: source, createdAt: new Date(),
    };
    prismaMock.downloadHistory.findFirst.mockResolvedValue(row);
    prismaMock.downloadHistory.findUnique.mockResolvedValue(row);

    // Bulk Import sends cleanupSource false and no download history
    await runOrganize({ downloadPath: source, cleanupSource: false });
    await runOrganize({ downloadPath: source, cleanupSource: true });
    await runOrganize({ downloadPath: source, downloadHistoryId: 'dh-1' });

    expect(organizerMock.organize.mock.calls.map((call) => call[6].stopInPlaceDiscLayout)).toEqual([true, true, false]);
  });
});
