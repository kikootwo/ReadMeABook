/**
 * Component: Cleanup Seeded Torrents Processor Tests - cancelled requests
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Cancelling a request only changes its status. The scheduled cleanup then removes the
 * request's torrent (and partial data) from the download client, under the same rules as
 * every other removal: only a torrent RMAB added, never one another live request still uses.
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

function makeClient(found = true) {
  const info = {
    id: 'hash-c',
    name: 'Verity (Unabridged).m4b',
    status: 'downloading',
    progress: 0.1,
    addedAt: new Date(createdAt.getTime() + 10 * 1000),
  };
  const client = {
    clientType: 'transmission',
    protocol: 'torrent',
    getDownload: vi.fn().mockResolvedValue(info),
    probeDownload: vi.fn().mockResolvedValue(found ? { found: true, info } : { found: false }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(client);
  return client;
}

const cancelledRequest = (history: Record<string, unknown> = {}) => ({
  id: 'req-cancelled',
  status: 'cancelled',
  deletedAt: null,
  downloadHistory: [
    {
      id: 'dh-c',
      selected: true,
      downloadStatus: 'downloading',
      torrentHash: 'hash-c',
      downloadClientId: 'hash-c',
      downloadClient: 'transmission',
      indexerName: 'Tracker',
      createdAt,
      addedByRmab: true,
      ...history,
    },
  ],
});

/** findMany call order in a run: candidate page, cancelled requests, then the shared-torrent guard. */
function queue(cancelled: unknown[], sharing: unknown[] = []) {
  prismaMock.request.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(cancelled)
    .mockResolvedValueOnce(sharing);
}

async function run() {
  const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
  return processCleanupSeededTorrents({ jobId: 'job-cancelled' });
}

describe('processCleanupSeededTorrents cancelled requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.findMany.mockReset();
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.downloadHistory.update.mockResolvedValue({});
    configMock.get.mockResolvedValue(JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 0, ratioLimit: 0 }]));
  });

  it('removes the torrent and files of a cancelled request, even with unlimited seeding, and marks the row removed', async () => {
    const client = makeClient();
    queue([cancelledRequest()]);

    const result = await run();

    expect(prismaMock.request.findMany.mock.calls[1][0].where).toMatchObject({ status: 'cancelled', deletedAt: null });
    expect(client.deleteDownload).toHaveBeenCalledWith('hash-c', true);
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({ where: { id: 'dh-c' }, data: { downloadStatus: 'removed' } });
    expect(result.cleaned).toBe(1);
  });

  it('never removes a torrent RMAB did not add, and does not ask the client', async () => {
    const client = makeClient();
    queue([cancelledRequest({ addedByRmab: false })]);

    const result = await run();

    expect(client.probeDownload).not.toHaveBeenCalled();
    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.cleaned).toBe(0);
    expect(result.notOwned).toBe(1);
  });

  it('keeps the torrent while another live request still uses it', async () => {
    const client = makeClient();
    queue([cancelledRequest()], [{ id: 'other', status: 'downloading' }]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(result.cleaned).toBe(0);
  });

  it('removes it when the only other requests sharing it are cancelled or failed', async () => {
    const client = makeClient();
    queue([cancelledRequest()], [
      { id: 'o1', status: 'cancelled' },
      { id: 'o2', status: 'failed' },
    ]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledWith('hash-c', true);
    expect(result.cleaned).toBe(1);
  });

  it('marks the row removed without deleting when the torrent is already gone from the client', async () => {
    const client = makeClient(false);
    queue([cancelledRequest()]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).toHaveBeenCalledWith({ where: { id: 'dh-c' }, data: { downloadStatus: 'removed' } });
    expect(result.missing).toBe(1);
  });

  it('changes nothing when the client cannot be checked', async () => {
    const client = makeClient();
    client.probeDownload.mockRejectedValue(new Error('connection refused'));
    queue([cancelledRequest()]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(prismaMock.downloadHistory.update).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
  });

  it('ignores cancelled Usenet requests', async () => {
    queue([cancelledRequest({ nzbId: 'nzb-1', torrentHash: null, downloadClientId: 'nzb-1', downloadClient: 'sabnzbd' })]);

    const result = await run();

    expect(downloadClientManagerMock.getClientServiceForProtocol).not.toHaveBeenCalled();
    expect(result.cleaned).toBe(0);
  });
});
