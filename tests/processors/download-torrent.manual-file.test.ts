/**
 * Component: Download Torrent Processor - admin Add Torrent (an uploaded .torrent or a magnet)
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * The bytes of an uploaded .torrent come from the job data (`payload.torrentFile`) only and go to the
 * client's addTorrentData unchanged; a `torrentFile` field on the release itself (select-torrent or a
 * stored pick) is never read. History: label Manual, no indexer id, the bare magnet as the link.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';
import { PLAIN, torrentFile } from '../helpers/fake-qbittorrent';
import { bareMagnet } from '@/lib/services/manual-torrent';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const managerMock = vi.hoisted(() => ({ getClientForProtocol: vi.fn(), getClientServiceForProtocol: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn(), getMany: vi.fn(async () => ({})) }) }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr-connection', () => ({ getProwlarrConnection: async () => ({ baseUrl: '', apiKey: '', base: null }) }));

const BYTES = torrentFile(PLAIN);
const MAGNET = bareMagnet(PLAIN.v1, PLAIN.name);
const release = {
  indexer: 'Manual', title: PLAIN.name, size: 1, publishDate: new Date(), downloadUrl: MAGNET, guid: MAGNET,
  infoHash: PLAIN.v1, protocol: 'torrent', format: 'OTHER' as const,
};
const basePayload = { requestId: 'req-1', audiobook: { id: 'ab-1', title: 'Book', author: 'Author' }, torrent: release, jobId: 'job-1' };

function torrentClient(withData = true) {
  return {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    addDownload: vi.fn(async () => ({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 })),
    ...(withData && { addTorrentData: vi.fn(async () => ({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 })) }),
  };
}

async function run(payload: Record<string, unknown>) {
  const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
  return processDownloadTorrent(payload as never);
}

describe('processDownloadTorrent - admin Add Torrent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook', status: 'downloading', deletedAt: null, user: { plexUsername: 'admin' } });
    prismaMock.downloadHistory.create.mockResolvedValue({ id: 'dh-1' });
    managerMock.getClientForProtocol.mockResolvedValue({ id: 'c1', type: 'qbittorrent', enabled: true, category: 'readmeabook' });
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  it('sends the uploaded bytes unchanged to addTorrentData, never by URL, and records a Manual row', async () => {
    const client = torrentClient();
    managerMock.getClientServiceForProtocol.mockResolvedValue(client);

    await run({ ...basePayload, torrentFile: BYTES.toString('base64') });

    expect(client.addDownload).not.toHaveBeenCalled();
    expect(client.addTorrentData).toHaveBeenCalledTimes(1);
    const [data, options] = client.addTorrentData!.mock.calls[0] as unknown as [Buffer, Record<string, unknown>];
    expect(data.equals(BYTES)).toBe(true);
    expect(options).toMatchObject({ category: 'readmeabook' });

    const row = prismaMock.downloadHistory.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ indexerName: 'Manual', torrentName: PLAIN.name, magnetLink: MAGNET, torrentUrl: null, torrentHash: PLAIN.v1, addedByRmab: true });
    expect(row.indexerId).toBeUndefined();
    expect(jobQueueMock.addNotificationJob.mock.calls[0][5]).toBe(`${PLAIN.name} via Manual (qbittorrent)`);
    // Hand-picked: the monitor carries no automatic-chain count, so a client failure never moves on
    expect(jobQueueMock.addMonitorJob).toHaveBeenCalledWith('req-1', 'dh-1', PLAIN.v1, 'qbittorrent', 3);
  });

  it('a client without addTorrentData fails the request for good (never falls back to the magnet)', async () => {
    const client = torrentClient(false);
    managerMock.getClientServiceForProtocol.mockResolvedValue(client);

    await expect(run({ ...basePayload, torrentFile: BYTES.toString('base64') })).rejects.toThrow('qbittorrent cannot add a .torrent file');
    expect(client.addDownload).not.toHaveBeenCalled();
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorMessage: 'qbittorrent cannot add a .torrent file' }),
    }));
  });

  it('ignores a torrentFile on the release itself (select-torrent, a stored pick) and adds by URL', async () => {
    const client = torrentClient();
    managerMock.getClientServiceForProtocol.mockResolvedValue(client);

    await run({ ...basePayload, torrent: { ...release, torrentFile: BYTES.toString('base64') } });

    expect(client.addTorrentData).not.toHaveBeenCalled();
    expect(client.addDownload).toHaveBeenCalledWith(MAGNET, expect.objectContaining({ category: 'readmeabook' }));
  });

  it('a hand-added magnet is added by URL with the Manual label', async () => {
    const client = torrentClient();
    managerMock.getClientServiceForProtocol.mockResolvedValue(client);
    const magnet = `magnet:?xt=urn:btih:${PLAIN.v1}&tr=udp%3A%2F%2Ft.invalid%3A80`;

    await run({ ...basePayload, torrent: { ...release, downloadUrl: magnet, guid: magnet } });

    expect(client.addDownload).toHaveBeenCalledWith(magnet, expect.anything());
    expect(prismaMock.downloadHistory.create.mock.calls[0][0].data).toMatchObject({ indexerName: 'Manual', magnetLink: magnet, torrentUrl: null });
  });
});
