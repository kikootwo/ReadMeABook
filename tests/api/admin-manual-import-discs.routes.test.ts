/**
 * Component: Admin Manual Import + Browse API Tests, multi-disc folders (real filesystem)
 * Documentation: documentation/features/manual-import.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({ addOrganizeJob: vi.fn(() => Promise.resolve()) }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
  AuthenticatedRequest: {},
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: vi.fn(async () => null) }),
}));

let root: string;
let book: string;
/** Forward-slash form the routes resolve paths to. */
const fwd = (p: string) => path.resolve(p).replace(/\\/g, '/');

function mkfile(rel: string, base = book, content = 'audio'): void {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

async function postImport(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/admin/manual-import/route');
  const response = await POST({
    json: vi.fn().mockResolvedValue({ asin: 'B0E2E43401', ...body }),
    nextUrl: new URL('http://localhost/api/admin/manual-import'),
  } as unknown as Parameters<typeof POST>[0]);
  return { status: response.status, payload: await response.json() };
}

async function browse(dir: string) {
  const { GET } = await import('@/app/api/admin/filesystem/browse/route');
  const url = new URL(`http://localhost/api/admin/filesystem/browse?path=${encodeURIComponent(dir)}`);
  const response = await GET({ nextUrl: url } as unknown as Parameters<typeof GET>[0]);
  return { status: response.status, payload: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-mi-discs-')));
  book = path.join(root, 'Book [B0E2E43401]');
  ['Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 2/01.m4a', 'Extras/bonus.m4a'].forEach((f) => mkfile(f));
  requireAuthMock.mockImplementation((_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } }));
  requireAdminMock.mockImplementation((_req: unknown, handler: () => unknown) => handler());
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) =>
    where?.key === 'download_dir' ? { value: root } : null
  );
  prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', audibleAsin: 'B0E2E43401' });
  prismaMock.audiobook.findUnique.mockResolvedValue({
    id: 'ab-1', audibleAsin: 'B0E2E43401', title: 'Book', author: 'Author', series: 'S', year: 2020,
  });
  prismaMock.request.findFirst.mockResolvedValue(null);
  prismaMock.request.create.mockResolvedValue({ id: 'req-1' });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('manual import of a multi-disc book folder', () => {
  it('accepts a folder that holds only disc folders and fills in the book set (Extras left out)', async () => {
    const { status } = await postImport({ folderPath: book, cleanupSource: true });
    expect(status).toBe(200);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-1', 'ab-1', fwd(book), undefined, true, ['Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 2/01.m4a']
    );
  });

  it('accepts selectedFiles naming files inside disc folders', async () => {
    const { status } = await postImport({ folderPath: book, selectedFiles: ['Disc 1/01.m4a', 'Disc 2/01.m4a'] });
    expect(status).toBe(200);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith(
      'req-1', 'ab-1', fwd(book), undefined, false, ['Disc 1/01.m4a', 'Disc 2/01.m4a']
    );
  });

  it.each([
    ['..'], ['../x.m4a'], ['Disc 1/../Disc 2/01.m4a'], ['Disc 1/../../x.m4a'], ['Extras/bonus.m4a'],
    ['/etc/Disc 1/01.m4a'], ['Disc 1\\01.m4a'], ['./Disc 1/01.m4a'], ['Disc 1//01.m4a'], ['Disc 1/01.m4a\0'],
  ])('refuses selectedFiles %j with a 400 and queues nothing', async (entry) => {
    const { status } = await postImport({ folderPath: book, selectedFiles: [entry] });
    expect(status).toBe(400);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('a configured root never qualifies through the disc rule (no selectedFiles: 400)', async () => {
    ['CD1/01.mp3', 'CD2/01.mp3'].forEach((f) => mkfile(f, root));
    const { status, payload } = await postImport({ folderPath: root });
    expect(status).toBe(400);
    expect(payload.error).toBe('No audio files found in the selected directory');
  });

  it('a folder with its own audio and no selectedFiles is queued as today (no file list)', async () => {
    mkfile('Intro.m4a');
    const { status } = await postImport({ folderPath: book });
    expect(status).toBe(200);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith('req-1', 'ab-1', fwd(book), undefined, false, undefined);
  });
});

describe('browse of a multi-disc book folder', () => {
  it('lists the disc folders\' audio as relative names, disc by disc, with sizes', async () => {
    mkfile('Disc 10/01.m4a', book, 'longer-audio');
    const { status, payload } = await browse(book);
    expect(status).toBe(200);
    expect(payload.audioFiles).toEqual([
      { name: 'Disc 1/01.m4a', size: 5 }, { name: 'Disc 1/02.m4a', size: 5 }, { name: 'Disc 2/01.m4a', size: 5 },
      { name: 'Disc 10/01.m4a', size: 12 },
    ]);
    expect(payload.entries.map((e: { name: string }) => e.name)).toEqual(['Disc 1', 'Disc 10', 'Disc 2', 'Extras']);
  });

  it('a plain folder and a configured root list only their own audio', async () => {
    ['CD1/01.mp3', 'CD2/01.mp3'].forEach((f) => mkfile(f, root));
    mkfile('own.mp3', root);
    const { payload } = await browse(root);
    expect(payload.audioFiles).toEqual([{ name: 'own.mp3', size: 5 }]);
  });
});
