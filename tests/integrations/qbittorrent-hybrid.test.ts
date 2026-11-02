/**
 * Component: qBittorrent Hybrid Torrent and Base32 Magnet Tests (#422)
 * Documentation: documentation/phase3/qbittorrent.md
 *
 * The real service against a fake qBittorrent that models its torrent IDs (tests/helpers).
 */

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { FakeQbittorrent, HYBRID, magnetOf, PLAIN, torrentFile, type Fixture } from '../helpers/fake-qbittorrent';

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const fake = new FakeQbittorrent();
let files: Server;
let filesUrl = '';
const service = () => new QBittorrentService(fake.url, '', '');
const fileUrl = (f: Fixture) => `${filesUrl}/${f === HYBRID ? 'hybrid' : 'plain'}.torrent`;
const infoCalls = () => fake.requests.filter((r) => r.path === '/api/v2/torrents/info');

beforeAll(async () => {
  await fake.start();
  files = createServer((req, res) => res.end(torrentFile(req.url?.includes('hybrid') ? HYBRID : PLAIN)));
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
  const address = files.address();
  filesUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await fake.stop();
  await new Promise<void>((resolve) => files.close(() => resolve()));
});

beforeEach(() => fake.reset());

it('fixtures carry the SHA-1 / SHA-256 of their info dicts', () => {
  for (const f of [HYBRID, PLAIN]) {
    expect(createHash('sha1').update(f.info).digest('hex')).toBe(f.v1);
    expect(f.id).toBe(f.v2 ? f.v2.slice(0, 40) : f.v1);
  }
  expect(createHash('sha256').update(HYBRID.info).digest('hex')).toBe(HYBRID.v2);
});

describe.each(['5.2', 'legacy'] as const)('qBittorrent %s (libtorrent 2)', (version) => {
  beforeEach(() => {
    fake.version = version;
  });

  it.each([
    ['a hybrid .torrent', () => fileUrl(HYBRID)],
    ['a hybrid btih+btmh magnet', () => magnetOf(HYBRID, { btmh: true })],
  ])('adds %s under its v2 ID and monitoring finds it', async (_label, url) => {
    const qb = service();
    await expect(qb.addDownload(url())).resolves.toEqual({ id: HYBRID.id, alreadyInClient: false, infoHash: HYBRID.v1 });
    fake.requests.length = 0;
    await expect(qb.getDownload(HYBRID.id)).resolves.toMatchObject({ id: HYBRID.id, name: HYBRID.name });
    expect(infoCalls()).toHaveLength(1);
  });

  it('finds a btih-only hybrid magnet after its ID switches to v2, and removes it', async () => {
    const qb = service();
    await expect(qb.addDownload(magnetOf(HYBRID))).resolves.toEqual({ id: HYBRID.v1, alreadyInClient: false, infoHash: HYBRID.v1 });
    fake.receiveMetadata();
    await expect(qb.getDownload(HYBRID.v1)).resolves.toMatchObject({ id: HYBRID.id, name: HYBRID.name });
    await expect(qb.probeDownload(HYBRID.v1)).resolves.toMatchObject({ found: true });
    await qb.deleteDownload(HYBRID.v1, true);
    expect(fake.list).toEqual([]);
    expect(fake.requests.find((r) => r.path === '/api/v2/torrents/delete')?.params.hashes).toBe(HYBRID.id);
  });

  it('records a base32 magnet by its hex hash and finds it', async () => {
    const qb = service();
    await expect(qb.addDownload(magnetOf(PLAIN, { base32: true }))).resolves.toEqual({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 });
    await expect(qb.getDownload(PLAIN.v1)).resolves.toMatchObject({ name: PLAIN.name });
  });

  it('finds old rows stored by a hybrid v1 hash or a lower-case base32 hash, and acts on them', async () => {
    fake.seed(HYBRID, { addedAgoSec: 60, category: 'readmeabook' });
    fake.seed(PLAIN, { addedAgoSec: 60, category: 'readmeabook' });
    const qb = service();
    await expect(qb.getDownload(HYBRID.v1)).resolves.toMatchObject({ id: HYBRID.id });
    await expect(qb.getDownload(PLAIN.b32.toLowerCase())).resolves.toMatchObject({ id: PLAIN.v1 });
    await qb.setCategory(HYBRID.v1, 'done');
    await qb.setCategory(PLAIN.b32.toLowerCase(), 'done');
    expect(fake.list.map((t) => t.category)).toEqual(['done', 'done']);
  });

  it('adds a plain v1 .torrent after checking by v1 and the full list', async () => {
    const qb = service();
    await expect(qb.addDownload(fileUrl(PLAIN))).resolves.toEqual({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 });
    const calls = fake.requests.filter((r) => r.path !== '/api/v2/torrents/categories');
    expect(calls.map((r) => [r.path, r.params.hashes])).toEqual([
      ['/api/v2/torrents/info', PLAIN.v1],
      ['/api/v2/torrents/info', undefined],
      ['/api/v2/torrents/add', undefined],
    ]);
  });

  it('adds a plain v1 magnet after checking by v1 and the full list', async () => {
    const qb = service();
    await expect(qb.addDownload(magnetOf(PLAIN))).resolves.toEqual({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 });
    expect(fake.requests.filter((r) => r.path === '/api/v2/torrents/info').map((r) => r.params.hashes)).toEqual([PLAIN.v1, undefined]);
  });
});

describe('qBittorrent legacy add listed late', () => {
  it('records the v1 hash when the hybrid is not listed yet, and finds it later', async () => {
    fake.version = 'legacy';
    fake.lateAdds = true;
    const qb = service();
    await expect(qb.addDownload(fileUrl(HYBRID))).resolves.toEqual({ id: HYBRID.v1, alreadyInClient: false, infoHash: HYBRID.v1 });
    fake.flush();
    await expect(qb.getDownload(HYBRID.v1)).resolves.toMatchObject({ id: HYBRID.id });
  });
});

describe.each(['5.2', 'legacy'] as const)('qBittorrent %s on libtorrent 1.2', (version) => {
  beforeEach(() => {
    fake.version = version;
    fake.libtorrent = '1.2';
  });

  it.each([
    ['a hybrid .torrent', () => fileUrl(HYBRID)],
    ['a hybrid btih+btmh magnet', () => magnetOf(HYBRID, { btmh: true })],
  ])('records %s by its v1 hash and finds it in one request', async (_label, url) => {
    const qb = service();
    await expect(qb.addDownload(url())).resolves.toEqual({ id: HYBRID.v1, alreadyInClient: false, infoHash: HYBRID.v1 });
    fake.requests.length = 0;
    await expect(service().getDownload(HYBRID.v1)).resolves.toMatchObject({ id: HYBRID.v1 });
    expect(infoCalls()).toHaveLength(1);
  });
});

describe('a hybrid already in the client, added again by a btih-only magnet', () => {
  it.each(['4.4', 'legacy', '5.2'] as const)('qBittorrent %s: recorded as already in the client, never added', async (version) => {
    fake.version = version;
    fake.seed(HYBRID);
    await expect(service().addDownload(magnetOf(HYBRID))).resolves.toEqual({ id: HYBRID.id, alreadyInClient: true, infoHash: HYBRID.v1 });
    expect(fake.requests.some((r) => r.path === '/api/v2/torrents/add')).toBe(false);
    expect(fake.list).toHaveLength(1);
  });
});

describe('the pre-add full list cannot be read', () => {
  it.each([
    ['503', 'magnet', () => magnetOf(PLAIN)],
    ['503', '.torrent', () => fileUrl(PLAIN)],
    ['not-a-list', 'magnet', () => magnetOf(PLAIN)],
    ['not-a-list', '.torrent', () => fileUrl(HYBRID)],
  ] as const)('%s answer, %s add: nothing is added and the add fails closed', async (fault, _kind, url) => {
    fake.listFault = fault;
    await expect(service().addDownload(url())).rejects.toThrow("Couldn't read qBittorrent's torrent list to check for an existing copy");
    expect(fake.requests.some((r) => r.path === '/api/v2/torrents/add')).toBe(false);
  });
});

describe('pre-add list answers 403 once', () => {
  it('with credentials RMAB logs in again and the add goes on', async () => {
    fake.listFault = '403-once';
    await expect(new QBittorrentService(fake.url, 'user', 'pass').addDownload(magnetOf(PLAIN))).resolves.toEqual({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 });
    expect(fake.requests.filter((r) => r.path === '/api/v2/auth/login')).toHaveLength(2);
    expect(fake.list).toHaveLength(1);
  });
});

it('sends a magnet with HTML-escaped separators as the decoded link it parsed', async () => {
  await service().addDownload(`magnet:?dn=Plain&amp;xt=urn:btih:${PLAIN.v1}`);
  expect(fake.requests.find((r) => r.path === '/api/v2/torrents/add')?.params.urls).toBe(`magnet:?dn=Plain&xt=urn:btih:${PLAIN.v1}`);
});

describe('lookups of a torrent that is gone', () => {
  it('one getDownload call makes exactly one unfiltered lookup (the retries stay filtered)', async () => {
    await expect(service().getDownload(HYBRID.v1)).resolves.toBeNull();
    expect(fake.scans()).toBe(1);
    expect(infoCalls()).toHaveLength(5);
  }, 15000);

  it('concurrent getDownload calls share one unfiltered lookup', async () => {
    fake.scanDelayMs = 200;
    const qb = service();
    const ids = [HYBRID.v1, PLAIN.v1, HYBRID.id, PLAIN.b32, 'ab'.repeat(20)];
    await expect(Promise.all(ids.map((id) => qb.getDownload(id)))).resolves.toEqual([null, null, null, null, null]);
    expect(fake.scans()).toBe(1);
  }, 15000);

  it('a strict probe makes one lookup by ID and one unfiltered lookup', async () => {
    await expect(service().probeDownload(HYBRID.v1)).resolves.toEqual({ found: false });
    expect(infoCalls().map((r) => r.params.hashes)).toEqual([HYBRID.v1, undefined]);
  });
});
