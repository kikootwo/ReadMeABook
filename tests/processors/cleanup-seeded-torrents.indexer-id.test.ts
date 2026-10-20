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

function setup(history: { indexerName: string; indexerId?: number | null }, download: { seedingTime: number; ratio: number }) {
  configMock.get.mockResolvedValue(
    JSON.stringify([{ id: 7, name: 'New Name', protocol: 'torrent', seedingTimeMinutes: 0, ratioLimit: 2 }])
  );
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
        deletedAt: null,
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
});
