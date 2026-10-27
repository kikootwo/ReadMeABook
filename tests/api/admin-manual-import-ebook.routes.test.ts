/**
 * Component: Admin Manual Import + Browse API Tests, ebook imports (#278, real filesystem)
 * Documentation: documentation/features/manual-import.md
 *
 * A book folder holds the audiobook's mp3 and the ebook's epub. An import for the ebook request
 * lists, accepts and queues only ebook files, and never recycles the audiobook request.
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

const ASIN = 'B0E2E27801';

interface Row {
  id: string;
  audiobookId: string;
  type: string;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  parentRequestId?: string | null;
}

let root: string;
let book: string;
let rows: Row[];
/** Forward-slash form the routes resolve paths to. */
const fwd = (p: string) => path.resolve(p).replace(/\\/g, '/');

function mkfile(rel: string, content: string) {
  const full = path.join(book, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** Enough of Prisma's `where` for the route's request lookups (id, audiobookId, type, deletedAt, status in). */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, want]) => {
    const have = (row as unknown as Record<string, unknown>)[key];
    const list = (want as { in?: unknown[] } | null)?.in;
    if (Array.isArray(list)) return list.includes(have);
    return have === want;
  });
}

async function postImport(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/admin/manual-import/route');
  const response = await POST({
    json: vi.fn().mockResolvedValue({ asin: ASIN, folderPath: book, ...body }),
    nextUrl: new URL('http://localhost/api/admin/manual-import'),
  } as unknown as Parameters<typeof POST>[0]);
  return { status: response.status, payload: await response.json() };
}

async function browse(dir: string, type?: string) {
  const { GET } = await import('@/app/api/admin/filesystem/browse/route');
  const query = `path=${encodeURIComponent(dir)}${type ? `&type=${encodeURIComponent(type)}` : ''}`;
  const response = await GET({ nextUrl: new URL(`http://localhost/api/admin/filesystem/browse?${query}`) } as unknown as Parameters<typeof GET>[0]);
  return { status: response.status, payload: await response.json() };
}

const updatedIds = () => prismaMock.request.update.mock.calls.map((c: Array<{ where: { id: string } }>) => c[0].where.id);

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-mi-ebook-')));
  book = path.join(root, `Book [${ASIN}]`);
  mkfile('Book.mp3', 'audio-bytes');
  mkfile('Book.epub', 'epub-bytes!');
  rows = [
    { id: 'req-ab', audiobookId: 'ab-1', type: 'audiobook', status: 'available', deletedAt: null, createdAt: new Date(1000) },
    { id: 'req-eb', audiobookId: 'ab-1', type: 'ebook', status: 'failed', deletedAt: null, createdAt: new Date(2000), parentRequestId: 'req-ab' },
  ];
  requireAuthMock.mockImplementation((_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } }));
  requireAdminMock.mockImplementation((_req: unknown, handler: () => unknown) => handler());
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where?: { key?: string } }) =>
    where?.key === 'download_dir' ? { value: root } : null
  );
  prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', audibleAsin: ASIN });
  prismaMock.audiobook.findUnique.mockResolvedValue({
    id: 'ab-1', audibleAsin: ASIN, title: 'Book', author: 'Author', narrator: 'Narrator', series: 'S', seriesPart: '1', year: 2020,
    status: 'completed', filePath: '/media/Author/Book',
  });
  prismaMock.request.findFirst.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) =>
    rows.filter((r) => matches(r, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  );
  prismaMock.request.update.mockImplementation(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id));
  prismaMock.request.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'req-new', ...data }));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('browse for an ebook import', () => {
  it('lists the folder\'s ebook files (not its audio) when asked for ebooks', async () => {
    const { status, payload } = await browse(book, 'ebook');
    expect(status).toBe(200);
    expect(payload.ebookFiles).toEqual([{ name: 'Book.epub', size: 11 }]);
    expect(payload.audioFiles).toBeUndefined();
  });

  it('still lists audio only for an audiobook import (no type, or type=audiobook)', async () => {
    for (const type of [undefined, 'audiobook']) {
      const { status, payload } = await browse(book, type);
      expect(status).toBe(200);
      expect(payload.audioFiles).toEqual([{ name: 'Book.mp3', size: 11 }]);
      expect(payload.ebookFiles).toBeUndefined();
    }
  });

  it('refuses an unknown type with a 400', async () => {
    const { status } = await browse(book, 'video');
    expect(status).toBe(400);
  });
});

describe('manual import from an ebook request', () => {
  it('accepts an epub and queues the ebook request for organize', async () => {
    const { status, payload } = await postImport({ requestId: 'req-eb', requestType: 'ebook', selectedFiles: ['Book.epub'] });
    expect(status).toBe(200);
    expect(payload.requestId).toBe('req-eb');
    expect(updatedIds()).toEqual(['req-eb']);
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-eb' },
      data: expect.objectContaining({ status: 'processing', errorMessage: null }),
    });
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith('req-eb', 'ab-1', fwd(book), undefined, false, ['Book.epub']);
  });

  it('refuses an audio file for an ebook request with a 400 and changes nothing', async () => {
    const { status, payload } = await postImport({ requestId: 'req-eb', requestType: 'ebook', selectedFiles: ['Book.mp3'] });
    expect(status).toBe(400);
    expect(payload.error).toBe('Not an ebook file: Book.mp3');
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('leaves an available audiobook request and its book row alone (whole folder, cleanup on)', async () => {
    const { status } = await postImport({ requestId: 'req-eb', requestType: 'ebook', cleanupSource: true });
    expect(status).toBe(200);
    expect(updatedIds()).not.toContain('req-ab');
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledTimes(1);
    // Only the folder's ebook files, so the import and its source cleanup stay off the mp3
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith('req-eb', 'ab-1', fwd(book), undefined, true, ['Book.epub']);
  });

  it('takes the type from the stored request: an audiobook request id flagged ebook is a 400', async () => {
    const { status } = await postImport({ requestId: 'req-ab', requestType: 'ebook', selectedFiles: ['Book.mp3'] });
    expect(status).toBe(400);
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('an ebook request id is an ebook import even without the flag (audio refused)', async () => {
    const { status } = await postImport({ requestId: 'req-eb', selectedFiles: ['Book.mp3'] });
    expect(status).toBe(400);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('creates an ebook request linked to the delivered audiobook when the book has none', async () => {
    rows = rows.filter((r) => r.type !== 'ebook');
    const { status, payload } = await postImport({ requestType: 'ebook', selectedFiles: ['Book.epub'] });
    expect(status).toBe(200);
    expect(prismaMock.request.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audiobookId: 'ab-1', type: 'ebook', status: 'processing', parentRequestId: 'req-ab', userId: 'admin-1' }),
    });
    expect(updatedIds()).not.toContain('req-ab');
    expect(payload.requestId).toBe('req-new');
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith('req-new', 'ab-1', fwd(book), undefined, false, ['Book.epub']);
  });

  it('answers 409 while the ebook request is being worked on', async () => {
    rows[1].status = 'downloading';
    const { status } = await postImport({ requestId: 'req-eb', requestType: 'ebook', selectedFiles: ['Book.epub'] });
    expect(status).toBe(409);
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it.each([['sub/Book.epub'], ['../Book.epub'], ['..'], ['Book.epub\\x']])('refuses ebook selection %j with a 400', async (entry) => {
    const { status } = await postImport({ requestId: 'req-eb', requestType: 'ebook', selectedFiles: [entry] });
    expect(status).toBe(400);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('a folder without ebook files is a 400 for an ebook import', async () => {
    fs.rmSync(path.join(book, 'Book.epub'));
    const { status, payload } = await postImport({ requestId: 'req-eb', requestType: 'ebook' });
    expect(status).toBe(400);
    expect(payload.error).toBe('No ebook files found in the selected directory');
  });

  it('a missing or deleted request id is a 404', async () => {
    rows[1].deletedAt = new Date();
    const { status } = await postImport({ requestId: 'req-eb', requestType: 'ebook', selectedFiles: ['Book.epub'] });
    expect(status).toBe(404);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('refuses an unknown request type with a 400', async () => {
    const { status } = await postImport({ requestType: 'video', selectedFiles: ['Book.mp3'] });
    expect(status).toBe(400);
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });
});

describe('manual import for an audiobook (the reverse)', () => {
  it('refuses an epub for the audiobook request with a 400', async () => {
    const { status, payload } = await postImport({ requestId: 'req-ab', selectedFiles: ['Book.epub'] });
    expect(status).toBe(400);
    expect(payload.error).toBe('Not an audio file: Book.epub');
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
  });

  it('without a request id still recycles the book\'s audiobook request, as before', async () => {
    rows[0].status = 'failed';
    const { status } = await postImport({ selectedFiles: ['Book.mp3'] });
    expect(status).toBe(200);
    expect(updatedIds()).toEqual(['req-ab']);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledWith('req-ab', 'ab-1', fwd(book), undefined, false, ['Book.mp3']);
  });
});
