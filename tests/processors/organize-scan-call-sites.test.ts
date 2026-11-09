/**
 * Component: Organize Scan Call-Site Tests (Audiobookshelf, both library ids set)
 * Documentation: documentation/phase3/file-organization.md
 *
 * processOrganizeFiles on Audiobookshelf with scan after import on and both an audiobook and
 * an ebook library saved: an audiobook import scans only the audiobook library, an ebook import
 * (real FileOrganizer.organizeEbook into a temp library) scans only the ebook library. Each
 * case fails if its organize path passes the other kind to triggerScanAfterImport.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const libraryServiceMock = vi.hoisted(() => ({ triggerLibraryScan: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(() => Promise.resolve()) }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));
const audibleServiceMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));
// Real organizer for ebooks (temp library); the audiobook organize step is stubbed
const organizerHolder = vi.hoisted(() => ({ media: '', temp: '', organize: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/file-organizer')>();
  return {
    ...actual,
    getFileOrganizer: async () => {
      const organizer = new actual.FileOrganizer(organizerHolder.media, organizerHolder.temp);
      organizer.organize = organizerHolder.organize;
      return organizer;
    },
  };
});
vi.mock('@/lib/services/library', () => ({ getLibraryService: async () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleServiceMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({
    getAllClients: async () => [],
    getClientForProtocol: async () => null,
    getClientServiceForProtocol: async () => null,
  }),
}));

const ABS_SETTINGS: Record<string, string> = {
  'audiobookshelf.trigger_scan_after_import': 'true',
  'audiobookshelf.library_id': 'abs-audio',
  'audiobookshelf.ebook_library_id': 'abs-ebooks',
};

let root: string;
let source: string;

function requestOfType(type: 'audiobook' | 'ebook') {
  prismaMock.request.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
    args?.select?.placedEbookFiles
      ? { placedEbookFiles: null }
      : { id: 'req-1', userId: 'u1', type, user: { plexUsername: 'tester' } }
  );
}

async function runOrganize() {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({ requestId: 'req-1', audiobookId: 'ab-1', jobId: 'job-1', downloadPath: source });
}

describe('organize: library scanned after import (Audiobookshelf, both libraries set)', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-scan-sites-')));
    organizerHolder.media = path.join(root, 'media');
    organizerHolder.temp = path.join(root, 'tmp');
    source = path.join(root, 'downloads', 'Book');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(organizerHolder.temp, { recursive: true });

    libraryServiceMock.triggerLibraryScan.mockResolvedValue(undefined);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'ab-1', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: null, year: 2020,
    });
    prismaMock.downloadHistory.findFirst.mockResolvedValue(null);
    prismaMock.downloadHistory.findUnique.mockResolvedValue(null);
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) => {
      if (where?.key === 'audiobook_path_template') return { value: '{author}/{title}' };
      if (where?.key === 'media_dir') return { value: organizerHolder.media };
      if (where?.key === 'download_dir') return { value: path.join(root, 'downloads') };
      return null;
    });
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockImplementation(async (key: string) => ABS_SETTINGS[key] ?? null);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('an audiobook import scans the audiobook library, never the ebook library', async () => {
    requestOfType('audiobook');
    const placed = path.join(organizerHolder.media, 'Author', 'Book');
    organizerHolder.organize.mockResolvedValue({
      success: true,
      targetPath: placed,
      filesMovedCount: 1,
      errors: [],
      audioFiles: [path.join(placed, 'Book.m4b')],
    });

    const result = await runOrganize();

    expect(result.success).toBe(true);
    expect(organizerHolder.organize).toHaveBeenCalledTimes(1);
    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledTimes(1);
    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledWith('abs-audio');
  });

  it('an ebook import scans the ebook library, never the audiobook library', async () => {
    requestOfType('ebook');
    fs.writeFileSync(path.join(source, 'Book.epub'), 'downloaded epub');

    const result = await runOrganize();

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(organizerHolder.media, 'Author', 'Book', 'Book.epub'))).toBe(true);
    expect(organizerHolder.organize).not.toHaveBeenCalled();
    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledTimes(1);
    expect(libraryServiceMock.triggerLibraryScan).toHaveBeenCalledWith('abs-ebooks');
  });
});
