/**
 * Component: Request Delete Service Tests - per-indexer seeding rule
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Deleting a request applies the same seeding rule as the scheduled seeding
 * cleanup: seeding time AND ratio limit, 0 disables a criterion, both 0 = unlimited.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const fsMock = { access: vi.fn(), rm: vi.fn() };
const configServiceMock = { get: vi.fn(), getBackendMode: vi.fn() };
const downloadClientManagerMock = { getClientServiceForProtocol: vi.fn() };

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('fs/promises', () => fsMock);
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));
vi.mock('@/lib/services/audiobookshelf/api', () => ({ deleteABSItem: vi.fn() }));
// Library files are covered by request-delete.library-guard.test.ts; here only the torrent rule matters
vi.mock('@/lib/services/request-delete-files', () => ({
  removeAudiobookFolder: vi.fn(async () => ({ kind: 'none' })),
  removeEbookFiles: vi.fn(async () => ({ deleted: 0 })),
  deleteBackendItem: vi.fn(async () => undefined),
  deleteLibraryRecords: vi.fn(async () => undefined),
}));

interface Scenario {
  seedingTimeMinutes: number;
  ratioLimit?: number;
  seedingTime: number;
  ratio?: number;
  downloadStatus?: string;
  /** Live client state; defaults to a finished, seeding torrent. */
  clientStatus?: string;
  progress?: number;
  indexerName?: string;
  indexerId?: number | null;
  configured?: { id: number; name: string };
  /** Raw prowlarr_indexers value instead of the generated one. */
  rawConfig?: string;
}

async function deleteWith({
  seedingTimeMinutes, ratioLimit, seedingTime, ratio, downloadStatus = 'completed', clientStatus = 'seeding', progress = 1,
  indexerName = 'Tracker', indexerId = null, configured = { id: 1, name: 'Tracker' }, rawConfig,
}: Scenario) {
  prismaMock.request.findFirst.mockResolvedValue({
    id: 'req-1',
    audiobook: {
      id: 'ab-1',
      title: 'Book',
      author: 'Author',
      audibleAsin: null,
      plexGuid: null,
      absItemId: null,
      filePath: path.join('/media', 'Author', 'Book'),
    },
    downloadHistory: [{ id: 'dh-1', torrentHash: 'hash-1', indexerName, indexerId, downloadStatus, completedAt: null }],
  });
  configServiceMock.get.mockImplementation(async (key: string) => {
    if (key === 'prowlarr_indexers') {
      if (rawConfig !== undefined) return rawConfig;
      return JSON.stringify([{ ...configured, protocol: 'torrent', seedingTimeMinutes, ratioLimit }]);
    }
    if (key === 'media_dir') return '/media';
    return null;
  });
  configServiceMock.getBackendMode.mockResolvedValue('plex');
  const client = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    getDownload: vi.fn().mockResolvedValue({ id: 'hash-1', name: 'Book', status: clientStatus, progress, seedingTime, ratio }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(client);

  const { deleteRequest } = await import('@/lib/services/request-delete.service');
  const result = await deleteRequest('req-1', 'admin-1');
  expect(result.success).toBe(true);
  return { result, client };
}

describe('deleteRequest seeding rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    fsMock.access.mockRejectedValue(new Error('missing'));
  });

  it('keeps a torrent whose seeding time is met but whose ratio limit is not', async () => {
    const { result, client } = await deleteWith({ seedingTimeMinutes: 60, ratioLimit: 2, seedingTime: 7200, ratio: 1.1 });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptSeeding).toBe(1);
  });

  it('keeps a ratio-only torrent until its ratio is met (seeding time 0 is not unlimited)', async () => {
    const { result, client } = await deleteWith({ seedingTimeMinutes: 0, ratioLimit: 1.5, seedingTime: 99999, ratio: 0.4 });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptSeeding).toBe(1);
    expect(result.torrentsKeptUnlimited).toBe(0);
  });

  it('removes a ratio-only torrent once its ratio is met', async () => {
    const { result, client } = await deleteWith({ seedingTimeMinutes: 0, ratioLimit: 1.5, seedingTime: 10, ratio: 1.5 });

    expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
    expect(result.torrentsRemoved).toBe(1);
  });

  it('removes a torrent once both seeding time and ratio are met', async () => {
    const { result, client } = await deleteWith({ seedingTimeMinutes: 60, ratioLimit: 2, seedingTime: 3600, ratio: 2.4 });

    expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
    expect(result.torrentsRemoved).toBe(1);
  });

  it('keeps a torrent when the client reports no ratio and a ratio limit is set', async () => {
    const { result, client } = await deleteWith({ seedingTimeMinutes: 0, ratioLimit: 1, seedingTime: 99999 });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptSeeding).toBe(1);
  });

  it('removes an incomplete download from a ratio-only indexer (it is not unlimited)', async () => {
    const { result, client } = await deleteWith({
      seedingTimeMinutes: 0, ratioLimit: 1.5, seedingTime: 0, ratio: 0, downloadStatus: 'downloading',
      clientStatus: 'downloading', progress: 0.4,
    });

    expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
    expect(result.torrentsRemoved).toBe(1);
    expect(result.torrentsKeptUnlimited).toBe(0);
  });

  it.each([
    ['done seeding', 'completed'],
    ['incomplete', 'downloading'],
  ])('never removes a torrent (%s) that another active request still uses', async (_label, downloadStatus) => {
    prismaMock.request.findMany.mockImplementation(async (args: any) =>
      args?.where?.downloadHistory?.some?.torrentHash === 'hash-1' ? [{ id: 'req-2', status: 'downloaded' }] : []
    );

    const { result, client } = await deleteWith({ seedingTimeMinutes: 60, ratioLimit: 1, seedingTime: 3600, ratio: 2, downloadStatus,
      ...(downloadStatus === 'downloading' && { clientStatus: 'downloading', progress: 0.5 }),
    });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptShared).toBe(1);
    expect(result.torrentsRemoved).toBe(0);
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: 'req-1' }, deletedAt: null }),
    }));
  });

  it('keeps a torrent for unlimited seeding only when both criteria are 0', async () => {
    const { result, client } = await deleteWith({ seedingTimeMinutes: 0, ratioLimit: 0, seedingTime: 99999, ratio: 9 });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptUnlimited).toBe(1);
  });

  it('applies the ratio limit of an indexer renamed in Prowlarr (matched by id)', async () => {
    const { result, client } = await deleteWith({
      seedingTimeMinutes: 0, ratioLimit: 2, seedingTime: 99999, ratio: 1,
      indexerName: 'Old Name', indexerId: 7, configured: { id: 7, name: 'New Name' },
    });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptSeeding).toBe(1);
    expect(result.torrentsKeptUnlimited).toBe(0);
  });

  it('leaves the download in the client when the saved indexer configuration is not a list', async () => {
    const { result, client } = await deleteWith({
      seedingTimeMinutes: 0, ratioLimit: 0, seedingTime: 99999, ratio: 9, rawConfig: '{"id":1}',
    });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ torrentsRemoved: 0, torrentsKeptUnlimited: 0, torrentsKeptSeeding: 0 });
  });

  it("uses the recorded name's settings when the id now belongs to a different indexer", async () => {
    // Id 9 is now another tracker (1 min, no ratio): by id it would be removed; its recorded name needs ratio 2
    const rawConfig = JSON.stringify([
      { id: 9, name: 'OtherTracker', protocol: 'torrent', seedingTimeMinutes: 1, ratioLimit: 0 },
      { id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 0, ratioLimit: 2 },
    ]);
    const { result, client } = await deleteWith({
      seedingTimeMinutes: 0, ratioLimit: 0, seedingTime: 99999, ratio: 0.5,
      indexerName: 'Tracker', indexerId: 9, rawConfig,
    });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptSeeding).toBe(1);
  });

  describe('history older than the client (the monitor stops polling a cancelled request)', () => {
    it.each([
      ['seeding', 1],
      ['completed', 1], // e.g. a Transmission torrent stopped at 100%
      ['paused', 1],
    ])('keeps a torrent the client reports %s at progress %s for seeding, not deleted with its data', async (clientStatus, progress) => {
      const { result, client } = await deleteWith({
        seedingTimeMinutes: 60, ratioLimit: 2, seedingTime: 600, ratio: 0.3,
        downloadStatus: 'downloading', clientStatus, progress,
      });

      expect(client.deleteDownload).not.toHaveBeenCalled();
      expect(result.torrentsKeptSeeding).toBe(1);
      expect(result.torrentsRemoved).toBe(0);
      // Recorded as completed so the scheduled seeding cleanup can finish it later
      expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({
        where: { id: 'dh-1' },
        data: { downloadStatus: 'completed', completedAt: expect.any(Date) },
      });
    });

    it('still removes a truly incomplete download', async () => {
      const { result, client } = await deleteWith({
        seedingTimeMinutes: 60, ratioLimit: 2, seedingTime: 0, ratio: 0,
        downloadStatus: 'downloading', clientStatus: 'downloading', progress: 0.4,
      });

      expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
      expect(result.torrentsRemoved).toBe(1);
      expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    });

    it('still removes a finished torrent once its seeding rule is met', async () => {
      const { result, client } = await deleteWith({
        seedingTimeMinutes: 60, ratioLimit: 2, seedingTime: 7200, ratio: 2.5,
        downloadStatus: 'downloading', clientStatus: 'seeding', progress: 1,
      });

      expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
      expect(result.torrentsRemoved).toBe(1);
    });
  });
});
