/**
 * Component: Cleanup Seeded Torrents Processor Tests - indexer lookup by id
 * Documentation: documentation/backend/services/scheduler.md
 *
 * A download records the Prowlarr indexer id and the name at download time.
 * A rename in Prowlarr changes the saved name, so the seeding settings are
 * found by id, with the name as a fallback for downloads recorded without one.
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

const DEFAULT_CONFIG = [{ id: 7, name: 'New Name', protocol: 'torrent', seedingTimeMinutes: 0, ratioLimit: 2 }];

function setup(
  history: { indexerName: string; indexerId?: number | null },
  download: { seedingTime: number; ratio: number },
  config: unknown = DEFAULT_CONFIG,
  deletedAt: Date | null = null
) {
  configMock.get.mockResolvedValue(typeof config === 'string' ? config : JSON.stringify(config));
  const client = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    getDownload: vi.fn().mockResolvedValue({ id: 'hash-1', name: 'Torrent', status: 'seeding', ...download }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(client);
  prismaMock.request.findMany
    .mockResolvedValueOnce([
      {
        id: 'req-1',
        deletedAt,
        downloadHistory: [
          {
            selected: true,
            downloadStatus: 'completed',
            torrentHash: 'hash-1',
            downloadClientId: 'hash-1',
            downloadClient: 'qbittorrent',
            ...history,
          },
        ],
      },
    ])
    .mockResolvedValue([]);
  return client;
}

describe('processCleanupSeededTorrents indexer lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.findMany.mockReset();
  });

  it('applies the ratio limit of an indexer renamed in Prowlarr (matched by id)', async () => {
    const client = setup({ indexerName: 'Old Name', indexerId: 7 }, { seedingTime: 99999, ratio: 1 });

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-1' });

    expect(result).toMatchObject({ skipped: 1, unlimited: 0, cleaned: 0 });
    expect(client.deleteDownload).not.toHaveBeenCalled();
  });

  it("removes the renamed indexer's torrent once its ratio limit is met", async () => {
    const client = setup({ indexerName: 'Old Name', indexerId: 7 }, { seedingTime: 10, ratio: 2.5 });

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-2' });

    expect(result.cleaned).toBe(1);
    expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
  });

  it('falls back to the name for downloads recorded without an indexer id', async () => {
    const client = setup({ indexerName: 'New Name', indexerId: null }, { seedingTime: 99999, ratio: 1 });

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-3' });

    expect(result).toMatchObject({ skipped: 1, unlimited: 0 });
    expect(client.deleteDownload).not.toHaveBeenCalled();
  });

  it('treats a download it cannot match by id or name as unlimited, as before', async () => {
    const client = setup({ indexerName: 'Gone', indexerId: 99 }, { seedingTime: 99999, ratio: 9 });

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-4' });

    expect(result).toMatchObject({ unlimited: 1, cleaned: 0 });
    expect(client.deleteDownload).not.toHaveBeenCalled();
  });

  // Prowlarr rebuilt or replaced: ids start from 1 again, so an old download's id can name another indexer
  const reusedIds = [
    { id: 3, name: 'PublicTracker', protocol: 'torrent', seedingTimeMinutes: 60, ratioLimit: 0 },
    { id: 5, name: 'PrivateTracker', protocol: 'torrent', seedingTimeMinutes: 0, ratioLimit: 2 },
  ];

  it("uses the recorded name's settings when the id now belongs to a different indexer", async () => {
    // Recorded as PrivateTracker (ratio 2) with id 3, which is now PublicTracker (60 min, no ratio)
    const client = setup({ indexerName: 'PrivateTracker', indexerId: 3 }, { seedingTime: 61 * 60, ratio: 0.5 }, reusedIds);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-5' });

    expect(result).toMatchObject({ skipped: 1, cleaned: 0 });
    expect(client.deleteDownload).not.toHaveBeenCalled();
  });

  it('ignores an id that now belongs to a usenet indexer and uses the name', async () => {
    const config = [
      { id: 3, name: 'SomeNZB', protocol: 'usenet', removeAfterProcessing: true },
      { id: 5, name: 'PublicTracker', protocol: 'torrent', seedingTimeMinutes: 60, ratioLimit: 0 },
    ];
    const client = setup({ indexerName: 'PublicTracker', indexerId: 3 }, { seedingTime: 61 * 60, ratio: 0.5 }, config);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-6' });

    expect(result).toMatchObject({ cleaned: 1, unlimited: 0 });
    expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
  });

  it.each([
    ['an object', { id: 7 }],
    ['invalid JSON', 'not json'],
  ])('changes nothing when the saved indexer configuration is %s', async (_label, config) => {
    const client = setup({ indexerName: 'New Name', indexerId: 7 }, { seedingTime: 99999, ratio: 9 }, config, new Date());

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-7' });

    expect(result).toMatchObject({ skipped: true, success: false });
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
    expect(client.deleteDownload).not.toHaveBeenCalled();
  });

  it('uses the id to pick between two saved indexers with the same name', async () => {
    const duplicates = [
      { id: 2, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 30, ratioLimit: 0 },
      { id: 7, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 0, ratioLimit: 2 },
    ];
    const client = setup({ indexerName: 'Tracker', indexerId: 7 }, { seedingTime: 31 * 60, ratio: 0.5 }, duplicates);

    const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
    const result = await processCleanupSeededTorrents({ jobId: 'job-8' });

    expect(result).toMatchObject({ skipped: 1, cleaned: 0 });
    expect(client.deleteDownload).not.toHaveBeenCalled();
  });
});
