/**
 * Component: Cleanup Seeded Torrents Processor Tests - torrent ownership (#423)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * The seeding cleanup removes only torrents RMAB added. A torrent that was already in the
 * client when RMAB grabbed it (taken over) is never removed, with or without its files.
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
const HOUR = 60 * 60 * 1000;

interface Setup {
  row?: Record<string, unknown>;
  /** Client added time relative to the row's createdAt; null = the client reports none */
  addedOffsetMs?: number | null;
  deletedAt?: Date | null;
  clientType?: string;
}

function setup({ row = {}, addedOffsetMs = 10 * 1000, deletedAt = null, clientType = 'qbittorrent' }: Setup = {}) {
  configMock.get.mockResolvedValue(JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 1, ratioLimit: 0 }]));
  const info = {
    id: 'hash-1',
    name: 'Book',
    status: 'seeding',
    progress: 1,
    seedingTime: 99999, // seeding requirement met
    ratio: 0,
    addedAt: addedOffsetMs === null ? undefined : new Date(createdAt.getTime() + addedOffsetMs),
  };
  const client = {
    clientType,
    protocol: 'torrent',
    getDownload: vi.fn().mockResolvedValue(info),
    probeDownload: vi.fn().mockResolvedValue({ found: true, info }),
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
            id: 'dh-1',
            selected: true,
            downloadStatus: 'completed',
            torrentHash: 'hash-1',
            downloadClientId: 'hash-1',
            downloadClient: 'qbittorrent',
            indexerName: 'Tracker',
            indexerId: 1,
            createdAt,
            addedByRmab: true,
            ...row,
          },
        ],
      },
    ])
    .mockResolvedValue([]);
  prismaMock.request.delete.mockResolvedValue({});
  prismaMock.downloadHistory.update.mockResolvedValue({});
  return client;
}

async function run() {
  const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
  return processCleanupSeededTorrents({ jobId: 'job-1' });
}

const probed = (client: ReturnType<typeof setup>) =>
  client.getDownload.mock.calls.length + client.probeDownload.mock.calls.length;

describe('processCleanupSeededTorrents torrent ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.findMany.mockReset();
    prismaMock.request.findMany.mockResolvedValue([]);
  });

  it('never removes a taken-over torrent of an active request, and does not even ask the client', async () => {
    const client = setup({ row: { addedByRmab: false } });

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(probed(client)).toBe(0);
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cleaned: 0, notOwned: 1 });
  });

  it('stops tracking a taken-over torrent of a soft-deleted request: hard-deletes the request, keeps the torrent', async () => {
    const client = setup({ row: { addedByRmab: false }, deletedAt: new Date() });

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-1' } });
  });

  it('keeps a legacy torrent the client added 3 days before the grab and records it as not RMAB\'s', async () => {
    const client = setup({ row: { addedByRmab: null }, addedOffsetMs: -3 * 24 * HOUR });

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({ where: { id: 'dh-1' }, data: { addedByRmab: false } });
  });

  it('hard-deletes a soft-deleted legacy request on a clear verdict, keeping its torrent', async () => {
    const client = setup({ row: { addedByRmab: null }, addedOffsetMs: -3 * 24 * HOUR, deletedAt: new Date() });

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-1' } });
  });

  it('control: removes a legacy torrent the client added 10 s before the grab (RMAB\'s own add)', async () => {
    const client = setup({ row: { addedByRmab: null }, addedOffsetMs: -10 * 1000 });

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
    expect(result.cleaned).toBe(1);
  });

  it('keeps a legacy torrent when the client reports no added time, and writes nothing', async () => {
    const client = setup({ row: { addedByRmab: null }, addedOffsetMs: null });

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
  });

  it('keeps an unclear legacy torrent (added 2 h before the grab) without recording anything, so the next run checks again', async () => {
    const client = setup({ row: { addedByRmab: null }, addedOffsetMs: -2 * HOUR, deletedAt: new Date() });

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
  });

  it('keeps a torrent RMAB added when the client added it again more than 1 h after the grab, writing nothing', async () => {
    const client = setup({ row: { addedByRmab: true }, addedOffsetMs: 2 * HOUR });

    await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
  });

  it('keeps a torrent recorded as RMAB\'s when the client copy is older than the grab (another instance), writing nothing', async () => {
    const client = setup({ row: { addedByRmab: true }, addedOffsetMs: -2 * 24 * HOUR });

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(result.notOwned).toBe(1);
  });

  it('control: removes a torrent RMAB added once seeding is met', async () => {
    const client = setup();

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledWith('hash-1', true);
    expect(result.cleaned).toBe(1);
  });

  it('does not probe, mark or remove a row recorded for another client type than the configured one', async () => {
    const client = setup({ clientType: 'transmission' });

    await run();

    expect(probed(client)).toBe(0);
    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
  });
});
