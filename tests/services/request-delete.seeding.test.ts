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
}

async function deleteWith({ seedingTimeMinutes, ratioLimit, seedingTime, ratio, downloadStatus = 'completed' }: Scenario) {
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
    downloadHistory: [{ torrentHash: 'hash-1', indexerName: 'Tracker', downloadStatus }],
  });
  configServiceMock.get.mockImplementation(async (key: string) => {
    if (key === 'prowlarr_indexers') {
      return JSON.stringify([{ name: 'Tracker', protocol: 'torrent', seedingTimeMinutes, ratioLimit }]);
    }
    if (key === 'media_dir') return '/media';
    return null;
  });
  configServiceMock.getBackendMode.mockResolvedValue('plex');
  const client = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    getDownload: vi.fn().mockResolvedValue({ id: 'hash-1', name: 'Book', status: 'seeding', seedingTime, ratio }),
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

    const { result, client } = await deleteWith({ seedingTimeMinutes: 60, ratioLimit: 1, seedingTime: 3600, ratio: 2, downloadStatus });

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
});
