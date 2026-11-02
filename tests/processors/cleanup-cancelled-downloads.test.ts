/**
 * Component: Cleanup Seeded Torrents - Cancelled-Download Pass Tests
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Fails on main: there is no pass, so a torrent left by a cancel is never removed. A small
 * in-memory store answers the queries by their `where` shape (not by call order).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const managerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn(), getClientForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const createdAt = new Date('2026-10-01T12:00:00Z');
const UPGRADED = new Date('2026-11-01T00:00:00Z');

interface Row {
  id: string; requestId: string; selected: boolean; downloadStatus: string | null; torrentHash: string | null;
  downloadClientId: string | null; downloadClient: string; indexerName: string; indexerId: number; createdAt: Date;
  addedByRmab: boolean | null; completedAt: Date | null; nzbId: string | null;
}
interface Req {
  id: string; status: string; type: string; audiobookId: string; deletedAt: Date | null; cancelledAt: Date | null;
  audiobook: { status: string; filePath: string | null; completedAt: Date | null } | null; downloadHistory: Row[];
}

let store: Req[] = [];
const hash = (n: number) => n.toString(16).padStart(40, '0');

function row(requestId: string, h: string, overrides: Partial<Row> = {}): Row {
  return {
    id: `dh-${requestId}`, requestId, selected: true, downloadStatus: 'downloading', torrentHash: h, downloadClientId: h,
    downloadClient: 'qbittorrent', indexerName: 'Tracker', indexerId: 1, createdAt, addedByRmab: true, completedAt: null,
    nzbId: null, ...overrides,
  };
}

function req(id: string, overrides: Partial<Req> = {}, r?: Partial<Row> | null, h = hash(1)): Req {
  return {
    id, status: 'cancelled', type: 'audiobook', audiobookId: 'ab-1', deletedAt: null, cancelledAt: UPGRADED, audiobook: null,
    downloadHistory: r === null ? [] : [row(id, h, r)], ...overrides,
  };
}

const notGone = (r: Row) => r.downloadStatus !== 'removed' && r.downloadStatus !== 'failed';
const forms = (where: any) => (where.downloadHistory?.some?.torrentHash?.in ?? []).map((f: string) => f.toLowerCase());

function wireStore() {
  prismaMock.request.findMany.mockImplementation(async (args: any) => {
    const where = args.where;
    const and = where.AND ?? [];
    const gt = and.find((c: any) => c.id?.gt)?.id.gt;
    if (and.some((c: any) => c.status === 'cancelled')) {
      // The pass's page query (the real filter is asserted separately)
      return store
        .filter((r) => r.status === 'cancelled' && r.cancelledAt && !r.deletedAt && (!gt || r.id > gt))
        .filter((r) => r.downloadHistory.some((d) => d.selected && d.torrentHash && notGone(d) && d.addedByRmab !== false))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, args.take)
        .map((r) => ({ id: r.id, audiobookId: r.audiobookId, type: r.type, downloadHistory: [...r.downloadHistory].filter((d) => d.selected).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, 1) }));
    }
    if (where.AND) return []; // the seeding pass's page query: no seeding candidates here
    const hashes = forms(where);
    const usesIt = (r: Req) => r.downloadHistory.filter((d) => d.selected && hashes.includes((d.torrentHash ?? '').toLowerCase()));
    return store
      .filter((r) => r.id !== where.id?.not && (where.deletedAt === null ? !r.deletedAt : !!r.deletedAt))
      .filter((r) => usesIt(r).length > 0)
      .map((r) => ({ ...r, downloadHistory: usesIt(r) }));
  });
  prismaMock.request.findFirst.mockImplementation(async (args: any) => {
    const w = args.where;
    return store.find((r) => r.id !== w.id?.not && r.audiobookId === w.audiobookId && r.type === w.type && !r.deletedAt
      && w.status.in.includes(r.status) && !r.downloadHistory.some((d) => d.selected)) ?? null;
  });
  prismaMock.downloadHistory.findFirst.mockImplementation(async (args: any) => {
    const r = store.find((q) => q.id === args.where.requestId);
    const d = r?.downloadHistory.find((x) => x.id === args.where.id && x.selected && x.downloadStatus !== 'removed');
    return r && d && r.status === 'cancelled' && !r.deletedAt ? { id: d.id } : null;
  });
  prismaMock.downloadHistory.update.mockImplementation(async (args: any) => {
    const d = store.flatMap((r) => r.downloadHistory).find((x) => x.id === args.where.id);
    if (d) Object.assign(d, args.data);
    return d;
  });
  prismaMock.downloadHistory.updateMany.mockImplementation(async (args: any) => {
    const hashes = args.where.torrentHash.in.map((f: string) => f.toLowerCase());
    const rows = store.filter((r) => r.id !== args.where.requestId.not).flatMap((r) => r.downloadHistory)
      .filter((d) => d.selected && hashes.includes((d.torrentHash ?? '').toLowerCase()) && d.downloadStatus !== 'removed');
    rows.forEach((d) => Object.assign(d, args.data));
    return { count: rows.length };
  });
}

let torrents: Record<string, { status: string; progress: number; seedingTime: number }> = {};
function qbit() {
  const c: any = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    probeDownload: vi.fn(async (id: string) => {
      const t = torrents[id];
      return t ? { found: true, info: { id, name: `T-${id.slice(-3)}`, ratio: 0, addedAt: new Date(createdAt.getTime() + 5000), ...t } } : { found: false };
    }),
    deleteDownload: vi.fn(async (id: string) => { delete torrents[id]; }),
  };
  managerMock.getClientServiceForProtocol.mockResolvedValue(c);
  return c;
}

async function runJob() {
  const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
  return processCleanupSeededTorrents({ jobId: 'job-c' });
}

beforeEach(() => {
  vi.clearAllMocks();
  store = [];
  torrents = {};
  configMock.get.mockResolvedValue(JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 60, ratioLimit: 0 }]));
  wireStore();
});

describe('cancelled-download pass', () => {
  it('removes a partial torrent left by a post-upgrade cancel and reports it in its own counts', async () => {
    store = [req('req-1')];
    torrents[hash(1)] = { status: 'downloading', progress: 0.5, seedingTime: 0 };
    const c = qbit();

    const result = await runJob();

    expect(c.deleteDownload).toHaveBeenCalledWith(hash(1), true);
    expect(store[0].downloadHistory[0].downloadStatus).toBe('removed');
    expect(result.cancelled).toMatchObject({ checked: 1, removed: 1, errors: 0, stoppedEarly: false });
    expect(result.skipped).toBe(0);
  });

  it('queries only post-upgrade cancels, torrent rows not gone and RMAB\'s (NULL-safe), newest selected row only', async () => {
    qbit();
    await runJob();
    const call = prismaMock.request.findMany.mock.calls.map(([a]: any[]) => a).find((a: any) => a.where.AND?.[0]?.status === 'cancelled');
    expect(call.where.AND[0]).toEqual({
      status: 'cancelled',
      cancelledAt: { not: null },
      deletedAt: null,
      downloadHistory: { some: {
        selected: true,
        torrentHash: { not: null },
        AND: [
          { OR: [{ downloadStatus: null }, { downloadStatus: { notIn: ['removed', 'failed'] } }] },
          { OR: [{ addedByRmab: true }, { addedByRmab: null }] },
        ],
      } },
    });
    expect(call.select.downloadHistory).toEqual({ where: { selected: true }, orderBy: { createdAt: 'desc' }, take: 1 });
    expect(call.orderBy).toEqual({ id: 'asc' });
    expect(call).not.toHaveProperty('cursor');
  });

  it('a request cancelled before the upgrade (cancelledAt NULL) is never touched, even finished with its rule met', async () => {
    store = [req('req-old', { cancelledAt: null }, { downloadStatus: 'completed' })];
    torrents[hash(1)] = { status: 'seeding', progress: 1, seedingTime: 999 * 60 };
    const c = qbit();

    const result = await runJob();

    expect(c.probeDownload).not.toHaveBeenCalled();
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(result.cancelled).toMatchObject({ checked: 0 });
  });

  it('a finished torrent is kept until its rule is met, then removed on a later run', async () => {
    store = [req('req-1')];
    torrents[hash(1)] = { status: 'seeding', progress: 1, seedingTime: 10 * 60 };
    const c = qbit();

    expect((await runJob()).cancelled).toMatchObject({ keptSeeding: 1, removed: 0 });
    expect(store[0].downloadHistory[0].downloadStatus).toBe('completed');
    expect(c.deleteDownload).not.toHaveBeenCalled();

    torrents[hash(1)].seedingTime = 61 * 60;
    expect((await runJob()).cancelled).toMatchObject({ removed: 1 });
    expect(c.deleteDownload).toHaveBeenCalledWith(hash(1), true);
    expect(store[0].downloadHistory[0].downloadStatus).toBe('removed');

    // Gone: it drops out of the query
    expect((await runJob()).cancelled).toMatchObject({ checked: 0 });
  });

  it('a finished torrent under unlimited seeding is recorded once, then costs no client call', async () => {
    configMock.get.mockResolvedValue(JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 0, ratioLimit: 0 }]));
    store = [req('req-1')];
    torrents[hash(1)] = { status: 'seeding', progress: 1, seedingTime: 0 };
    const c = qbit();

    expect((await runJob()).cancelled).toMatchObject({ keptUnlimited: 1 });
    expect(c.probeDownload).toHaveBeenCalledTimes(1);
    expect((await runJob()).cancelled).toMatchObject({ keptUnlimited: 1 });
    expect(c.probeDownload).toHaveBeenCalledTimes(1);
  });

  it('visits 250 candidates over 3 keyset pages (id > last), each once', async () => {
    store = Array.from({ length: 250 }, (_, i) => req(`req-${String(i).padStart(4, '0')}`, {}, {}, hash(i + 1)));
    for (let i = 1; i <= 250; i++) torrents[hash(i)] = { status: 'seeding', progress: 1, seedingTime: 0 };
    const c = qbit();

    const result = await runJob();

    const pages = prismaMock.request.findMany.mock.calls.map(([a]: any[]) => a).filter((a: any) => a.where.AND?.[0]?.status === 'cancelled');
    expect(pages).toHaveLength(3);
    expect(pages.map((p: any) => p.where.AND[1]?.id?.gt)).toEqual([undefined, 'req-0099', 'req-0199']);
    expect(pages.every((p: any) => p.take === 100)).toBe(true);
    expect(c.probeDownload).toHaveBeenCalledTimes(250);
    expect(new Set(c.probeDownload.mock.calls.map(([id]: string[]) => id)).size).toBe(250);
    expect(result.cancelled).toMatchObject({ checked: 250, keptSeeding: 250 });
  });

  it('stops after 3 lookup errors in a row and changes nothing', async () => {
    store = [req('req-1', {}, {}, hash(1)), req('req-2', {}, {}, hash(2)), req('req-3', {}, {}, hash(3)), req('req-4', {}, {}, hash(4))];
    const c = qbit();
    c.probeDownload.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await runJob();

    expect(c.probeDownload).toHaveBeenCalledTimes(3);
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(result.cancelled).toMatchObject({ errors: 3, stoppedEarly: true });
  });

  it('steps that make no client call do not reset the count: client down, still stops after 3 errors', async () => {
    configMock.get.mockResolvedValue(JSON.stringify([
      { id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 60, ratioLimit: 0 },
      { id: 2, name: 'Free', protocol: 'torrent', seedingTimeMinutes: 0, ratioLimit: 0 },
    ]));
    // A recorded unlimited finish (indexer 2) is decided without a client call
    const noCall = { downloadStatus: 'completed', indexerId: 2, indexerName: 'Free' };
    store = [
      req('req-1', {}, {}, hash(1)), req('req-2', {}, noCall, hash(2)), req('req-3', {}, {}, hash(3)),
      req('req-4', {}, noCall, hash(4)), req('req-5', {}, {}, hash(5)), req('req-6', {}, {}, hash(6)),
    ];
    const c = qbit();
    c.probeDownload.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await runJob();

    expect(c.probeDownload.mock.calls.map(([id]: string[]) => id)).toEqual([hash(1), hash(3), hash(5)]);
    expect(result.cancelled).toMatchObject({ errors: 3, keptUnlimited: 2, stoppedEarly: true });
  });

  it('a lookup the client answers resets the count', async () => {
    store = [1, 2, 3, 4, 5].map((n) => req(`req-${n}`, {}, {}, hash(n)));
    torrents[hash(3)] = { status: 'seeding', progress: 1, seedingTime: 0 };
    const c = qbit();
    const answer = c.probeDownload.getMockImplementation();
    c.probeDownload.mockImplementation(async (id: string) => {
      if (id === hash(3)) return answer(id);
      throw new Error('ETIMEDOUT');
    });

    const result = await runJob();

    expect(c.probeDownload).toHaveBeenCalledTimes(5);
    expect(result.cancelled).toMatchObject({ errors: 4, keptSeeding: 1, stoppedEarly: false });
  });

  it('is skipped when the seeding pass stopped early', async () => {
    store = [req('req-1')];
    const c = qbit();
    c.probeDownload.mockRejectedValue(new Error('ETIMEDOUT'));
    const seeding = Array.from({ length: 3 }, (_, i) => ({
      id: `s-${i}`, deletedAt: null, downloadHistory: [{ ...row(`s-${i}`, hash(100 + i)), downloadStatus: 'completed' }],
    }));
    prismaMock.request.findMany.mockImplementationOnce(async () => seeding);

    const result = await runJob();

    expect(result.stoppedEarly).toBe(true);
    expect(result.cancelled).toBeNull();
    expect(prismaMock.request.findMany.mock.calls.some(([a]: any[]) => a.where.AND?.[0]?.status === 'cancelled')).toBe(false);
  });

  it('a pass failure never fails the job', async () => {
    store = [req('req-1')];
    qbit();
    prismaMock.downloadHistory.findFirst.mockReset();
    prismaMock.request.findMany.mockImplementation(async (args: any) => {
      if (args.where.AND?.[0]?.status === 'cancelled') throw new Error('db gone');
      return [];
    });
    const result = await runJob();
    expect(result.success).toBe(true);
    expect(result.cancelled).toMatchObject({ errors: 1 });
  });
});

describe('a cancel during the add (qBittorrent lists the torrent a moment later)', () => {
  it('the cancel finds it not listed yet and writes nothing; the next cleanup removes it', async () => {
    const justAdded = new Date(Date.now() - 500);
    store = [req('req-1', {}, { createdAt: justAdded })];
    const c = qbit();
    const listed = { id: hash(1), name: 'Book', status: 'downloading', progress: 0.2, seedingTime: 0, ratio: 0, addedAt: new Date(justAdded.getTime() + 200) };
    c.probeDownload.mockResolvedValueOnce({ found: false }).mockResolvedValue({ found: true, info: listed });

    const { handleCancelledDownload } = await import('@/lib/services/cancelled-download');
    const { CancelDeadline } = await import('@/lib/services/cancel-deadline');
    const first = await handleCancelledDownload(
      { id: 'req-1', audiobookId: 'ab-1', type: 'audiobook' }, store[0].downloadHistory[0] as any, { mode: 'cancel', deadline: CancelDeadline.in(10_000) }
    );

    expect(first.outcome).toBe('retry_later');
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(store[0].downloadHistory[0].downloadStatus).toBe('downloading');
    expect(c.deleteDownload).not.toHaveBeenCalled();

    const result = await runJob();

    expect(c.deleteDownload).toHaveBeenCalledWith(hash(1), true);
    expect(store[0].downloadHistory[0].downloadStatus).toBe('removed');
    expect(result.cancelled).toMatchObject({ checked: 1, removed: 1 });
  });
});

describe('re-request on the same torrent', () => {
  it('a new request downloading the same torrent keeps it; once it is imported and done seeding, the cancelled one lets go', async () => {
    const newer = req('req-new', { status: 'downloading', cancelledAt: null, audiobook: { status: 'downloading', filePath: null, completedAt: null } });
    store = [req('req-old'), newer];
    torrents[hash(1)] = { status: 'downloading', progress: 0.5, seedingTime: 0 };
    const c = qbit();

    expect((await runJob()).cancelled).toMatchObject({ keptShared: 1 });
    expect(c.deleteDownload).not.toHaveBeenCalled();

    // The new request finishes, is imported, and seeds past its rule
    torrents[hash(1)] = { status: 'seeding', progress: 1, seedingTime: 61 * 60 };
    newer.status = 'available';
    newer.downloadHistory[0].downloadStatus = 'completed';
    newer.audiobook = { status: 'completed', filePath: '/library/book', completedAt: new Date(createdAt.getTime() + 3_600_000) };
    store[0].downloadHistory[0].downloadStatus = 'completed';

    const result = await runJob();
    expect(c.deleteDownload).toHaveBeenCalledWith(hash(1), true);
    expect(result.cancelled).toMatchObject({ removed: 1 });
    expect(newer.downloadHistory[0].downloadStatus).toBe('removed');
  });

  it('another request for the same book searching without a download yet keeps it', async () => {
    store = [req('req-old'), req('req-new', { status: 'searching', cancelledAt: null }, null)];
    torrents[hash(1)] = { status: 'downloading', progress: 0.5, seedingTime: 0 };
    const c = qbit();

    expect((await runJob()).cancelled).toMatchObject({ keptShared: 1 });
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('a request recycled by an import (processing) is no longer a cancelled-pass candidate', async () => {
    store = [req('req-1', { status: 'processing' })];
    torrents[hash(1)] = { status: 'downloading', progress: 0.5, seedingTime: 0 };
    const c = qbit();

    expect((await runJob()).cancelled).toMatchObject({ checked: 0 });
    expect(c.probeDownload).not.toHaveBeenCalled();
  });
});
