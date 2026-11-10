/**
 * Component: Shared-Torrent Fixtures for the Seeding Cleanup Tests (#283, #545)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Fixture requests answer the processor's queries: `request.findMany` (the candidate page, the active
 * and the soft-deleted shared-torrent queries; the cancelled-download pass finds nothing) and the rows
 * an `updateMany` marks 'removed' are read back by evaluating its `where` over the fixture rows.
 */

import { vi } from 'vitest';
import type { createPrismaMock } from './prisma';

export const HASH = 'abcdef0123456789abcdef0123456789abcdef01';
export const CREATED_AT = new Date('2026-10-01T12:00:00Z');
/** The client's added time: one minute after the rows' grab (true rows and legacy rows in the window are RMAB's) */
export const ADDED_AT = new Date(CREATED_AT.getTime() + 60 * 1000);
// 40 minutes seeded: IndexerA (30 min) is met, Slow (600 min) is not, Unconfigured seeds forever
export const INDEXERS = [
  { id: 1, name: 'IndexerA', protocol: 'torrent', seedingTimeMinutes: 30, ratioLimit: 0 },
  { id: 2, name: 'Slow', protocol: 'torrent', seedingTimeMinutes: 600, ratioLimit: 0 },
];
export const SLOW = { indexerName: 'Slow', indexerId: 2 };
export const UNCONFIGURED = { indexerName: 'Unconfigured', indexerId: 9 };

export interface Fixture {
  id: string;
  type: string;
  status: string;
  deletedAt: Date | null;
  audiobook: { status: string; filePath: string | null; completedAt: Date | null } | null;
  downloadHistory: Record<string, unknown>[];
}

type Where = Record<string, unknown>;

/** Enough of Prisma's `where` for the shared-torrent queries: equality, `not`, `in`, `OR`, `AND` */
function matches(value: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((c) => matches(value, c));
    if (key === 'AND') return (cond as Where[]).every((c) => matches(value, c));
    const actual = value[key] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; in?: unknown[] };
      if ('in' in c) return (c.in ?? []).includes(actual);
      if ('not' in c) return c.not === null ? actual !== null : actual !== c.not;
    }
    return actual === cond;
  });
}

const FINISHED = (r: Fixture) => (r.type === 'audiobook' && r.status === 'available') || (r.type === 'ebook' && r.status === 'downloaded');

export function sharedTorrentFixtures(
  prismaMock: ReturnType<typeof createPrismaMock>,
  configMock: { get: ReturnType<typeof vi.fn> },
  managerMock: { getClientServiceForProtocol: ReturnType<typeof vi.fn> }
) {
  let requests: Fixture[] = [];

  const rowsOf = (r: Fixture, rowWhere: Where) => r.downloadHistory
    .filter((h) => matches({ ...h, requestId: r.id }, rowWhere))
    .map((h) => ({ addedByRmab: null, downloadStatus: null, ...h }));

  // Installed per test: the suite config resets mock implementations before each test
  const answerQueries = () => prismaMock.request.findMany.mockImplementation(async (args: { where?: Where }) => {
    const where = (args?.where ?? {}) as Where & { AND?: Where[]; id?: { not?: string }; deletedAt?: unknown };
    // The cancelled-download pass (its own tests) finds no candidates here
    if (where.AND?.some((c) => c.status === 'cancelled')) return [];
    if (where.AND) {
      // The candidate page: one page, finished or soft-deleted requests with a completed selected row
      return where.AND.some((c) => (c.id as { gt?: string } | undefined)?.gt) ? [] : requests
        .filter((r) => r.deletedAt !== null || FINISHED(r))
        .filter((r) => r.downloadHistory.some((h) => h.selected && h.downloadStatus === 'completed'));
    }
    // A shared-torrent query: active (`deletedAt: null`) or soft-deleted (`deletedAt: { not: null }`)
    const rowWhere = (where.downloadHistory as { some: Where }).some;
    const deleted = where.deletedAt !== null;
    return requests
      .filter((r) => r.id !== where.id?.not && (r.deletedAt !== null) === deleted)
      .filter((r) => rowsOf(r, rowWhere).length > 0)
      .map((r) => ({ ...r, downloadHistory: rowsOf(r, rowWhere) }));
  });

  /** A finished audiobook request (RMAB imported it after its row took the torrent) with one completed row on HASH */
  function req(id: string, fields: Partial<Fixture> = {}, row: Record<string, unknown> = {}): Fixture {
    return {
      id,
      type: 'audiobook',
      status: 'available',
      deletedAt: null,
      audiobook: { status: 'completed', filePath: `/library/${id}`, completedAt: new Date('2026-10-01T13:00:00Z') },
      downloadHistory: [{
        id: `dh-${id}`,
        selected: true,
        downloadStatus: 'completed',
        indexerName: 'IndexerA',
        indexerId: 1,
        torrentHash: HASH,
        downloadClientId: HASH,
        downloadClient: 'qbittorrent',
        addedByRmab: true,
        createdAt: CREATED_AT,
        ...row,
      }],
      ...fields,
    };
  }

  /** The client answer: seeding for `seededMinutes`, added at `addedAt`; gone once deleted */
  function setup(fixtures: Fixture[], { seededMinutes = 40, addedAt = ADDED_AT as Date | undefined } = {}) {
    requests = fixtures;
    answerQueries();
    configMock.get.mockResolvedValue(JSON.stringify(INDEXERS));
    const client = {
      clientType: 'qbittorrent',
      protocol: 'torrent',
      probeDownload: vi.fn(async () => (client.deleteDownload.mock.calls.length
        ? { found: false }
        : { found: true, info: { id: HASH, name: 'Series Pack', status: 'seeding', progress: 1, seedingTime: 60 * seededMinutes, ratio: 0, addedAt } })),
      deleteDownload: vi.fn().mockResolvedValue(undefined),
    };
    managerMock.getClientServiceForProtocol.mockResolvedValue(client);
    return client;
  }

  /** Download rows the run marked 'removed' (one by one, or by an `updateMany` over the fixture rows) */
  function rowsMarkedRemoved(): string[] {
    const one = (prismaMock.downloadHistory.update.mock.calls as [{ where: { id: string }; data?: { downloadStatus?: string } }][])
      .filter(([args]) => args.data?.downloadStatus === 'removed')
      .map(([args]) => args.where.id);
    const many = (prismaMock.downloadHistory.updateMany.mock.calls as [{ where: Where; data?: { downloadStatus?: string } }][])
      .filter(([args]) => args.data?.downloadStatus === 'removed')
      .flatMap(([args]) => requests.flatMap((r) => rowsOf(r, args.where).map((h) => h.id as string)));
    return [...new Set([...one, ...many])].sort();
  }

  /** Requests the run hard-deleted */
  const hardDeleted = () => (prismaMock.request.delete.mock.calls as [{ where: { id: string } }][]).map(([a]) => a.where.id).sort();

  async function run() {
    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    return processCleanupSeededTorrents({ jobId: 'job-shared' });
  }

  return { req, setup, rowsMarkedRemoved, hardDeleted, run };
}
