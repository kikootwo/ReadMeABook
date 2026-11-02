/**
 * Component: Cleanup Seeded Torrents Processor Tests - paging and the "gone" marker (#258)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Every candidate is checked (keyset pages of 100, not just the first 100). A torrent
 * that is definitely gone from the client marks its row 'removed', so it stops filling
 * the pages; a probe error changes nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const downloadClientManagerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

const createdAt = new Date('2026-10-01T12:00:00Z');

interface PageQuery {
  orderBy?: { id?: string };
  take?: number;
  cursor?: unknown;
  where: { AND: unknown[] };
}

function request(n: number, deletedAt: Date | null = null) {
  const id = `req-${String(n).padStart(4, '0')}`;
  const hash = `hash-${n}`;
  return {
    id,
    deletedAt,
    downloadHistory: [{
      id: `dh-${n}`, selected: true, downloadStatus: 'completed', torrentHash: hash, downloadClientId: hash,
      downloadClient: 'qbittorrent', indexerName: 'Tracker', indexerId: 1, createdAt, addedByRmab: true,
    }],
  };
}

const info = (id: string, seedingTime = 10) => ({
  id, name: id, status: 'seeding', progress: 1, seedingTime, ratio: 0, addedAt: new Date(createdAt.getTime() + 1000),
});

function client(probe: (id: string) => Promise<unknown>) {
  const c = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    getDownload: vi.fn(),
    probeDownload: vi.fn(probe),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(c);
  return c;
}

async function run() {
  const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
  return processCleanupSeededTorrents({ jobId: 'job-1' });
}

const removedMarks = () =>
  prismaMock.downloadHistory.update.mock.calls.filter(([arg]) => arg?.data?.downloadStatus === 'removed').map(([arg]) => arg.where.id);

describe('processCleanupSeededTorrents paging and marker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.findMany.mockReset();
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.delete.mockResolvedValue({});
    prismaMock.downloadHistory.update.mockResolvedValue({});
    configMock.get.mockResolvedValue(JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 60, ratioLimit: 0 }]));
  });

  it('checks all 250 candidates over 3 keyset pages, even when the last row of page 1 is hard-deleted', async () => {
    const all = Array.from({ length: 250 }, (_, i) => request(i + 1, i === 99 ? new Date() : null));
    // Pages in id order; other queries (the shared-torrent check) find nothing
    const pageCalls: PageQuery[] = [];
    prismaMock.request.findMany.mockImplementation(async (arg: PageQuery) => {
      if (arg?.orderBy?.id !== 'asc') return [];
      pageCalls.push(arg);
      return [all.slice(0, 100), all.slice(100, 200), all.slice(200)][pageCalls.length - 1] ?? [];
    });
    // Row 100 (soft-deleted, seeding met) is cleaned and hard-deleted; the rest still seed
    const c = client(async (id) => ({ found: true, info: info(id, id === 'hash-100' ? 99999 : 10) }));

    const result = await run();

    expect(c.probeDownload).toHaveBeenCalledTimes(250);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-0100' } });
    expect(result).toMatchObject({ pages: 3, totalChecked: 250, cleaned: 1, skipped: 249 });

    const calls = pageCalls;
    expect(calls).toHaveLength(3);
    for (const arg of calls) {
      expect(arg.orderBy).toEqual({ id: 'asc' });
      expect(arg.take).toBe(100);
      expect(arg.cursor).toBeUndefined();
      // Only requests with a finished selected download use up page slots ('removed' rows drop out)
      expect(arg.where.AND).toContainEqual({ downloadHistory: { some: { selected: true, downloadStatus: 'completed' } } });
    }
    expect(calls[0].where.AND).not.toContainEqual(expect.objectContaining({ id: expect.anything() }));
    expect(calls[1].where.AND).toContainEqual({ id: { gt: 'req-0100' } });
    expect(calls[2].where.AND).toContainEqual({ id: { gt: 'req-0200' } });
  });

  it('marks a row removed when the client definitely no longer has the torrent, and removes nothing', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([request(1), request(2, new Date())]);
    const c = client(async () => ({ found: false }));

    const result = await run();

    expect(removedMarks()).toEqual(['dh-1', 'dh-2']);
    expect(c.deleteDownload).not.toHaveBeenCalled();
    // A soft-deleted request only gets the marker (no new hard-delete)
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
    expect(result.missing).toBe(2);
  });

  it.each([
    ['a timeout', Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' })],
    ['a 403 after re-login', new Error('Request failed with status code 403')],
    ['a 5xx', new Error('Request failed with status code 502')],
    ['an unclear answer', new Error('qBittorrent answered the lookup with HTTP 200 and text, not a torrent list')],
  ])('control: %s from the probe writes nothing and removes nothing', async (_label, error) => {
    prismaMock.request.findMany.mockResolvedValueOnce([request(1), request(2, new Date())]);
    const c = client(async () => { throw error; });

    const result = await run();

    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
    expect(c.deleteDownload).not.toHaveBeenCalled();
    expect(result.errors).toBe(2);
  });

  it('marks the row removed after RMAB removes the torrent of an active request', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([request(1)]);
    const c = client(async (id) => ({ found: true, info: info(id, 99999) }));

    await run();

    expect(c.deleteDownload).toHaveBeenCalledWith('hash-1', true);
    expect(removedMarks()).toEqual(['dh-1']);
  });

  it('marks a second active row with the same hash removed in the same run, without a second remove', async () => {
    const twin = request(2);
    twin.downloadHistory[0].torrentHash = 'hash-1';
    twin.downloadHistory[0].downloadClientId = 'hash-1';
    prismaMock.request.findMany.mockResolvedValueOnce([request(1), twin]);
    prismaMock.request.findMany.mockResolvedValue([]);
    const c = client(async (id) => ({ found: true, info: info(id, 99999) }));

    await run();

    expect(c.deleteDownload).toHaveBeenCalledTimes(1);
    expect(removedMarks()).toEqual(['dh-1', 'dh-2']);
  });

  it('never marks a row of another client type, even when its hash was removed earlier in the run', async () => {
    const twin = request(2);
    twin.downloadHistory[0].torrentHash = 'hash-1';
    twin.downloadHistory[0].downloadClientId = 'hash-1';
    twin.downloadHistory[0].downloadClient = 'transmission';
    prismaMock.request.findMany.mockResolvedValueOnce([request(1), twin]);
    prismaMock.request.findMany.mockResolvedValue([]);
    const c = client(async (id) => ({ found: true, info: info(id, 99999) }));

    const result = await run();

    expect(c.deleteDownload).toHaveBeenCalledTimes(1);
    expect(removedMarks()).toEqual(['dh-1']);
    expect(result.otherClient).toBe(1);
  });

  it('stops the run after 3 probe errors in a row, changing nothing (the next run tries again)', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce(Array.from({ length: 6 }, (_, i) => request(i + 1)));
    const c = client(async () => { throw Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' }); });

    const result = await run();

    expect(c.probeDownload).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ errors: 3, stoppedEarly: true });
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.request.findMany.mock.calls.filter(([arg]) => arg?.orderBy?.id === 'asc')).toHaveLength(1);
  });

  it('control: an answer between probe errors resets the count', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce(Array.from({ length: 6 }, (_, i) => request(i + 1)));
    const c = client(async (id) => {
      // errors on 1, 2, 4, 5: never 3 in a row
      if (id === 'hash-3' || id === 'hash-6') return { found: true, info: info(id, 10) };
      throw new Error('Request failed with status code 502');
    });

    const result = await run();

    expect(c.probeDownload).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({ errors: 4, stoppedEarly: false });
  });

  it('uses the strict probe only (no getDownload with its 3.5 s of not-found retries)', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([request(1)]);
    const c = client(async () => ({ found: false }));

    await run();

    expect(c.probeDownload).toHaveBeenCalledWith('hash-1');
    expect(c.getDownload).not.toHaveBeenCalled();
  });
});
