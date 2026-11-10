/**
 * Component: Cleanup Seeded Torrents Processor Tests - deleted and cancelled requests on a shared torrent (#545)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * A deleted or cancelled request keeps a finished torrent only through a row that owns it, and only
 * until its own indexer's rule is met (a cancelled one with unlimited seeding: forever). An active
 * request that only took the torrent over can never remove it, so a soft-deleted owner it holds stays.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { ADDED_AT, SLOW, UNCONFIGURED, sharedTorrentFixtures } from '../helpers/shared-torrent-fixtures';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const downloadClientManagerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

const { req, setup, rowsMarkedRemoved, hardDeleted, run } = sharedTorrentFixtures(prismaMock, configMock, downloadClientManagerMock);

const DELETED = { deletedAt: new Date('2026-10-02T12:00:00Z') };
const CANCELLED = { status: 'cancelled' };

/** Ownership of the other request's row, judged on the client's added time (ADDED_AT) */
const OWNED: [string, Record<string, unknown>][] = [
  ['added by RMAB', { addedByRmab: true }],
  ['a legacy row grabbed inside the window', { addedByRmab: null }],
];
const NOT_OWNED: [string, Record<string, unknown>][] = [
  ['taken over', { addedByRmab: false }],
  ['a legacy row outside the window', { addedByRmab: null, createdAt: new Date(ADDED_AT.getTime() + 2 * 60 * 60 * 1000) }],
  ['recorded for another client', { addedByRmab: true, downloadClient: 'transmission' }],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a soft-deleted request on the torrent (#545 a)', () => {
  it.each(OWNED)('keeps it until its own rule is met when its row owns it (%s)', async (_label, own) => {
    const client = setup([req('req-a'), req('req-b', DELETED, { ...SLOW, ...own })]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual([]);
    expect(hardDeleted()).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it.each(NOT_OWNED)('never keeps it through a row that does not own it (%s)', async (_label, own) => {
    const client = setup([req('req-a'), req('req-b', DELETED, { ...SLOW, ...own })]);

    await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toContain('dh-req-a');
  });

  it('lets go once its own rule is met: removed once, its row marked, then it is hard-deleted', async () => {
    const client = setup([req('req-a'), req('req-b', DELETED, SLOW)], { seededMinutes: 601 });

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
    expect(hardDeleted()).toEqual(['req-b']);
    expect(result.errors).toBe(0);
  });

  it('with unlimited seeding it never keeps it (the cleanup forgets it without a removal)', async () => {
    const client = setup([req('req-a'), req('req-b', DELETED, UNCONFIGURED)]);

    await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(hardDeleted()).toEqual(['req-b']);
  });

  it('a row with no recorded status (NULL) is live: it keeps the torrent, and is marked once its rule is met', async () => {
    const client = setup([req('req-a'), req('req-b', DELETED, { ...SLOW, downloadStatus: null })]);
    await run();
    expect(client.deleteDownload).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const again = setup([req('req-a'), req('req-b', DELETED, { downloadStatus: null })]);
    await run();
    expect(again.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
  });

  it('a soft-deleted candidate kept by another deleted request stays soft-deleted (probed again next run)', async () => {
    const client = setup([req('req-a', DELETED), req('req-b', DELETED, SLOW)]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(hardDeleted()).toEqual([]);
    expect(result.skipped).toBe(2);
  });
});

describe('an active request on the torrent', () => {
  it('a soft-deleted owner kept by an active request that owns the torrent is hard-deleted (that request removes it later)', async () => {
    const client = setup([req('req-a', DELETED), req('req-b', { status: 'downloading' }, { downloadStatus: 'downloading' })]);

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(hardDeleted()).toEqual(['req-a']);
  });

  it('a soft-deleted owner kept by an active request that only took the torrent over stays soft-deleted', async () => {
    const client = setup([
      req('req-a', DELETED),
      req('req-b', { status: 'downloading' }, { downloadStatus: 'downloading', addedByRmab: false }),
    ]);

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(hardDeleted()).toEqual([]);
  });

  it('an active request whose only row on the torrent is removed no longer keeps it', async () => {
    const client = setup([req('req-a'), req('req-b', { status: 'downloading' }, { downloadStatus: 'removed' })]);

    await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
  });

  it('a soft-deleted owner held for good by a takeover is logged at info on its first run only', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    setup([
      req('req-log', DELETED),
      req('req-log-b', { status: 'downloading' }, { downloadStatus: 'downloading', addedByRmab: false }),
    ]);
    const keptLines = () => info.mock.calls.map(([line]) => String(line))
      .filter((line) => /has met seeding requirement|Skipping download deletion|Kept deleted request req-log/.test(line));

    await run();
    expect(keptLines()).toHaveLength(3);

    info.mockClear();
    const result = await run();
    expect(keptLines()).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(hardDeleted()).toEqual([]);
    info.mockRestore();
  });
});

describe('a row without a stored hash (its client id is the hash)', () => {
  it('still asks the rule: an active request downloading the torrent keeps it', async () => {
    const client = setup([req('req-a', {}, { torrentHash: null }), req('req-b', { status: 'downloading' }, { downloadStatus: 'downloading' })]);

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
  });

  it('once removed, the other requests\' rows are marked by the client id', async () => {
    const client = setup([req('req-a', {}, { torrentHash: null }), req('req-b', CANCELLED)]);

    await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
  });
});

describe('the other requests\' rows once the torrent is removed', () => {
  it('a grab that lands just after the client delete keeps its row live', async () => {
    const fixtures = [req('req-a'), req('req-b', CANCELLED)];
    const client = setup(fixtures);
    client.deleteDownload.mockImplementation(async () => {
      // Another request grabs the same torrent again: its row is written after the delete
      fixtures.push(req('req-new', { status: 'downloading' }, { downloadStatus: 'downloading', createdAt: new Date(Date.now() + 1) }));
    });

    await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
  });
});

describe('a cancelled request on the torrent (#545 b)', () => {
  it.each(OWNED)('lets go once its own rule is met (%s): removed, and its row marked removed', async (_label, own) => {
    const client = setup([req('req-a'), req('req-b', CANCELLED, own)]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
    expect(result.errors).toBe(0);
  });

  it.each(OWNED)('keeps it until its own rule is met when its row owns it (%s)', async (_label, own) => {
    const client = setup([req('req-a'), req('req-b', CANCELLED, { ...SLOW, ...own })]);

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual([]);
  });

  it.each(NOT_OWNED)('never keeps it through a row that does not own it, on a slow indexer (%s)', async (_label, own) => {
    const client = setup([req('req-a'), req('req-b', CANCELLED, { ...SLOW, ...own })]);

    await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
  });

  it.each(OWNED)('with unlimited seeding it keeps it forever when its row owns it (%s)', async (_label, own) => {
    const client = setup([req('req-a'), req('req-b', CANCELLED, { ...UNCONFIGURED, ...own })], { seededMinutes: 100_000 });

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
  });

  it.each(NOT_OWNED)('with unlimited seeding it never keeps it through a row that does not own it (%s)', async (_label, own) => {
    const client = setup([req('req-a'), req('req-b', CANCELLED, { ...UNCONFIGURED, ...own })]);

    await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
  });

  it('a soft-deleted candidate kept forever by a cancelled request is hard-deleted (nothing would ever release it)', async () => {
    const client = setup([req('req-a', DELETED), req('req-b', CANCELLED, UNCONFIGURED)]);

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(hardDeleted()).toEqual(['req-a']);
  });

  it('a soft-deleted candidate kept by a cancelled request until its rule is met stays soft-deleted', async () => {
    const client = setup([req('req-a', DELETED), req('req-b', CANCELLED, SLOW)]);

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(hardDeleted()).toEqual([]);
  });
});
