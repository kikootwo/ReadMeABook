/**
 * Component: Cleanup Seeded Torrents - a torrent an admin added by hand (Add Torrent)
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * A hand-added torrent's row is labelled "Manual" with no indexer id: no indexer config matches it, so
 * it seeds without limit and the cleanup never removes it. In the same run a torrent from a configured
 * indexer whose limit is met is removed (the control).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { HASH, sharedTorrentFixtures } from '../helpers/shared-torrent-fixtures';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const downloadClientManagerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

const { req, setup, rowsMarkedRemoved, run } = sharedTorrentFixtures(prismaMock, configMock, downloadClientManagerMock);
const CONTROL = 'ab'.repeat(20);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a hand-added torrent (indexer "Manual", no indexer id)', () => {
  it('is never removed, while a configured indexer\'s torrent past its limit is removed in the same run', async () => {
    const client = setup([
      req('req-manual', {}, { indexerName: 'Manual', indexerId: null }),
      req('req-control', {}, { torrentHash: CONTROL, downloadClientId: CONTROL }), // IndexerA: 30 min, seeded 40
    ]);
    // Two torrents: each answers for itself until it is deleted
    const gone = new Set<string>();
    client.deleteDownload.mockImplementation(async (id: string) => { gone.add(id); });
    client.probeDownload.mockImplementation(async (id: string) => (gone.has(id)
      ? { found: false }
      : { found: true, info: { id, name: 'Generated', status: 'seeding', progress: 1, seedingTime: 60 * 40, ratio: 0, addedAt: new Date('2026-10-01T12:01:00Z') } }));

    const result = await run();

    expect(client.deleteDownload.mock.calls.map(([id]) => id)).toEqual([CONTROL]);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-control']);
    expect(gone.has(HASH)).toBe(false);
    expect(result.errors).toBe(0);
  });
});
