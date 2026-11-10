/**
 * Component: Request Deletion - Download Handling Tests (deleted and cancelled requests on a shared torrent, #545)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * A request delete applies the shared-torrent rule (`torrentHolds`): a deleted or cancelled request keeps
 * a finished torrent only through a row that owns it, until its own indexer's rule is met; neither keeps
 * a partial one. For holds, only a clearly partial torrent counts as partial.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const managerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const HASH = 'abcdef0123456789abcdef0123456789abcdef01';
const CREATED_AT = new Date('2026-10-01T12:00:00Z');
const ADDED_AT = new Date(CREATED_AT.getTime() + 60 * 1000);
const SEEDING = { status: 'seeding', progress: 1 };
const PARTIAL = { status: 'downloading', progress: 0.4 };

/** The deleted request's own row: RMAB's, on Fast (30 min; 40 min seeded = met) */
function ownRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'dh-1', requestId: 'req-1', selected: true, torrentHash: HASH, downloadClientId: HASH, downloadClient: 'qbittorrent',
    indexerName: 'Fast', indexerId: 1, downloadStatus: 'completed', completedAt: null, addedByRmab: true, createdAt: CREATED_AT, nzbId: null,
    ...overrides,
  };
}

/** Another request's row on the same torrent; Slow = 600 min (not met) */
const otherRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'dh-2', indexerId: 2, indexerName: 'Slow', downloadClient: 'qbittorrent', createdAt: CREATED_AT, downloadStatus: 'completed', addedByRmab: true,
  ...overrides,
});

const OWNED: [string, Record<string, unknown>][] = [
  ['added by RMAB', {}],
  ['a legacy row grabbed inside the window', { addedByRmab: null }],
];
const NOT_OWNED: [string, Record<string, unknown>][] = [
  ['taken over', { addedByRmab: false }],
  ['a legacy row outside the window', { addedByRmab: null, createdAt: new Date(ADDED_AT.getTime() + 2 * 60 * 60 * 1000) }],
  ['recorded for another client', { downloadClient: 'transmission' }],
];

function db({ active = [] as any[], deleted = [] as any[] } = {}) {
  prismaMock.request.findMany.mockImplementation(async (args: any) => (args.where.deletedAt === null ? active : deleted));
}

const cancelled = (row: Record<string, unknown> = {}) =>
  ({ id: 'req-2', status: 'cancelled', type: 'audiobook', audiobook: null, downloadHistory: [otherRow(row)] });
const softDeleted = (row: Record<string, unknown> = {}) => ({ id: 'req-2', downloadHistory: [otherRow(row)] });

async function deleteWith(row: any, answer: Record<string, unknown>) {
  configMock.get.mockImplementation(async (key: string) => (key === 'prowlarr_indexers'
    ? JSON.stringify([
      { id: 1, name: 'Fast', protocol: 'torrent', seedingTimeMinutes: 30 },
      { id: 2, name: 'Slow', protocol: 'torrent', seedingTimeMinutes: 600 },
    ])
    : null));
  const client = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    getDownload: vi.fn().mockResolvedValue({ id: HASH, name: 'Book', seedingTime: 40 * 60, ratio: 0, addedAt: ADDED_AT, ...answer }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  managerMock.getClientServiceForProtocol.mockResolvedValue(client);
  const { cleanUpRequestDownload } = await import('@/lib/services/request-delete-download');
  return { counts: await cleanUpRequestDownload('req-1', row), client };
}

const statusWrites = () => prismaMock.downloadHistory.update.mock.calls.map(([a]: any[]) => a.data);
const otherRowsMarked = () => prismaMock.downloadHistory.updateMany.mock.calls.map(([a]: any[]) => a.where.requestId);

beforeEach(() => {
  vi.clearAllMocks();
  db();
});

describe('a soft-deleted request on the torrent (#545 a)', () => {
  it.each(OWNED)('keeps a finished torrent until its own rule is met (%s); the own row is recorded completed for the cleanup', async (_label, own) => {
    db({ deleted: [softDeleted(own)] });
    const { counts, client } = await deleteWith(ownRow({ downloadStatus: 'downloading' }), SEEDING);

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ torrentsKeptShared: 1, torrentsRemoved: 0 });
    expect(statusWrites()).toEqual([{ downloadStatus: 'completed', completedAt: expect.any(Date) }]);
  });

  it.each(NOT_OWNED)('never keeps it through a row that does not own it (%s)', async (_label, own) => {
    db({ deleted: [softDeleted(own)] });
    const { counts, client } = await deleteWith(ownRow(), SEEDING);

    expect(client.deleteDownload).toHaveBeenCalledWith(HASH, true);
    expect(counts.torrentsRemoved).toBe(1);
  });

  it('lets go once its own rule is met: removed, and the other requests\' rows marked removed', async () => {
    db({ deleted: [softDeleted({ indexerName: 'Fast', indexerId: 1 })] });
    const { counts } = await deleteWith(ownRow(), SEEDING);

    expect(counts.torrentsRemoved).toBe(1);
    expect(statusWrites()).toEqual([{ downloadStatus: 'removed' }]);
    expect(otherRowsMarked()).toEqual([{ not: 'req-1' }]);
  });

  it('is not even read for a partial torrent', async () => {
    db({ deleted: [softDeleted()] });
    const { counts } = await deleteWith(ownRow({ downloadStatus: 'downloading' }), PARTIAL);

    expect(counts.torrentsRemoved).toBe(1);
    expect(prismaMock.request.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('a cancelled request on the torrent (#545 b)', () => {
  it.each(OWNED)('never keeps a partial torrent (%s)', async (_label, own) => {
    db({ active: [cancelled({ ...own, downloadStatus: 'downloading' })] });
    const { counts, client } = await deleteWith(ownRow({ downloadStatus: 'downloading' }), PARTIAL);

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(counts.torrentsRemoved).toBe(1);
  });

  it.each(OWNED)('keeps a finished torrent until its own rule is met (%s)', async (_label, own) => {
    db({ active: [cancelled(own)] });
    const { counts, client } = await deleteWith(ownRow(), SEEDING);

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(counts.torrentsKeptShared).toBe(1);
  });

  it.each(NOT_OWNED)('never keeps it through a row that does not own it (%s)', async (_label, own) => {
    db({ active: [cancelled(own)] });
    const { counts } = await deleteWith(ownRow(), SEEDING);

    expect(counts.torrentsRemoved).toBe(1);
  });

  it('lets go once its own rule is met: removed, and its row marked removed', async () => {
    db({ active: [cancelled({ indexerName: 'Fast', indexerId: 1 })] });
    const { counts } = await deleteWith(ownRow(), SEEDING);

    expect(counts.torrentsRemoved).toBe(1);
    expect(otherRowsMarked()).toEqual([{ not: 'req-1' }]);
  });

  it('a recheck (checking at 40%) is not a partial torrent for holds: the cancelled owner keeps it', async () => {
    db({ active: [cancelled()] });
    const { counts, client } = await deleteWith(ownRow({ downloadStatus: 'downloading' }), { status: 'checking', progress: 0.4 });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(counts.torrentsKeptShared).toBe(1);
    expect(statusWrites()).toEqual([]);
  });
});

describe('an active request on the torrent', () => {
  it.each([...OWNED, ...NOT_OWNED])('keeps a partial torrent whatever its row (%s)', async (_label, own) => {
    db({ active: [{ ...cancelled({ ...own, downloadStatus: 'downloading' }), status: 'downloading' }] });
    const { counts, client } = await deleteWith(ownRow({ downloadStatus: 'downloading' }), PARTIAL);

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(counts.torrentsKeptShared).toBe(1);
  });

  it('whose only row on the torrent is removed no longer keeps it', async () => {
    db({ active: [{ ...cancelled({ downloadStatus: 'removed' }), status: 'downloading' }] });
    const { counts } = await deleteWith(ownRow({ downloadStatus: 'downloading' }), PARTIAL);

    expect(counts.torrentsRemoved).toBe(1);
  });
});
