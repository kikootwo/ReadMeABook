/**
 * Component: Cleanup Seeded Torrents Processor Tests - torrents shared by several requests (#283)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * The seeding cleanup removes a shared torrent only when every request using it would let it go:
 * each other active request is finished (an audiobook also imported by RMAB since it took the torrent)
 * and its own indexer's seeding requirement is met. Deleted and cancelled requests: holds.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { HASH, SLOW, UNCONFIGURED, sharedTorrentFixtures } from '../helpers/shared-torrent-fixtures';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const downloadClientManagerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

const { req, setup, rowsMarkedRemoved, run } = sharedTorrentFixtures(prismaMock, configMock, downloadClientManagerMock);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cleanup of a torrent shared by several requests (#283)', () => {
  it('removes it once when three finished requests have all met the seeding requirement', async () => {
    const client = setup([req('req-a'), req('req-b'), req('req-c')]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(client.deleteDownload).toHaveBeenCalledWith(HASH, true);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b', 'dh-req-c']);
    expect(result.errors).toBe(0);
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
  });

  it('marks the rows of requests that took the torrent over (series pack) when the owner removes it', async () => {
    // The 2nd and 3rd request found the pack already in the client: never removed through their own rows
    const client = setup([
      req('req-a', {}, { addedByRmab: false }),
      req('req-b', { type: 'ebook', status: 'downloaded' }, { addedByRmab: false }),
      req('req-c'),
    ]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b', 'dh-req-c']);
    expect(result.errors).toBe(0);
  });

  it('marks a sibling whose torrent is already gone in a later run, without errors', async () => {
    const client = setup([req('req-a'), req('req-b')]);
    client.probeDownload.mockImplementation(async () => ({ found: false }));

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
    expect(result.errors).toBe(0);
  });

  it.each(['downloading', 'processing', 'downloaded', 'failed'])('keeps it while another request is %s', async (status) => {
    const client = setup([req('req-a'), req('req-b'), req('req-c', { status }, { downloadStatus: 'downloading' })]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it.each([
    ['its own indexer asks for longer seeding', SLOW],
    ['its own indexer is not configured (seeds forever)', UNCONFIGURED],
    ['it was recorded for another download client', { downloadClient: 'transmission' }],
  ])('keeps it when a finished request still needs it: %s', async (_label, row) => {
    const client = setup([req('req-a'), req('req-b', {}, row)]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual([]);
    expect(result.errors).toBe(0);
  });

  // A late joiner on a pack that has already seeded: it took the torrent days after the owner
  const LATE_JOINER_ROW = { addedByRmab: false, createdAt: new Date('2026-10-05T12:00:00Z') };

  it.each([
    ['a library scan marked it available while its organize is still copying', { status: 'processing', filePath: null, completedAt: null }],
    ['it is only matched in the library (no RMAB import)', { status: 'requested', filePath: null, completedAt: null }],
    ['the only import of the book is older than its row', { status: 'completed', filePath: '/library/Book 2', completedAt: new Date('2026-09-01T12:00:00Z') }],
  ])('keeps it for an available audiobook RMAB has not imported from it: %s', async (_label, audiobook) => {
    const client = setup([req('req-a'), req('req-b', { audiobook }, LATE_JOINER_ROW)]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it('lets it go once RMAB has imported the late joiner from it', async () => {
    const imported = { status: 'completed', filePath: '/library/Book 2', completedAt: new Date('2026-10-05T12:30:00Z') };
    const client = setup([req('req-a'), req('req-b', { audiobook: imported }, LATE_JOINER_ROW)]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
    expect(result.errors).toBe(0);
  });

  it('removes it through a soft-deleted owner when the only active sibling is finished and done seeding', async () => {
    const client = setup([req('req-a', { deletedAt: new Date() }), req('req-b', {}, { addedByRmab: false })]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-b']);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-a' } });
    expect(result.errors).toBe(0);
  });

  it('a soft-deleted request whose own rule is met lets go: the active owner removes it, marks its row, and it is hard-deleted', async () => {
    const client = setup([req('req-a'), req('req-b', { deletedAt: new Date() })]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-b' } });
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
    expect(result.errors).toBe(0);
  });

  it('marks only rows recorded for the configured client type', async () => {
    const client = setup([req('req-a'), req('req-b', { status: 'cancelled' }, { downloadClient: 'transmission' })]);

    await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a']);
  });
});
