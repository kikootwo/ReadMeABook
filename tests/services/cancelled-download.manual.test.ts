/**
 * Component: Cancelled Request - a torrent an admin added by hand (Add Torrent)
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * What a cancel or delete really does with a "Manual" torrent (no indexer id, so no seeding rule):
 * one still downloading is removed with its data, like any partial torrent RMAB added; a finished
 * one is left seeding (no limit applies).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const managerMock = vi.hoisted(() => ({ getClientServiceForProtocol: vi.fn(), getClientForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const createdAt = new Date('2026-10-01T12:00:00Z');
const HASH = 'b'.repeat(40);
const REQUEST = { id: 'req-1', audiobookId: 'ab-1', type: 'audiobook' };

type HistoryRow = Parameters<typeof import('@/lib/services/cancelled-download').handleCancelledDownload>[1];

const manualRow = () => ({
  id: 'dh-1', requestId: 'req-1', selected: true, downloadStatus: 'downloading', torrentHash: HASH,
  downloadClientId: HASH, downloadClient: 'qbittorrent', indexerName: 'Manual', indexerId: null, createdAt,
  addedByRmab: true, completedAt: null, nzbId: null, torrentName: 'Generated',
}) as unknown as HistoryRow;

function client(status: string, progress: number) {
  const c = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    probeDownload: vi.fn().mockResolvedValue({
      found: true,
      info: { id: HASH, name: 'Generated', status, progress, addedAt: new Date(createdAt.getTime() + 10_000), seedingTime: 600, ratio: 0 },
    }),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  managerMock.getClientServiceForProtocol.mockResolvedValue(c);
  return c;
}

async function cancelStep() {
  const { handleCancelledDownload } = await import('@/lib/services/cancelled-download');
  const { CancelDeadline } = await import('@/lib/services/cancel-deadline');
  return handleCancelledDownload(REQUEST, manualRow(), { mode: 'cancel', deadline: CancelDeadline.in(10_000) });
}

beforeEach(() => {
  vi.clearAllMocks();
  configMock.get.mockResolvedValue(JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', seedingTimeMinutes: 30, ratioLimit: 0 }]));
  prismaMock.request.findMany.mockResolvedValue([]);
  prismaMock.request.findFirst.mockResolvedValue(null);
  prismaMock.downloadHistory.findFirst.mockResolvedValue({ id: 'dh-1' });
  prismaMock.downloadHistory.update.mockResolvedValue({});
  prismaMock.downloadHistory.updateMany.mockResolvedValue({ count: 0 });
});

describe('cancelling a request whose torrent was added by hand', () => {
  it('while it is still downloading: the torrent and its data are removed', async () => {
    const c = client('downloading', 0.4);
    expect((await cancelStep()).outcome).toBe('removed');
    expect(c.deleteDownload).toHaveBeenCalledWith(HASH, true);
  });

  it('once it has finished: it is left seeding (no indexer rule applies to "Manual")', async () => {
    const c = client('seeding', 1);
    expect((await cancelStep()).outcome).toBe('kept_unlimited');
    expect(c.deleteDownload).not.toHaveBeenCalled();
  });
});
