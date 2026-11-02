/**
 * Component: Request Delete Service Tests - torrent ownership (#423)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Deleting a request never removes (or changes) a torrent RMAB did not add.
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
vi.mock('@/lib/services/request-delete-files', () => ({
  removeAudiobookFolder: vi.fn(async () => ({ kind: 'none' })),
  removeEbookFiles: vi.fn(async () => ({ deleted: 0 })),
  deleteBackendItem: vi.fn(async () => undefined),
  deleteLibraryRecords: vi.fn(async () => undefined),
}));

const createdAt = new Date('2026-10-01T12:00:00Z');
const HOUR = 60 * 60 * 1000;

interface Scenario {
  row?: Record<string, unknown>;
  /** Live client state */
  progress?: number;
  status?: string;
  seedingTime?: number;
  /** Client added time relative to createdAt; null = none reported */
  addedOffsetMs?: number | null;
  clientType?: string;
}

async function deleteWith({
  row = {}, progress = 1, status = 'seeding', seedingTime = 99999, addedOffsetMs = 10 * 1000, clientType = 'qbittorrent',
}: Scenario = {}) {
  prismaMock.request.findFirst.mockResolvedValue({
    id: 'req-1',
    audiobook: {
      id: 'ab-1', title: 'Book', author: 'Author', audibleAsin: null, plexGuid: null, absItemId: null,
      filePath: path.join('/media', 'Author', 'Book'),
    },
    downloadHistory: [{
      id: 'dh-1', torrentHash: 'hash-1', downloadClientId: 'hash-1', downloadClient: 'qbittorrent',
      indexerName: 'Tracker', indexerId: 1, downloadStatus: 'completed', completedAt: null, createdAt, addedByRmab: true,
      ...row,
    }],
  });
  configServiceMock.get.mockImplementation(async (key: string) => {
    if (key === 'prowlarr_indexers') {
      return JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 60, ratioLimit: 0 }]);
    }
    if (key === 'media_dir') return '/media';
    return null;
  });
  configServiceMock.getBackendMode.mockResolvedValue('plex');
  const client = {
    clientType,
    protocol: 'torrent',
    getDownload: vi.fn().mockResolvedValue({
      id: 'hash-1', name: 'Book', status, progress, seedingTime, ratio: 0,
      addedAt: addedOffsetMs === null ? undefined : new Date(createdAt.getTime() + addedOffsetMs),
    }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(client);

  const { deleteRequest } = await import('@/lib/services/request-delete.service');
  const result = await deleteRequest('req-1', 'admin-1');
  expect(result.success).toBe(true);
  return { result, client };
}

/** Writes to the download history row other than the ownership flag (e.g. back to 'completed') */
const statusWrites = () =>
  prismaMock.downloadHistory.update.mock.calls.filter(
    ([arg]: Array<{ data?: Record<string, unknown> } | undefined>) => 'downloadStatus' in (arg?.data ?? {})
  );

describe('deleteRequest torrent ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.downloadHistory.update.mockResolvedValue({});
    fsMock.access.mockRejectedValue(new Error('missing'));
  });

  it('leaves an incomplete taken-over torrent alone, without asking the client', async () => {
    const { result, client } = await deleteWith({ row: { addedByRmab: false, downloadStatus: 'downloading' }, progress: 0.4, status: 'downloading' });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(client.getDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptNotOwned).toBe(1);
    expect(result.torrentsRemoved).toBe(0);
  });

  it('leaves a taken-over torrent whose seeding is met alone', async () => {
    const { result, client } = await deleteWith({ row: { addedByRmab: false } });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptNotOwned).toBe(1);
  });

  it('leaves a legacy torrent added 3 days before the grab alone and records it as not RMAB\'s', async () => {
    const { result, client } = await deleteWith({ row: { addedByRmab: null }, addedOffsetMs: -3 * 24 * HOUR });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptNotOwned).toBe(1);
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({ where: { id: 'dh-1' }, data: { addedByRmab: false } });
  });

  it('leaves an unclear legacy torrent alone (seeding met) and writes nothing', async () => {
    const { result, client } = await deleteWith({ row: { addedByRmab: null }, addedOffsetMs: -2 * HOUR });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.torrentsKeptNotOwned).toBe(1);
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
  });

  it('control: removes a torrent RMAB added once its seeding is met', async () => {
    const { result, client } = await deleteWith();

    expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
    expect(result.torrentsRemoved).toBe(1);
  });

  it('never removes for a row recorded as removed, and never writes it back to completed', async () => {
    // progress 0.5 + downloading = the incomplete-delete branch; progress 1 = the keep-seeding write-back
    for (const [progress, status] of [[0.5, 'downloading'], [1, 'seeding']] as const) {
      vi.clearAllMocks();
      const { client } = await deleteWith({ row: { downloadStatus: 'removed' }, progress, status, seedingTime: 10 });

      expect(client.deleteDownload).not.toHaveBeenCalled();
      expect(statusWrites()).toHaveLength(0);
    }
  });

  it('keeps a torrent RMAB added when the client added it again more than 1 h later, writing nothing', async () => {
    const { result, client } = await deleteWith({ addedOffsetMs: 2 * HOUR, seedingTime: 10, row: { downloadStatus: 'downloading' } });

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(result.torrentsKeptNotOwned).toBe(1);
  });

  it('does not ask or touch the client when another client type is configured now', async () => {
    const { client } = await deleteWith({ clientType: 'deluge' });

    expect(client.getDownload).not.toHaveBeenCalled();
    expect(client.deleteDownload).not.toHaveBeenCalled();
  });
});
