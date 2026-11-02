/**
 * Component: Torrent Ownership with qBittorrent Hybrid Torrents (#422)
 * Documentation: documentation/phase3/download-clients.md
 *
 * Post-import re-categorize and request delete run the ownership rule on a hybrid torrent
 * stored by its v1 hash: RMAB's own one is found and acted on under qBittorrent's v2 ID;
 * someone else's is found and left alone.
 */

import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { FakeQbittorrent, HYBRID, magnetOf, PLAIN, torrentFile } from '../helpers/fake-qbittorrent';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import type { RMABLogger } from '@/lib/utils/logger';

const prismaMock = createPrismaMock();
const logged = vi.hoisted(() => [] as string[]);
const managerMock = vi.hoisted(() => ({
  getAllClients: vi.fn(),
  createClientFromConfig: vi.fn(),
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => {
  const log = (message: unknown) => {
    logged.push(String(message));
  };
  return { RMABLogger: { create: () => ({ info: log, debug: log, warn: log, error: log }) } };
});
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async () => JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', seedingTimeMinutes: 60 }]),
  }),
}));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const fake = new FakeQbittorrent();
const logger = {
  info: (m: string) => logged.push(m), warn: (m: string) => logged.push(m), debug: vi.fn(), error: vi.fn(),
} as unknown as RMABLogger;
const posts = (path: string) => fake.requests.filter((r) => r.path === `/api/v2/torrents/${path}`);

function row(fields: Record<string, unknown> = {}) {
  return {
    id: 'dh-1', requestId: 'req-1', downloadClient: 'qbittorrent', downloadClientId: HYBRID.v1, torrentHash: HYBRID.v1,
    addedByRmab: true, downloadStatus: 'downloading', indexerName: 'Indexer', indexerId: 1, createdAt: new Date(), ...fields,
  };
}

async function postImport(fields: Record<string, unknown> = {}) {
  prismaMock.downloadHistory.findFirst.mockResolvedValue(row(fields));
  const { applyPostImportCategory } = await import('@/lib/processors/post-import-category');
  await applyPostImportCategory('req-1', logger);
}

async function requestDelete(fields: Record<string, unknown> = {}) {
  const { cleanUpRequestDownload } = await import('@/lib/services/request-delete-download');
  return cleanUpRequestDownload('req-1', row(fields) as never);
}

beforeAll(async () => {
  // Load the modules under test once, outside the timed cases
  await Promise.all([fake.start(), import('@/lib/processors/post-import-category'), import('@/lib/services/request-delete-download')]);
});
afterAll(() => fake.stop());

beforeEach(() => {
  fake.reset();
  logged.length = 0;
  vi.clearAllMocks();
  prismaMock.request.findMany.mockResolvedValue([]);
  const service = new QBittorrentService(fake.url, '', '');
  managerMock.getAllClients.mockResolvedValue([{ enabled: true, type: 'qbittorrent', postImportCategory: 'done' }]);
  managerMock.createClientFromConfig.mockResolvedValue(service);
  managerMock.getClientServiceForProtocol.mockResolvedValue(service);
});

describe("RMAB's own hybrid torrent, stored by its v1 hash", () => {
  beforeEach(() => fake.seed(HYBRID, { addedAgoSec: 10, category: 'readmeabook' }));

  it('gets the post-import category, sent under its v2 ID', async () => {
    await postImport();
    expect(fake.list[0].category).toBe('done');
    expect(posts('setCategory').map((r) => r.params.hashes)).toEqual([HYBRID.id]);
  });

  it('is removed with its files by a request delete', async () => {
    await expect(requestDelete()).resolves.toMatchObject({ torrentsRemoved: 1 });
    expect(fake.list).toEqual([]);
    expect(posts('delete').map((r) => r.params)).toEqual([{ hashes: HYBRID.id, deleteFiles: 'true' }]);
  });
});

describe('someone else\'s hybrid torrent', () => {
  it.each(['5.2', '4.4'] as const)('qBittorrent %s: adding it again by .torrent or btih magnet records it as already in the client', async (version) => {
    fake.version = version;
    fake.seed(HYBRID);
    const files = createServer((_req, res) => res.end(torrentFile(HYBRID)));
    await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
    const address = files.address();
    const service = new QBittorrentService(fake.url, '', '');
    try {
      for (const url of [`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/h.torrent`, magnetOf(HYBRID)]) {
        await expect(service.addDownload(url)).resolves.toMatchObject({ id: HYBRID.id, alreadyInClient: true });
      }
    } finally {
      await new Promise<void>((resolve) => files.close(() => resolve()));
    }
    expect(posts('add')).toHaveLength(0);
  });

  const crafted = {
    'its btih and a different btmh': `magnet:?xt=urn:btih:${HYBRID.v1}&xt=urn:btmh:1220${'ab'.repeat(32)}&dn=Hybrid`,
    'only a btmh whose first 40 hex are its v1': `magnet:?xt=urn:btmh:1220${HYBRID.v1}${'cd'.repeat(12)}&dn=Hybrid`,
  };
  it.each(['4.4', 'legacy', '5.2'].flatMap((v) => Object.entries(crafted).map(([label, url]) => [v, label, url])))('qBittorrent %s: a magnet with %s is recorded as already in the client, never touched', async (version, _label, url) => {
    fake.version = version as typeof fake.version;
    fake.seed(HYBRID, { addedAgoSec: 600 });
    const result = await new QBittorrentService(fake.url, '', '').addDownload(url);
    expect.soft(result).toMatchObject({ id: HYBRID.id, alreadyInClient: true }); // soft: the checks below show the harm
    const fields = { downloadClientId: result.id, addedByRmab: !result.alreadyInClient };
    await postImport(fields);
    await expect(requestDelete(fields)).resolves.toMatchObject({ torrentsRemoved: 0 });
    expect([...posts('add'), ...posts('setCategory'), ...posts('delete')]).toEqual([]);
    expect(fake.list).toEqual([{ id: HYBRID.id, category: 'other', name: HYBRID.name }]);
  });

  it('older than the grab: the probe finds it and the post-import category is refused', async () => {
    fake.seed(HYBRID, { addedAgoSec: 2 * 86400 });
    await postImport();
    expect(logged.join('\n')).toContain('older than RMAB\'s grab');
    expect(posts('setCategory')).toHaveLength(0);
    expect(fake.list[0].category).toBe('other');
  });

  it('older than the grab: a request delete finds it and keeps it', async () => {
    fake.seed(HYBRID, { addedAgoSec: 2 * 86400 });
    await expect(requestDelete()).resolves.toMatchObject({ torrentsRemoved: 0, torrentsKeptNotOwned: 1 });
    expect(logged.join('\n')).toContain('older than RMAB\'s grab');
    expect(posts('delete')).toHaveLength(0);
    expect(fake.list).toHaveLength(1);
  });

  it('guard: a row recorded as not RMAB\'s never reaches the client', async () => {
    fake.seed(HYBRID);
    await postImport({ addedByRmab: false });
    await requestDelete({ addedByRmab: false });
    expect(logged.join('\n')).toContain('already there when RMAB grabbed it');
    expect(fake.requests.filter((r) => r.path !== '/api/v2/torrents/categories')).toEqual([]);
  });
});

// Known risk: qBittorrent 4.4 answered "Ok." to a duplicate, so v1.2.11 recorded the user's hybrid
// as RMAB's (addedByRmab: true, stored by v1). Such a row now resolves; only the 24 h window guards it.
describe('a v1.2.11 row for a duplicate of the user\'s hybrid', () => {
  it.each([
    ['added 1 h before the grab: resolves to it, and a request delete removes it', 3600, { torrentsRemoved: 1 }, 0],
    ['added 25 h before the grab: the ownership check refuses it', 25 * 3600, { torrentsRemoved: 0, torrentsKeptNotOwned: 1 }, 1],
  ])('%s', async (_label, addedAgoSec, outcome, left) => {
    fake.version = '4.4';
    fake.seed(HYBRID, { addedAgoSec });
    await expect(requestDelete()).resolves.toMatchObject(outcome);
    expect(fake.list).toHaveLength(left);
  });
});

describe('shared-torrent guard', () => {
  it('matches a row stored by a base32 or hex hash under both forms, in either case', async () => {
    const { otherActiveRequestsUsingTorrent } = await import('@/lib/utils/shared-torrent');
    await otherActiveRequestsUsingTorrent('req-1', PLAIN.b32.toLowerCase());
    await otherActiveRequestsUsingTorrent('req-1', PLAIN.v1);
    const filters = prismaMock.request.findMany.mock.calls.map(([args]) => args.where.downloadHistory.some.torrentHash);
    const upper = [PLAIN.v1.toUpperCase(), PLAIN.b32.toUpperCase()];
    expect(filters).toEqual([
      { in: [PLAIN.b32.toLowerCase(), PLAIN.v1, upper[0], upper[1]] },
      { in: [PLAIN.v1, upper[0], PLAIN.b32.toLowerCase(), upper[1]] },
    ]);
  });
});
