/**
 * Component: Ebook Manual Import Organize Tests (#278, real filesystem)
 * Documentation: documentation/features/manual-import.md
 *
 * processOrganizeFiles for an ebook request queued by Manual Import: the organizer gets the ebook
 * file the admin selected (not a walk of the folder), and source cleanup removes only that file.
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

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', () => ({ getFileOrganizer: () => organizerMock }));
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
let folder: string;
let media: string;
let target: string;

function mkfile(name: string, content: string): string {
  const full = path.join(folder, name);
  fs.writeFileSync(full, content);
  return full;
}

async function runOrganize(payload: Record<string, unknown>) {
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  return processOrganizeFiles({
    requestId: 'req-eb', audiobookId: 'ab-1', jobId: 'job-1', downloadPath: folder, ...payload,
  } as Parameters<typeof processOrganizeFiles>[0]);
}

describe('ebook manual import organize', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-eb-mi-')));
    folder = path.join(root, 'downloads', 'Book');
    media = path.join(root, 'media');
    target = path.join(media, 'Author', 'Book');
    fs.mkdirSync(folder, { recursive: true });
    fs.mkdirSync(target, { recursive: true });

    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-eb', userId: 'u1', type: 'ebook', user: { plexUsername: 'tester' } });
    prismaMock.audiobook.findUnique.mockResolvedValue({
      id: 'ab-1', title: 'Book', author: 'Author', narrator: 'N', series: 'S', seriesPart: '1', audibleAsin: null, year: 2020,
    });
    prismaMock.downloadHistory.findFirst.mockResolvedValue(null);
    prismaMock.downloadHistory.findUnique.mockResolvedValue(null);
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) => {
      if (where?.key === 'media_dir') return { value: media };
      if (where?.key === 'download_dir') return { value: path.join(root, 'downloads') };
      return null;
    });
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue(null);
    // The organizer copies what it is given: a file path imports that file
    organizerMock.organizeEbook.mockImplementation(async (source: string) => {
      const file = fs.statSync(source).isFile() ? source : path.join(source, fs.readdirSync(source).filter((n) => n.endsWith('.epub'))[0]);
      const placed = path.join(target, path.basename(file));
      fs.copyFileSync(file, placed);
      return {
        success: true, targetPath: target, format: path.extname(file).slice(1), errors: [], sourceFile: file,
        inventory: { kind: 'ebook', files: [file], complete: true },
        record: { source: file, target: placed, status: 'copied', verified: true },
      };
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('imports the selected ebook file, not the folder\'s preferred one, and cleanup removes only it', async () => {
    const epub = mkfile('Other Edition.epub', 'epub-other');
    const pdf = mkfile('Book.pdf', 'pdf-bytes');
    const mp3 = mkfile('Book.mp3', 'audio-bytes');

    const result = await runOrganize({ cleanupSource: true, selectedFiles: ['Book.pdf'] });

    expect(result.success).toBe(true);
    expect(organizerMock.organizeEbook).toHaveBeenCalledTimes(1);
    expect(organizerMock.organizeEbook.mock.calls[0][0]).toBe(pdf);
    expect(fs.existsSync(path.join(target, 'Book.pdf'))).toBe(true);
    expect(fs.existsSync(pdf)).toBe(false);
    expect(fs.existsSync(epub)).toBe(true);
    expect(fs.existsSync(mp3)).toBe(true);
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-eb' },
      data: expect.objectContaining({ status: 'downloaded' }),
    });
  });

  it('of several selected ebook files imports the preferred format (epub first)', async () => {
    const pdf = mkfile('Book.pdf', 'pdf-bytes');
    const epub = mkfile('Book.epub', 'epub-bytes');

    await runOrganize({ cleanupSource: false, selectedFiles: ['Book.pdf', 'Book.epub'] });

    expect(organizerMock.organizeEbook.mock.calls[0][0]).toBe(epub);
    expect(fs.existsSync(pdf)).toBe(true);
    expect(fs.existsSync(epub)).toBe(true);
  });

  it('keeps an ebook source that is already the library copy (in-place import, cleanup on)', async () => {
    folder = target;
    const epub = mkfile('Book.epub', 'epub-bytes');
    organizerMock.organizeEbook.mockImplementation(async (source: string) => ({
      success: true, targetPath: target, format: 'epub', errors: [], sourceFile: source,
      inventory: { kind: 'ebook', files: [source], complete: true },
      record: { source, target: source, status: 'identical', verified: true },
    }));

    await runOrganize({ downloadPath: target, cleanupSource: true, selectedFiles: ['Book.epub'] });

    expect(fs.existsSync(epub)).toBe(true);
  });
});
