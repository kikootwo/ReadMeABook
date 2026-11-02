/**
 * Component: In-memory library tables for the library-link processor tests (#284)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * A plain holder wired into the prisma mock in beforeEach (never a vi.mock factory implementation):
 * plex_library, audiobooks and requests, with the subset of Prisma's where clause the scan jobs use.
 */

import type { createPrismaMock } from './prisma';

export type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
interface Args {
  where?: Where;
  data?: Row;
  select?: Record<string, boolean>;
  include?: { requests?: unknown };
}

export interface LibraryDb {
  plex: Row[];
  audiobooks: Row[];
  requests: Row[];
  /** When set, each matchable-request read waits until this many callers have read (forces the race). */
  barrier: number;
  /** Runs once right after the first matchable-request read (another job completing the request). */
  afterRead: null | (() => void);
}

export function createLibraryDb(): LibraryDb {
  return { plex: [], audiobooks: [], requests: [], barrier: 0, afterRead: null };
}

export function resetLibraryDb(db: LibraryDb): void {
  Object.assign(db, createLibraryDb());
}

/** Equality, notIn, in, contains, not, OR. */
function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((c) => matches(row, c));
    const value = row[key] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const op = cond as { notIn?: unknown[]; in?: unknown[]; contains?: string; not?: unknown };
      if (op.notIn) return !op.notIn.includes(value);
      if (op.in) return op.in.includes(value);
      if (op.contains !== undefined) return typeof value === 'string' && value.includes(op.contains);
      if ('not' in op) return value !== op.not;
      return false;
    }
    return value === cond;
  });
}

function pick(row: Row, select: Record<string, boolean> | undefined): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((k) => [k, row[k] ?? null]));
}

function assign(row: Row | undefined, data: Row | undefined): Row {
  if (!row) throw new Error('row not found');
  for (const [k, v] of Object.entries(data ?? {})) if (v !== undefined) row[k] = v;
  return row;
}

export function wireLibraryDb(prismaMock: ReturnType<typeof createPrismaMock>, db: LibraryDb, mediaDir: string): void {
  const plexBy = (w: Where = {}) => db.plex.find((r) => (w.id ? r.id === w.id : r.plexGuid === w.plexGuid));
  prismaMock.plexLibrary.findFirst.mockImplementation(async (a: Args) => plexBy(a.where) ?? null);
  prismaMock.plexLibrary.findUnique.mockImplementation(async (a: Args) => plexBy(a.where) ?? null);
  prismaMock.plexLibrary.create.mockImplementation(async (a: Args) => {
    if (plexBy({ plexGuid: a.data?.plexGuid })) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const row: Row = { id: `row-${db.plex.length + 1}`, filePath: null, asin: null, ...a.data };
    db.plex.push(row);
    return row;
  });
  prismaMock.plexLibrary.update.mockImplementation(async (a: Args) => assign(plexBy(a.where), a.data));
  prismaMock.plexLibrary.findMany.mockImplementation(async (a?: Args) => db.plex.filter((r) => matches(r, a?.where)).map((r) => pick(r, a?.select)));
  prismaMock.plexLibrary.delete.mockImplementation(async (a: Args) => {
    db.plex = db.plex.filter((r) => r.id !== a.where?.id);
    return {};
  });

  prismaMock.audiobook.findMany.mockImplementation(async (a?: Args) => db.audiobooks.filter((r) => matches(r, a?.where)).map((r) => {
    const out = pick(r, a?.select);
    if (a?.include?.requests) out.requests = db.requests.filter((q) => q.audiobookId === r.id && q.deletedAt === null);
    return out;
  }));
  prismaMock.audiobook.findFirst.mockResolvedValue(null);
  prismaMock.audiobook.update.mockImplementation(async (a: Args) => assign(db.audiobooks.find((r) => r.id === a.where?.id), a.data));

  const withRequest = (r: Row): Row => ({ ...r, audiobook: { ...db.audiobooks.find((a) => a.id === r.audiobookId) }, user: { plexUsername: 'reader' } });
  let readers = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  prismaMock.request.findMany.mockImplementation(async (a?: Args) => {
    const rows = db.requests.filter((r) => matches(r, a?.where)).map(withRequest);
    if (db.barrier > 0) {
      readers++;
      if (readers >= db.barrier) release();
      await gate;
    }
    const after = db.afterRead;
    db.afterRead = null;
    after?.();
    return rows;
  });
  prismaMock.request.update.mockImplementation(async (a: Args) => assign(db.requests.find((r) => r.id === a.where?.id), a.data));
  prismaMock.request.updateMany.mockImplementation(async (a: Args) => {
    const rows = db.requests.filter((r) => matches(r, a.where));
    rows.forEach((r) => assign(r, a.data));
    return { count: rows.length };
  });

  prismaMock.configuration.findUnique.mockImplementation(async (a: Args) => (a.where?.key === 'media_dir' ? { key: 'media_dir', value: mediaDir } : null));
}
