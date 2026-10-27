/**
 * Component: qBittorrent Torrent ID Tests (#422)
 * Documentation: documentation/phase3/qbittorrent.md
 */

import { describe, expect, it, vi } from 'vitest';
import parseTorrent from 'parse-torrent';
import {
  acceptedAddId,
  base32ToHex,
  hexToBase32,
  candidateIds,
  findTorrent,
  isSameTorrent,
  lookupTorrent,
  magnetHashes,
  normalizeTorrentId,
  qbittorrentId,
  SharedRequest,
  TorrentIdMap,
  torrentFileHashes,
  torrentHashForms,
  validTorrentId,
} from '@/lib/integrations/qbittorrent-ids';
import { HYBRID, torrentFile } from '../helpers/fake-qbittorrent';

const HEX = '0123456789abcdef0123456789abcdef01234567';
const B32 = 'AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH';

describe('base32 hashes', () => {
  it.each([
    [B32, HEX],
    [B32.toLowerCase(), HEX],
    ['WZUS5JO7SIGK22I4EAYZU37726SKOZVY', 'b6692ea5df920cad691c20319a6fffd7a4a766b8'],
  ])('decodes %s', (value, hex) => {
    expect(base32ToHex(value)).toBe(hex);
    expect(normalizeTorrentId(value)).toBe(hex);
  });

  it('encodes hex as base32 and lists every form a row may hold', () => {
    expect(hexToBase32(HEX)).toBe(B32);
    expect(hexToBase32('b6692ea5df920cad691c20319a6fffd7a4a766b8')).toBe('WZUS5JO7SIGK22I4EAYZU37726SKOZVY');
    expect(torrentHashForms(B32)).toEqual([B32, HEX, HEX.toUpperCase(), B32.toLowerCase()]);
    expect(torrentHashForms(HEX)).toEqual([HEX, HEX.toUpperCase(), B32.toLowerCase(), B32]);
    expect(torrentHashForms('hash-1')).toEqual(['hash-1']);
  });

  it.each([['too short', B32.slice(1)], ['not base32 (0, 1, 8, 9)', '0'.repeat(32)], ['hex', HEX]])('rejects %s', (_label, value) => {
    expect(base32ToHex(value)).toBeNull();
    expect(normalizeTorrentId(value)).toBe(value);
  });

  it('lower-cases a stored upper-case hex hash; the row forms list it in both cases (#460)', () => {
    expect(normalizeTorrentId(HEX.toUpperCase())).toBe(HEX);
    expect(torrentHashForms(HEX.toUpperCase())).toEqual([HEX.toUpperCase(), HEX, B32.toLowerCase(), B32]);
  });
});

describe('magnetHashes', () => {
  const btmh = `1220${HYBRID.v2}`;
  it.each([
    ['hex btih', `magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=Book`, { v1: HEX }],
    ['base32 btih', `magnet:?xt=urn:btih:${B32}&dn=Book`, { v1: HEX }],
    ['lower-case base32 btih', `magnet:?dn=Book&xt=urn:btih:${B32.toLowerCase()}`, { v1: HEX }],
    ['btih and btmh', `magnet:?xt=urn:btih:${HYBRID.v1}&xt=urn:btmh:${btmh}`, { v1: HYBRID.v1, v2: HYBRID.v2 }],
    ['numbered xt params', `magnet:?xt.1=urn:btmh:${btmh}&xt.2=urn:btih:${HYBRID.v1}`, { v1: HYBRID.v1, v2: HYBRID.v2 }],
    ['btmh only', `magnet:?xt=urn:btmh:${btmh}`, { v2: HYBRID.v2 }],
    ['HTML-escaped separators', `magnet:?dn=Book&amp;xt=urn:btih:${HYBRID.v1}&amp;xt=urn:btmh:${btmh}`, { v1: HYBRID.v1, v2: HYBRID.v2 }],
  ])('reads %s', (_label, url, hashes) => {
    expect(magnetHashes(url)).toEqual(hashes);
  });

  it.each([
    ['no hash', 'magnet:?xt=urn:btih:'],
    ['invalid base32', `magnet:?xt=urn:btih:${'0'.repeat(32)}`],
    ['a non-SHA-256 multihash', `magnet:?xt=urn:btmh:1114${'a'.repeat(40)}`],
  ])('returns null for %s', (_label, url) => {
    expect(magnetHashes(url)).toBeNull();
  });
});

describe('torrentFileHashes', () => {
  it('reads v1 and v2 from a hybrid .torrent parsed by parse-torrent', async () => {
    expect(torrentFileHashes(await parseTorrent(torrentFile(HYBRID)))).toEqual({ v1: HYBRID.v1, v2: HYBRID.v2 });
  });

  it('keeps the v1 hash as parse-torrent returns it and has no v2 for a v1 torrent', () => {
    expect(torrentFileHashes({ infoHash: 'hash-1' })).toEqual({ v1: 'hash-1', v2: undefined });
    expect(torrentFileHashes({})).toBeNull();
  });
});

describe('IDs', () => {
  it('uses the truncated v2 hash for a hybrid, else v1', () => {
    expect(qbittorrentId({ v1: HYBRID.v1, v2: HYBRID.v2 })).toBe(HYBRID.id);
    expect(qbittorrentId({ v1: HEX })).toBe(HEX);
    expect(candidateIds({ v1: HYBRID.v1, v2: HYBRID.v2 })).toEqual([HYBRID.id, HYBRID.v1]);
    expect(candidateIds({ v1: HEX })).toEqual([HEX]);
  });

  it('accepts only a single 40-hex client ID', () => {
    expect(validTorrentId(HEX.toUpperCase())).toBe(HEX);
    for (const value of ['all', `${HEX}|${HEX}`, 'hash-1', 123, undefined]) expect(validTorrentId(value)).toBeNull();
  });

  it('matches hash or infohash_v1, never an empty one', () => {
    expect(isSameTorrent({ hash: HYBRID.id, infohash_v1: HYBRID.v1 }, [HYBRID.v1])).toBe(true);
    expect(isSameTorrent({ hash: HYBRID.id.toUpperCase() }, [HYBRID.id])).toBe(true);
    expect(isSameTorrent({ hash: HYBRID.id, infohash_v1: '' }, [''])).toBe(false);
    expect(isSameTorrent({ hash: HEX }, [HYBRID.v1])).toBe(false);
  });
});

describe('acceptedAddId', () => {
  const hybrid = { v1: HYBRID.v1, v2: HYBRID.v2 };
  const receipt = (ids: unknown[]) => ({ success_count: 1, failure_count: 0, pending_count: 0, added_torrent_ids: ids });

  it('resolves "Ok." to the v1 hash (libtorrent 1.2 builds use it as the ID)', () => {
    expect(acceptedAddId('Ok.', hybrid)).toBe(HYBRID.v1);
    expect(acceptedAddId('Ok.', { v2: HYBRID.v2 })).toBe(HYBRID.id);
  });

  it.each([
    ['the truncated v2 ID', HYBRID.id.toUpperCase(), HYBRID.id],
    ['the v1 ID', HYBRID.v1, HYBRID.v1],
  ])('accepts a 5.2 receipt with %s', (_label, id, expected) => {
    expect(acceptedAddId(receipt([id]), hybrid)).toBe(expected);
  });

  it.each([
    ['another torrent', receipt([HEX])],
    ['two IDs', receipt([HYBRID.id, HYBRID.v1])],
    ['a pending add', { ...receipt([HYBRID.id]), pending_count: 1 }],
    ['Fails.', 'Fails.'],
  ])('rejects %s', (_label, body) => {
    expect(acceptedAddId(body, hybrid)).toBeNull();
  });
});

describe('TorrentIdMap and SharedRequest', () => {
  it('keeps at most its limit (oldest dropped) and only 40-hex values', () => {
    const map = new TorrentIdMap(2);
    map.set('a', HEX);
    map.set('b', HYBRID.id);
    map.set('c', HYBRID.v1);
    map.set('d', 'all');
    expect([map.get('a'), map.get('b'), map.get('C'), map.get('d')]).toEqual([undefined, HYBRID.id, HYBRID.v1, undefined]);
    expect(new TorrentIdMap().get('x')).toBeUndefined();
  });

  it('keeps 5000 entries by default', () => {
    const map = new TorrentIdMap();
    for (let i = 0; i <= 5000; i++) map.set(`id-${i}`, HEX);
    expect([map.get('id-0'), map.get('id-1'), map.get('id-5000')]).toEqual([undefined, HEX, HEX]);
  });

  it('shares one pending request and starts a new one after it settles', async () => {
    const shared = new SharedRequest<number>();
    const request = vi.fn(async () => 1);
    await Promise.all([shared.run(request), shared.run(request), shared.run(request)]);
    await shared.run(request);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('findTorrent and lookupTorrent', () => {
  const hybrid = { hash: HYBRID.id, infohash_v1: HYBRID.v1 };

  it('scans once only when every filtered answer is empty', async () => {
    const list = vi.fn(async (hashes?: string) => (hashes === undefined ? [hybrid] : []));
    await expect(findTorrent([HYBRID.id, HYBRID.v1], [HYBRID.id, HYBRID.v1], list, true)).resolves.toBe(hybrid);
    expect(list.mock.calls).toEqual([[HYBRID.id], [HYBRID.v1], []]);
    await expect(findTorrent([HYBRID.v1], [HYBRID.v1], list, false)).resolves.toBeNull();
  });

  it('does not scan after a non-empty answer (a client that ignores the filter)', async () => {
    const list = vi.fn(async () => [{ hash: HEX }]);
    await expect(findTorrent([HYBRID.v1], [HYBRID.v1], list, true)).resolves.toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('remembers the client ID and queries it next time', async () => {
    const map = new TorrentIdMap();
    const list = vi.fn(async (hashes?: string) => (hashes === HYBRID.id || hashes === undefined ? [hybrid] : []));
    await expect(lookupTorrent(HYBRID.v1, map, list, true)).resolves.toBe(hybrid);
    await expect(lookupTorrent(HYBRID.v1.toUpperCase(), map, list, true)).resolves.toBe(hybrid);
    expect(list.mock.calls).toEqual([[HYBRID.v1], [], [HYBRID.id]]);
  });
});
