/**
 * Component: Cancelled Request - Download Handling Tests (torrent)
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * Fails on main: a cancel never touched the client (the module is new).
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
const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MIN = 60 * 1000;
const REQUEST = { id: 'req-1', audiobookId: 'ab-1', type: 'audiobook' };

function row(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'dh-1', requestId: 'req-1', selected: true, downloadStatus: 'downloading', torrentHash: HASH,
    downloadClientId: HASH, downloadClient: 'qbittorrent', indexerName: 'Tracker', indexerId: 1, createdAt,
    addedByRmab: true, completedAt: null, nzbId: null, torrentName: 'Book', ...overrides,
  };
}

function info(overrides: Record<string, unknown> = {}) {
  return { id: HASH, name: 'Book', status: 'downloading', progress: 0.4, addedAt: new Date(createdAt.getTime() + 10_000), seedingTime: 0, ratio: 0, ...overrides };
}

interface Db {
  siblings?: any[];
  softDeleted?: any[];
  sameBook?: { id: string; status: string } | null;
  stillCancelled?: boolean;
}

function db({ siblings = [], softDeleted = [], sameBook = null, stillCancelled = true }: Db = {}) {
  prismaMock.request.findMany.mockImplementation(async (args: any) => (args.where.deletedAt === null ? siblings : softDeleted));
  prismaMock.request.findFirst.mockResolvedValue(sameBook);
  prismaMock.downloadHistory.findFirst.mockResolvedValue(stillCancelled ? { id: 'dh-1' } : null);
  prismaMock.downloadHistory.update.mockResolvedValue({});
  prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 0 });
}

function client(probe: any = { found: true, info: info() }, clientType = 'qbittorrent') {
  const c: any = {
    clientType,
    protocol: 'torrent',
    probeDownload: typeof probe === 'function' ? vi.fn(probe) : vi.fn().mockResolvedValue(probe),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  managerMock.getClientServiceForProtocol.mockResolvedValue(c);
  return c;
}

const indexers = (seedingTimeMinutes: number, ratioLimit = 0) =>
  configMock.get.mockResolvedValue(JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes, ratioLimit }]));

async function cancelStep(r: any, deadlineMs?: number) {
  const { handleCancelledDownload } = await import('@/lib/services/cancelled-download');
  const { CancelDeadline } = await import('@/lib/services/cancel-deadline');
  return handleCancelledDownload(REQUEST, r, { mode: 'cancel', deadline: CancelDeadline.in(deadlineMs ?? 10_000) });
}

const statusWrites = () => prismaMock.downloadHistory.update.mock.calls.map(([a]: any[]) => a.data);

beforeEach(() => {
  vi.clearAllMocks();
  indexers(60);
  db();
});

describe('partial torrent', () => {
  it('removes a partial torrent RMAB added, with its files, and records it removed', async () => {
    const c = client();
    const res = await cancelStep(row());

    expect(res.outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledWith(HASH, true);
    expect(statusWrites()).toEqual([{ downloadStatus: 'removed' }]);
  });

  it('removes a partial torrent whatever the seeding rule (unlimited, no indexer settings)', async () => {
    configMock.get.mockResolvedValue(null);
    const c = client({ found: true, info: info({ status: 'paused', progress: 0.1 }) });
    expect((await cancelStep(row())).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledTimes(1);
  });

  it('keeps a torrent in an unclear state: checking at 40% with a completed time is never "partial"', async () => {
    const c = client({ found: true, info: info({ status: 'checking', progress: 0.4, completedAt: new Date() }) });
    const res = await cancelStep(row());
    expect(res.outcome).toBe('retry_later');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([]);
  });

  it.each(['failed', 'processing'])('keeps a torrent in state %s', async (status) => {
    const c = client({ found: true, info: info({ status }) });
    expect((await cancelStep(row())).outcome).toBe('retry_later');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });
});

describe('finished torrent', () => {
  it('keeps it to seed (60 min rule, 5 min seeded) and records completed', async () => {
    const c = client({ found: true, info: info({ status: 'seeding', progress: 1, seedingTime: 5 * 60 }) });
    const res = await cancelStep(row());
    expect(res.outcome).toBe('kept_seeding');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([{ downloadStatus: 'completed', completedAt: expect.any(Date) }]);
  });

  it('removes it once its rule is met and nothing else holds it', async () => {
    const c = client({ found: true, info: info({ status: 'seeding', progress: 1, seedingTime: 61 * 60 }) });
    expect((await cancelStep(row())).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledWith(HASH, true);
  });

  it('keeps it under unlimited seeding and records completed', async () => {
    indexers(0, 0);
    const c = client({ found: true, info: info({ status: 'completed', progress: 1 }) });
    expect((await cancelStep(row())).outcome).toBe('kept_unlimited');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([{ downloadStatus: 'completed', completedAt: expect.any(Date) }]);
  });

  it('a row already recorded completed under unlimited seeding costs no client call', async () => {
    indexers(0, 0);
    const c = client();
    expect((await cancelStep(row({ downloadStatus: 'completed' }))).outcome).toBe('kept_unlimited');
    expect(c.probeDownload).not.toHaveBeenCalled();
  });

  it('a row recorded completed counts as finished even when the client reports progress < 1 (recheck)', async () => {
    const c = client({ found: true, info: info({ status: 'downloading', progress: 0.3 }) });
    expect((await cancelStep(row({ downloadStatus: 'completed' }))).outcome).toBe('kept_seeding');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('missing or unreadable indexer settings keep a finished torrent and write nothing', async () => {
    configMock.get.mockResolvedValue('not json');
    const c = client({ found: true, info: info({ status: 'seeding', progress: 1, seedingTime: 99999 }) });
    expect((await cancelStep(row())).outcome).toBe('retry_later');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([]);
  });
});

describe('ownership (#423)', () => {
  it.each([
    ['removed row', { downloadStatus: 'removed' }, 'none'],
    ['failed row', { downloadStatus: 'failed' }, 'none'],
    ['taken over', { addedByRmab: false }, 'kept_not_owned'],
  ])('%s: no client call', async (_label, overrides, outcome) => {
    const c = client();
    expect((await cancelStep(row(overrides))).outcome).toBe(outcome);
    expect(managerMock.getClientServiceForProtocol).not.toHaveBeenCalled();
    expect(c.probeDownload).not.toHaveBeenCalled();
  });

  it.each([
    ['re-added after the grab', {}, 2 * 60 * MIN],
    ['an older copy', {}, -25 * 60 * MIN],
    ['legacy row, unclear', { addedByRmab: null }, 60 * MIN],
  ])('%s: kept, nothing written', async (_label, overrides, offset) => {
    const c = client({ found: true, info: info({ addedAt: new Date(createdAt.getTime() + offset) }) });
    expect((await cancelStep(row(overrides))).outcome).toBe('kept_not_owned');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([]);
  });

  it('legacy row clearly taken over: kept and recorded not RMAB\'s', async () => {
    const c = client({ found: true, info: info({ addedAt: new Date(createdAt.getTime() - 48 * 60 * MIN) }) });
    expect((await cancelStep(row({ addedByRmab: null }))).outcome).toBe('kept_not_owned');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([{ addedByRmab: false }]);
  });

  it('legacy row inside the grab window is RMAB\'s and is removed', async () => {
    const c = client();
    expect((await cancelStep(row({ addedByRmab: null }))).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledTimes(1);
  });

  it('recorded for another client type than the configured one: no lookup', async () => {
    const c = client(undefined, 'transmission');
    expect((await cancelStep(row())).outcome).toBe('none');
    expect(c.probeDownload).not.toHaveBeenCalled();
  });

  it('just added and not listed yet (qBittorrent adds asynchronously): at cancel time nothing is written', async () => {
    const justNow = new Date(Date.now() - 1000);
    const c = client({ found: false });
    const res = await cancelStep(row({ createdAt: justNow }));
    expect(res).toMatchObject({ outcome: 'retry_later', probed: true });
    expect(res.missing).toBeUndefined();
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
  });

  it('the cleanup pass keeps the strict lookup: a young row not listed is recorded removed', async () => {
    const { handleCancelledDownload } = await import('@/lib/services/cancelled-download');
    client({ found: false });
    const res = await handleCancelledDownload(REQUEST, row({ createdAt: new Date() }), { mode: 'sweep' });
    expect(res).toMatchObject({ outcome: 'none', missing: true });
    expect(statusWrites()).toEqual([{ downloadStatus: 'removed' }]);
  });

  it('gone from the client: recorded removed, nothing deleted', async () => {
    const c = client({ found: false });
    const res = await cancelStep(row());
    expect(res).toMatchObject({ outcome: 'none', missing: true });
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([{ downloadStatus: 'removed' }]);
  });
});

describe('lookup errors and the deadline', () => {
  it('a lookup error deletes nothing and writes nothing', async () => {
    const c = client(async () => { throw new Error('ECONNREFUSED'); });
    expect(await cancelStep(row())).toMatchObject({ outcome: 'retry_later', probeError: true });
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([]);
  });

  it('a client without a strict lookup: nothing deleted', async () => {
    const c = client();
    delete c.probeDownload;
    expect((await cancelStep(row())).outcome).toBe('retry_later');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('a lookup that answers after the deadline: no delete and no write, even later', async () => {
    let answer: (v: unknown) => void = () => undefined;
    const c = client(() => new Promise((resolve) => { answer = resolve; }));
    const res = await cancelStep(row(), 30);
    expect(res).toMatchObject({ outcome: 'retry_later', probeError: true });

    answer({ found: true, info: info() }); // the late answer says "partial, ours"
    await new Promise((r) => setTimeout(r, 20));
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.updateMany).not.toHaveBeenCalled();
  });

  it('the deadline passing during the hold checks stops the delete', async () => {
    const c = client();
    prismaMock.request.findFirst.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return null;
    });
    expect((await cancelStep(row(), 20)).outcome).toBe('retry_later');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([]);
  });

  it('a failed delete is retried later and records nothing', async () => {
    const c = client();
    c.deleteDownload.mockRejectedValue(new Error('500'));
    expect((await cancelStep(row())).outcome).toBe('retry_later');
    expect(statusWrites()).toEqual([]);
  });
});

describe('holds', () => {
  const sibling = (status: string, extra: Record<string, unknown> = {}) => ({
    id: `req-${status}`, status, type: 'audiobook', audiobook: null,
    downloadHistory: [{ id: `dh-${status}`, indexerId: 1, indexerName: 'Tracker', downloadClient: 'qbittorrent', createdAt, downloadStatus: 'downloading' as string | null }],
    ...extra,
  });

  it('another request downloading the same torrent keeps a partial one', async () => {
    db({ siblings: [sibling('downloading')] });
    const c = client();
    expect((await cancelStep(row())).outcome).toBe('kept_shared');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('a cancelled sibling never holds a partial torrent, and its row is recorded removed too', async () => {
    db({ siblings: [sibling('cancelled')] });
    const c = client();
    expect((await cancelStep(row())).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledTimes(1);
    expect(prismaMock.downloadHistory.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestId: { not: 'req-1' }, selected: true }),
      data: { downloadStatus: 'removed' },
    }));
  });

  it('a stale sibling whose only row on the hash is removed no longer holds a partial torrent', async () => {
    const stale = sibling('available');
    stale.downloadHistory[0].downloadStatus = 'removed';
    db({ siblings: [stale] });
    const c = client();
    expect((await cancelStep(row())).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledTimes(1);
  });

  it('a sibling with one live row among removed ones still holds it', async () => {
    const live = sibling('downloading');
    live.downloadHistory = [{ ...live.downloadHistory[0], downloadStatus: 'removed' }, { ...live.downloadHistory[0], id: 'dh-live', downloadStatus: null }];
    db({ siblings: [live] });
    const c = client();
    expect((await cancelStep(row())).outcome).toBe('kept_shared');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });

  it('a stale failed sibling whose row is removed no longer holds a finished torrent past its rule', async () => {
    const stale = sibling('failed');
    stale.downloadHistory[0].downloadStatus = 'removed';
    db({ siblings: [stale] });
    const c = client({ found: true, info: info({ status: 'seeding', progress: 1, seedingTime: 61 * 60 }) });
    expect((await cancelStep(row())).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledTimes(1);
  });

  it('a soft-deleted request never holds a partial torrent', async () => {
    db({ softDeleted: [{ id: 'req-del', downloadHistory: [sibling('x').downloadHistory[0]] }] });
    const c = client();
    expect((await cancelStep(row())).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledTimes(1);
  });

  it('a soft-deleted request seeding the finished torrent holds it until its own rule is met', async () => {
    const holder = { id: 'req-del', downloadHistory: [{ id: 'dh-del', indexerId: 2, indexerName: 'Slow', downloadClient: 'qbittorrent', createdAt }] };
    db({ softDeleted: [holder] });
    configMock.get.mockResolvedValue(JSON.stringify([
      { id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 60 },
      { id: 2, name: 'Slow', protocol: 'torrent', seedingTimeMinutes: 600 },
    ]));
    const c = client({ found: true, info: info({ status: 'seeding', progress: 1, seedingTime: 120 * 60 }) });
    expect((await cancelStep(row())).outcome).toBe('kept_shared');
    expect(c.deleteDownload).not.toHaveBeenCalled();

    // Its own rule met by the same answer: it lets go
    c.probeDownload.mockResolvedValue({ found: true, info: info({ status: 'seeding', progress: 1, seedingTime: 601 * 60 }) });
    expect((await cancelStep(row())).outcome).toBe('removed');
  });

  it('another request for the same book searching without a download yet holds it', async () => {
    db({ sameBook: { id: 'req-new', status: 'searching' } });
    const c = client();
    expect((await cancelStep(row())).outcome).toBe('kept_shared');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        audiobookId: 'ab-1', type: 'audiobook', status: { in: ['searching', 'downloading'] },
        downloadHistory: { none: { selected: true } },
      }),
    }));
  });

  it('the re-read right before the delete finds the request replaced or recycled: no delete', async () => {
    db({ stillCancelled: false });
    const c = client();
    expect((await cancelStep(row())).outcome).toBe('none');
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'dh-1', selected: true, request: { status: 'cancelled', deletedAt: null } }),
    }));
  });
});
