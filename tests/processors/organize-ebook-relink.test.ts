/**
 * Component: Organize Files Processor Tests, an ebook request that outlived its audiobook request (#526)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * After an audiobook request delete, its delivered ebook request stays with parentRequestId null.
 * A re-request's import links it to the new audiobook request, so the fetch-ebook route (which
 * looks the ebook request up by parent) finds it instead of opening a second one. The requests
 * table is an in-memory holder shared by the real organize processor and the real route.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const organizerMock = vi.hoisted(() => ({ organize: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({
  addNotificationJob: vi.fn(() => Promise.resolve()),
  addSearchEbookJob: vi.fn(() => Promise.resolve()),
}));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/file-organizer', () => ({ getFileOrganizer: () => organizerMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => ({ triggerLibraryScan: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: vi.fn(async () => null) }),
}));
vi.mock('@/lib/utils/format-coercion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/format-coercion')>()),
  coerceToPlexCompatible: vi.fn(async (paths: string[]) => ({ renamed: [], warnings: [], errors: [], finalAudioFiles: paths })),
}));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: vi.fn((_req: unknown, handler: (req: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } })),
  requireAdmin: vi.fn((_req: unknown, handler: () => unknown) => handler()),
}));

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** The requests table (a plain holder, reset in beforeEach). */
let rows: Row[] = [];
let root: string;
let seq = 0;

const BOOK = { id: 'a1', title: 'Book', author: 'Author', narrator: null, coverArtUrl: null, audibleAsin: 'ASIN1' };

/** Equality (null included), `in`, `notIn`, `not`. */
function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const op = cond as { in?: unknown[]; notIn?: unknown[]; not?: unknown };
      if (op.in) return op.in.includes(value);
      if (op.notIn) return !op.notIn.includes(value);
      if ('not' in op) return value !== op.not;
      return false;
    }
    return value === cond;
  });
}

function newest(found: Row[]): Row[] {
  return [...found].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
}

function withInclude(row: Row | undefined, include?: { audiobook?: unknown; user?: unknown }): Row | null {
  if (!row) return null;
  return { ...row, ...(include?.audiobook ? { audiobook: BOOK } : {}), ...(include?.user ? { user: { plexUsername: 'u' } } : {}) };
}

function request(id: string, fields: Row): Row {
  return { id, userId: 'user-1', audiobookId: 'a1', parentRequestId: null, deletedAt: null, customSearchTerms: null, createdAt: new Date(Date.UTC(2026, 0, ++seq)), ...fields };
}

const ebookRows = () => rows.filter((r) => r.type === 'ebook' && r.deletedAt === null);

async function importAudiobook(requestId: string) {
  const targetPath = await fs.mkdtemp(path.join(root, 'book-'));
  await fs.writeFile(path.join(targetPath, '01.mp3'), 'x');
  organizerMock.organize.mockResolvedValue({ success: true, targetPath, filesMovedCount: 1, errors: [], audioFiles: [path.join(targetPath, '01.mp3')] });
  const { processOrganizeFiles } = await import('@/lib/processors/organize-files.processor');
  const result = await processOrganizeFiles({ requestId, audiobookId: 'a1', downloadPath: path.join(root, 'dl'), jobId: `job-${requestId}` });
  expect(result.success).toBe(true);
}

async function fetchEbook(parentRequestId: string) {
  const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
  const response = await POST({} as Parameters<typeof POST>[0], { params: Promise.resolve({ id: parentRequestId }) });
  return { status: response.status, body: await response.json() };
}

describe('an ebook request that outlived its audiobook request, after a re-request (#526)', () => {
  beforeAll(async () => {
    await import('@/lib/processors/organize-files.processor');
    await import('@/app/api/requests/[id]/fetch-ebook/route');
  }, 60000);

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-526-relink-'));
    seq = 0;
    rows = [
      // The deleted audiobook request and the ebook request that stayed, unlinked, after its delete
      request('req-old', { type: 'audiobook', status: 'downloaded', deletedAt: new Date() }),
      request('ebook-survivor', { type: 'ebook', status: 'downloaded', completedAt: new Date() }),
      // The re-request, now importing
      request('req-new', { type: 'audiobook', status: 'processing' }),
    ];
    prismaMock.request.findUnique.mockImplementation(async (args: { where: { id: string }; include?: Row }) =>
      withInclude(rows.find((r) => r.id === args.where.id), args.include as never));
    prismaMock.request.findFirst.mockImplementation(async (args: { where?: Where; include?: Row }) =>
      withInclude(newest(rows.filter((r) => matches(r, args.where)))[0], args.include as never));
    prismaMock.request.update.mockImplementation(async (args: { where: { id: string }; data: Row }) => {
      const row = rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`no request ${args.where.id}`);
      return Object.assign(row, args.data);
    });
    prismaMock.request.updateMany.mockImplementation(async (args: { where?: Where; data: Row }) => {
      const hit = rows.filter((r) => matches(r, args.where));
      hit.forEach((r) => Object.assign(r, args.data));
      return { count: hit.length };
    });
    prismaMock.request.create.mockImplementation(async (args: { data: Row }) => {
      const row = request(`ebook-created-${rows.length}`, args.data);
      rows.push(row);
      return row;
    });
    prismaMock.audiobook.findUnique.mockResolvedValue(BOOK);
    prismaMock.audiobook.findMany.mockResolvedValue([]);
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'ebook_annas_archive_enabled' ? { key: where.key, value: 'true' } : null);
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.get.mockImplementation(async (key: string) => (key === 'ebook_annas_archive_enabled' ? 'true' : null));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('the import links the surviving ebook request to the new audiobook request and creates none', async () => {
    await importAudiobook('req-new');

    expect(ebookRows().map((r) => [r.id, r.parentRequestId])).toEqual([['ebook-survivor', 'req-new']]);
    expect(rows.find((r) => r.id === 'ebook-survivor')).toMatchObject({ status: 'downloaded', deletedAt: null });
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
  });

  it('links it with ebook auto-grab off too (the manual routes still look it up by parent)', async () => {
    configMock.get.mockImplementation(async (key: string) => (key === 'ebook_auto_grab_enabled' ? 'false' : null));
    await importAudiobook('req-new');

    expect(rows.find((r) => r.id === 'ebook-survivor')?.parentRequestId).toBe('req-new');
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('Fetch e-book on the new request then finds the survivor and creates nothing', async () => {
    await importAudiobook('req-new');
    expect(rows.find((r) => r.id === 'req-new')?.status).toBe('downloaded');

    const { status, body } = await fetchEbook('req-new');

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: false, requestId: 'ebook-survivor', message: 'E-book request already exists (status: downloaded)' });
    expect(ebookRows().map((r) => r.id)).toEqual(['ebook-survivor']);
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
  });

  it('leaves a survivor another import linked first alone (compare-and-set), and creates none', async () => {
    // Another import claims it between this import's lookup and its write
    const realUpdateMany = prismaMock.request.updateMany.getMockImplementation()!;
    prismaMock.request.updateMany.mockImplementation(async (args: { where?: Where; data: Row }) => {
      if (args.data.parentRequestId === 'req-new') {
        rows.push(request('req-other', { type: 'audiobook', status: 'downloaded' }));
        Object.assign(rows.find((r) => r.id === 'ebook-survivor')!, { parentRequestId: 'req-other' });
      }
      return realUpdateMany(args);
    });
    await importAudiobook('req-new');

    expect(rows.find((r) => r.id === 'ebook-survivor')?.parentRequestId).toBe('req-other');
    expect(ebookRows()).toHaveLength(1);
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('leaves a survivor already linked to another request alone', async () => {
    rows.push(request('req-other', { type: 'audiobook', status: 'downloaded' }));
    Object.assign(rows.find((r) => r.id === 'ebook-survivor')!, { parentRequestId: 'req-other' });
    await importAudiobook('req-new');

    expect(rows.find((r) => r.id === 'ebook-survivor')?.parentRequestId).toBe('req-other');
    expect(ebookRows()).toHaveLength(1);
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('links nothing when the new request already has its own ebook request', async () => {
    rows.push(request('ebook-own', { type: 'ebook', status: 'pending', parentRequestId: 'req-new' }));
    await importAudiobook('req-new');

    expect(rows.find((r) => r.id === 'ebook-survivor')?.parentRequestId).toBeNull();
    expect(rows.find((r) => r.id === 'ebook-own')?.parentRequestId).toBe('req-new');
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });
});
