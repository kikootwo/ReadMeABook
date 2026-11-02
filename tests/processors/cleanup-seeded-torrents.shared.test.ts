/**
 * Component: Cleanup Seeded Torrents Processor Tests - torrents shared by several requests (#283)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * The seeding cleanup removes a shared torrent only when every request using it would let it go:
 * each other active request is finished (an audiobook also imported by RMAB since it took the torrent)
 * and its own indexer's seeding requirement is met.
 * `findMany` answers the page query and the shared-torrent query from fixture requests.
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

const HASH = 'abcdef0123456789abcdef0123456789abcdef01';
// 40 minutes seeded: IndexerA (30 min) is met, Slow (600 min) is not, Unconfigured seeds forever
const INDEXERS = [
  { id: 1, name: 'IndexerA', protocol: 'torrent', seedingTimeMinutes: 30, ratioLimit: 0 },
  { id: 2, name: 'Slow', protocol: 'torrent', seedingTimeMinutes: 600, ratioLimit: 0 },
];

interface Fixture {
  id: string;
  type: string;
  status: string;
  deletedAt: Date | null;
  audiobook: { status: string; filePath: string | null; completedAt: Date | null } | null;
  downloadHistory: Record<string, unknown>[];
}

let requests: Fixture[] = [];

/** The parts of the two findMany calls (page, shared-torrent) the fixtures answer */
interface FindManyArgs {
  where?: {
    AND?: { id?: { gt?: string } }[];
    id?: { not?: string };
    downloadHistory?: { some?: { torrentHash?: { in?: string[] } } };
  };
}
interface UpdateArgs { where: { id: string }; data?: { downloadStatus?: string } }
interface UpdateManyArgs { where: { id: { in: string[] } }; data?: { downloadStatus?: string } }

function req(id: string, fields: Partial<Fixture> = {}, row: Record<string, unknown> = {}): Fixture {
  return {
    id,
    type: 'audiobook',
    status: 'available',
    deletedAt: null,
    // RMAB's organize completed the book after the row took the torrent
    audiobook: { status: 'completed', filePath: `/library/${id}`, completedAt: new Date('2026-10-01T13:00:00Z') },
    downloadHistory: [{
      id: `dh-${id}`,
      selected: true,
      downloadStatus: 'completed',
      indexerName: 'IndexerA',
      indexerId: 1,
      torrentHash: HASH,
      downloadClientId: HASH,
      downloadClient: 'qbittorrent',
      addedByRmab: true,
      createdAt: new Date('2026-10-01T12:00:00Z'),
      ...row,
    }],
    ...fields,
  };
}

function setup(fixtures: Fixture[]) {
  requests = fixtures;
  configMock.get.mockResolvedValue(JSON.stringify(INDEXERS));
  const client = {
    clientType: 'qbittorrent',
    protocol: 'torrent',
    probeDownload: vi.fn(async () => (client.deleteDownload.mock.calls.length
      ? { found: false }
      : { found: true, info: { id: HASH, name: 'Series Pack', status: 'seeding', progress: 1, seedingTime: 60 * 40, ratio: 0 } })),
    deleteDownload: vi.fn().mockResolvedValue(undefined),
  };
  downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue(client);
  return client;
}

/** Download rows the run marked 'removed' (one by one or in one updateMany) */
function rowsMarkedRemoved(): string[] {
  const one = (prismaMock.downloadHistory.update.mock.calls as [UpdateArgs][])
    .filter(([args]) => args.data?.downloadStatus === 'removed')
    .map(([args]) => args.where.id);
  const many = (prismaMock.downloadHistory.updateMany.mock.calls as [UpdateManyArgs][])
    .filter(([args]) => args.data?.downloadStatus === 'removed')
    .flatMap(([args]) => args.where.id.in);
  return [...new Set([...one, ...many])].sort();
}

async function run() {
  const { processCleanupSeededTorrents } = await import('@/lib/processors/cleanup-seeded-torrents.processor');
  return processCleanupSeededTorrents({ jobId: 'job-283' });
}

beforeEach(() => {
  vi.clearAllMocks();
  requests = [];
  prismaMock.request.findMany.mockImplementation(async (args: FindManyArgs) => {
    const where = args?.where ?? {};
    if (where.AND) {
      // The page query: one page, every fixture with a completed selected row, in the order given
      return where.AND.some((c) => c.id?.gt) ? [] : requests
        .filter((r) => r.downloadHistory.some((h) => h.selected && h.downloadStatus === 'completed'));
    }
    // The shared-torrent query: other non-deleted requests whose selected row is this torrent
    const forms = where.downloadHistory?.some?.torrentHash?.in ?? [];
    return requests
      .filter((r) => r.id !== where.id?.not && r.deletedAt === null)
      .filter((r) => r.downloadHistory.some((h) => h.selected && forms.includes(h.torrentHash as string)))
      .map((r) => ({ ...r, downloadHistory: r.downloadHistory.filter((h) => forms.includes(h.torrentHash as string)) }));
  });
});

describe('cleanup of a torrent shared by several requests (#283)', () => {
  it('removes it once when three finished requests have all met the seeding requirement', async () => {
    const client = setup([req('req-a'), req('req-b'), req('req-c')]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(client.deleteDownload).toHaveBeenCalledWith(HASH, true);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b', 'dh-req-c']);
    expect(result.errors).toBe(0);
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
  });

  it('marks the rows of requests that took the torrent over (series pack) when the owner removes it', async () => {
    // The 2nd and 3rd request found the pack already in the client: never removed through their own rows
    const client = setup([
      req('req-a', {}, { addedByRmab: false }),
      req('req-b', { type: 'ebook', status: 'downloaded' }, { addedByRmab: false }),
      req('req-c'),
    ]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b', 'dh-req-c']);
    expect(result.errors).toBe(0);
  });

  it('marks a sibling whose torrent is already gone in a later run, without errors', async () => {
    const client = setup([req('req-a'), req('req-b')]);
    client.probeDownload.mockImplementation(async () => ({ found: false }));

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
    expect(result.errors).toBe(0);
  });

  it.each(['downloading', 'processing', 'downloaded', 'failed'])('keeps it while another request is %s', async (status) => {
    const client = setup([req('req-a'), req('req-b'), req('req-c', { status }, { downloadStatus: 'downloading' })]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it.each([
    ['its own indexer asks for longer seeding', { indexerName: 'Slow', indexerId: 2 }],
    ['its own indexer is not configured (seeds forever)', { indexerName: 'Unconfigured', indexerId: 9 }],
    ['it was recorded for another download client', { downloadClient: 'transmission' }],
  ])('keeps it when a finished request still needs it: %s', async (_label, row) => {
    const client = setup([req('req-a'), req('req-b', {}, row)]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual([]);
    expect(result.errors).toBe(0);
  });

  // A late joiner on a pack that has already seeded: it took the torrent days after the owner
  const LATE_JOINER_ROW = { addedByRmab: false, createdAt: new Date('2026-10-05T12:00:00Z') };

  it.each([
    ['a library scan marked it available while its organize is still copying', { status: 'processing', filePath: null, completedAt: null }],
    ['it is only matched in the library (no RMAB import)', { status: 'requested', filePath: null, completedAt: null }],
    ['the only import of the book is older than its row', { status: 'completed', filePath: '/library/Book 2', completedAt: new Date('2026-09-01T12:00:00Z') }],
  ])('keeps it for an available audiobook RMAB has not imported from it: %s', async (_label, audiobook) => {
    const client = setup([req('req-a'), req('req-b', { audiobook }, LATE_JOINER_ROW)]);

    const result = await run();

    expect(client.deleteDownload).not.toHaveBeenCalled();
    expect(rowsMarkedRemoved()).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it('lets it go once RMAB has imported the late joiner from it', async () => {
    const imported = { status: 'completed', filePath: '/library/Book 2', completedAt: new Date('2026-10-05T12:30:00Z') };
    const client = setup([req('req-a'), req('req-b', { audiobook: imported }, LATE_JOINER_ROW)]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a', 'dh-req-b']);
    expect(result.errors).toBe(0);
  });

  it('removes it through a soft-deleted owner when the only active sibling is finished and done seeding', async () => {
    const client = setup([req('req-a', { deletedAt: new Date() }), req('req-b', {}, { addedByRmab: false })]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(rowsMarkedRemoved()).toEqual(['dh-req-b']);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-a' } });
    expect(result.errors).toBe(0);
  });

  it('still ignores soft-deleted requests: the active owner removes it and the soft-deleted one is hard-deleted', async () => {
    const client = setup([req('req-a'), req('req-b', { deletedAt: new Date() })]);

    const result = await run();

    expect(client.deleteDownload).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.delete).toHaveBeenCalledWith({ where: { id: 'req-b' } });
    expect(rowsMarkedRemoved()).toEqual(['dh-req-a']);
    expect(result.errors).toBe(0);
  });
});
