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

describe('shared-torrent guard', () => {
  it('matches a row stored by a base32 hash under both its base32 and hex forms', async () => {
    const { otherActiveRequestsUsingTorrent } = await import('@/lib/utils/shared-torrent');
    await otherActiveRequestsUsingTorrent('req-1', PLAIN.b32.toLowerCase());
    await otherActiveRequestsUsingTorrent('req-1', PLAIN.v1);
    const filters = prismaMock.request.findMany.mock.calls.map(([args]) => args.where.downloadHistory.some.torrentHash);
    expect(filters).toEqual([{ in: [PLAIN.b32.toLowerCase(), PLAIN.v1] }, { in: [PLAIN.v1] }]);
  });
});
