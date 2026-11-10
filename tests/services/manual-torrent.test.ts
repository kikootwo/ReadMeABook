/**
 * Component: Add Torrent - magnet rule and .torrent upload rule
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * - checkAddableMagnet: one torrent only (exactly one btih, at most one btmh), no control characters,
 *   at most 16 KiB; the value is the magnet with `&amp;` read as `&`, otherwise the string as given
 * - readUploadedTorrent: accepted only with an info dict, its bytes and safe non-negative lengths;
 *   anything else (20 raw bytes, bad lengths, bad base64, adversarial bencode) is refused, never thrown
 * - the bare magnet stored for a file add passes the magnet rule (encoded `dn`)
 */

import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('@/lib/integrations/prowlarr-connection', () => ({
  getProwlarrConnection: vi.fn(async () => {
    throw new Error('a magnet never needs the Prowlarr connection');
  }),
}));

import { checkAddableMagnet } from '@/lib/services/download-selection-guard';
import { bareMagnet, manualFileResult, manualMagnetResult, readUploadedTorrent, torrentTitle } from '@/lib/services/manual-torrent';
import { isMagnetUri } from '@/lib/utils/prowlarr-url';
import { magnetHashes } from '@/lib/integrations/torrent-ids';
import { HYBRID, PLAIN, torrentFile } from '../helpers/fake-qbittorrent';

const HEX = 'c'.repeat(40);
const B32 = 'A'.repeat(32);
const V2 = `1220${'d'.repeat(64)}`;

/** Minimal bencode for generated test torrents (dict keys sorted, as the format requires) */
type B = number | string | Buffer | B[] | { [key: string]: B };
function bencode(value: B): string {
  if (typeof value === 'number') return `i${value}e`;
  if (typeof value === 'string') return `${Buffer.byteLength(value)}:${value}`;
  if (Buffer.isBuffer(value)) return `${value.length}:${value.toString('latin1')}`;
  if (Array.isArray(value)) return `l${value.map(bencode).join('')}e`;
  return `d${Object.keys(value).sort().map((k) => bencode(k) + bencode(value[k])).join('')}e`;
}
const b64 = (raw: string | Buffer) => Buffer.from(raw as string, typeof raw === 'string' ? 'latin1' : undefined).toString('base64');
const info = (extra: Record<string, B>) => ({ 'piece length': 16384, pieces: Buffer.alloc(20, 1), name: 'Generated Book', ...extra });
const torrent = (infoDict: Record<string, B>) => b64(bencode({ announce: 'http://tracker.invalid/announce', info: infoDict }));

describe('checkAddableMagnet', () => {
  it.each([
    ['40 hex', `magnet:?xt=urn:btih:${HEX}`],
    ['32 base32', `magnet:?xt=urn:btih:${B32}`],
    ['an xt.1 btih', `magnet:?xt.1=urn:btih:${HEX}`],
    ['a hybrid (one btih, one btmh)', `magnet:?xt=urn:btih:${HEX}&xt=urn:btmh:${V2}`],
  ])('accepts %s', async (_label, magnet) => {
    await expect(checkAddableMagnet(magnet)).resolves.toEqual({ ok: true, value: magnet });
  });

  it('keeps every other parameter byte for byte (trackers, web seeds, name)', async () => {
    const magnet = `magnet:?xt=urn:btih:${HEX}&dn=A%20Book&${Array.from({ length: 20 }, (_, i) => `tr=udp%3A%2F%2Ft${i}.invalid%3A80`).join('&')}&ws=http%3A%2F%2Fseed.invalid%2F`;
    await expect(checkAddableMagnet(magnet)).resolves.toEqual({ ok: true, value: magnet });
  });

  it('sends an upper-case scheme, xt and urn lower-cased (every client tests for "magnet:")', async () => {
    await expect(checkAddableMagnet(`MAGNET:?XT=URN:BTIH:${HEX}&dn=Book`)).resolves.toEqual({ ok: true, value: `magnet:?xt=urn:btih:${HEX}&dn=Book` });
  });

  it('reads nested &amp;amp; down to & (one torrent stays accepted)', async () => {
    await expect(checkAddableMagnet(`magnet:?xt=urn:btih:${HEX}&amp;amp;dn=Book`)).resolves.toEqual({ ok: true, value: `magnet:?xt=urn:btih:${HEX}&dn=Book` });
  });

  it('reads &amp; as & (what Transmission and Deluge are sent as well)', async () => {
    await expect(checkAddableMagnet(`magnet:?xt=urn:btih:${HEX}&amp;tr=udp%3A%2F%2Ft.invalid`))
      .resolves.toEqual({ ok: true, value: `magnet:?xt=urn:btih:${HEX}&tr=udp%3A%2F%2Ft.invalid` });
  });

  it.each([
    ['an http link', 'http://prowlarr:9696/1/download?link=abc', 'This is not a magnet link.'],
    ['an empty string', '', 'Paste a magnet link.'],
    ['a number', 42, 'Paste a magnet link.'],
    ['no xt', 'magnet:?dn=Book', 'This magnet link has no info hash.'],
    ['39 hex', `magnet:?xt=urn:btih:${HEX.slice(1)}`, "This magnet link's info hash is not valid."],
    ['41 hex', `magnet:?xt=urn:btih:${HEX}c`, "This magnet link's info hash is not valid."],
    ['31 base32', `magnet:?xt=urn:btih:${B32.slice(1)}`, "This magnet link's info hash is not valid."],
    ['33 base32', `magnet:?xt=urn:btih:${B32}A`, "This magnet link's info hash is not valid."],
    ['btmh only (pure v2)', `magnet:?xt=urn:btmh:${V2}`, 'ReadMeABook needs a torrent with a v1 hash.'],
    ['two btih (xt and xt.1)', `magnet:?xt=urn:btih:${HEX}&xt.1=urn:btih:${B32}`, 'This magnet link names more than one torrent.'],
    ['two btmh', `magnet:?xt=urn:btih:${HEX}&xt=urn:btmh:${V2}&xt.2=urn:btmh:${V2}`, 'This magnet link names more than one torrent.'],
    ['a second btih hidden in a tracker URL', `magnet:?xt=urn:btih:${HEX}&tr=http://t.invalid/a?xt=urn:btih:${B32}`, 'This magnet link names more than one torrent.'],
    ['a newline', `magnet:?xt=urn:btih:${HEX}\nmagnet:?xt=urn:btih:${B32}`, 'This is not a magnet link.'],
    ['a space', `magnet:?xt=urn:btih:${HEX}&dn=A Book`, 'This is not a magnet link.'],
    ['a NUL', `magnet:?xt=urn:btih:${HEX}\u0000`, 'This is not a magnet link.'],
    ['a DEL', `magnet:?xt=urn:btih:${HEX}\u007f`, 'This is not a magnet link.'],
    ['a second btih behind a double-escaped &amp;amp;', `magnet:?xt=urn:btih:${HEX}&amp;amp;xt=urn:btih:${B32}`, 'This magnet link names more than one torrent.'],
    ['a second btih with a percent-encoded urn', `magnet:?xt=urn:btih:${HEX}&xt=urn%3Abtih%3A${B32}`, 'This magnet link names more than one torrent.'],
    ['a second xt with a percent-encoded &', `magnet:?xt=urn:btih:${HEX}%26xt=urn:btih:${B32}`, 'This magnet link names more than one torrent.'],
    ['its only btih percent-encoded (RMAB could not read it as sent)', `magnet:?xt=urn%3Abtih%3A${HEX}`, "This magnet link's info hash is not valid."],
    ['over 16 KiB', `magnet:?xt=urn:btih:${HEX}&tr=${'a'.repeat(16 * 1024)}`, 'This magnet link is too long.'],
  ])('refuses %s', async (_label, magnet, error) => {
    await expect(checkAddableMagnet(magnet)).resolves.toEqual({ ok: false, error });
  });
});

describe('readUploadedTorrent', () => {
  it('a single-file torrent: the bytes unchanged, v1 hash, the name and total size', async () => {
    const result = await readUploadedTorrent(torrentFile(PLAIN).toString('base64'));
    expect(result).toEqual({ ok: true, value: { data: torrentFile(PLAIN), infoHash: PLAIN.v1, title: PLAIN.name, size: 1 } });
  });

  it('a hybrid torrent is keyed by its v1 hash', async () => {
    const result = await readUploadedTorrent(torrentFile(HYBRID).toString('base64'));
    expect(result).toMatchObject({ ok: true, value: { infoHash: HYBRID.v1 } });
  });

  it('a multi-file torrent: the size is the total of its files', async () => {
    const files = [{ length: 1000, path: ['01.mp3'] }, { length: 2500, path: ['02.mp3'] }];
    const result = await readUploadedTorrent(torrent(info({ files })));
    expect(result).toMatchObject({ ok: true, value: { title: 'Generated Book', size: 3500 } });
  });

  it('a name with control characters is cleaned, not refused; an empty one falls back to the hash', async () => {
    const result = await readUploadedTorrent(torrent(info({ length: 5, name: 'Bad\u0000\u001b[31mName\n\tHere' })));
    expect(result).toMatchObject({ ok: true, value: { title: 'Bad [31mName Here' } });
    expect(torrentTitle('\u0000\u0007 ', HEX)).toBe(`Manual torrent ${HEX.slice(0, 8)}`);
    expect(torrentTitle('x'.repeat(400), HEX)).toHaveLength(255);
  });

  it.each([
    ['20 random bytes (parse-torrent reads them as a bare info hash)', () => randomBytes(20).toString('base64')],
    ['random bytes', () => randomBytes(4096).toString('base64')],
    ['bencode without info', () => b64(bencode({ announce: 'http://t.invalid', comment: 'none' }))],
    ['a negative length', () => torrent(info({ length: -5 }))],
    ['a negative file length that sums positive', () => torrent(info({ files: [{ length: -5, path: ['a'] }, { length: 10, path: ['b'] }] }))],
    ['a 400-digit length', () => b64(`d4:infod6:lengthi${'9'.repeat(400)}e4:name4:Book12:piece lengthi16384e6:pieces20:${'x'.repeat(20)}ee`)],
    ['characters outside base64', () => `${torrentFile(PLAIN).toString('base64').slice(0, -4)}!!==`],
    ['base64 of a length that is not a multiple of 4', () => torrentFile(PLAIN).toString('base64').replace(/=+$/, '').slice(0, -1)],
    ['200,000 levels of nesting', () => b64(`${'l'.repeat(200_000)}${'e'.repeat(200_000)}`)],
    ['a dict with about 150,000 keys', () => b64(`d${Array.from({ length: 150_000 }, (_, i) => `7:k${String(i).padStart(6, '0')}i0e`).join('')}e`)],
  ])('refuses %s with "Not a valid .torrent file."', async (_label, input) => {
    await expect(readUploadedTorrent(input())).resolves.toEqual({ ok: false, error: 'Not a valid .torrent file.' });
  });

  it('refuses a file over 2 MiB before decoding it', async () => {
    const over = Buffer.alloc(2 * 1024 * 1024 + 1, 0x61).toString('base64');
    await expect(readUploadedTorrent(over)).resolves.toEqual({ ok: false, error: 'This .torrent file is larger than 2 MB.' });
  });
});

describe('the releases a hand-added torrent carries', () => {
  it.each(['Plain Title', 'A Book: 100% Ünïcödé & More?', 'Tabs\tand\nnewlines', '%E0 broken escape'])(
    'the bare magnet stored for a file add passes the magnet rule (%s)',
    async (name) => {
      const title = torrentTitle(name, HEX);
      const magnet = bareMagnet(HEX, title);
      expect(isMagnetUri(magnet)).toBe(true);
      await expect(checkAddableMagnet(magnet)).resolves.toEqual({ ok: true, value: magnet });
      expect(magnetHashes(magnet)?.v1).toBe(HEX);
      expect(manualMagnetResult(magnet, HEX).title).toBe(title);
    }
  );

  it('a file add: label Manual, no indexer id, the bare magnet as link and guid, no bytes on the release', async () => {
    const upload = await readUploadedTorrent(torrentFile(PLAIN).toString('base64'));
    if (!upload.ok) throw new Error('fixture refused');
    const release = manualFileResult(upload.value);
    expect(release).toMatchObject({
      indexer: 'Manual', title: PLAIN.name, size: 1, infoHash: PLAIN.v1, protocol: 'torrent',
      downloadUrl: bareMagnet(PLAIN.v1, PLAIN.name), guid: bareMagnet(PLAIN.v1, PLAIN.name),
    });
    expect(release.indexerId).toBeUndefined();
    expect(JSON.stringify(release)).not.toContain(torrentFile(PLAIN).toString('base64'));
  });

  it('a magnet add: title from dn (a broken escape never throws), size from xl', () => {
    expect(manualMagnetResult(`magnet:?xt=urn:btih:${HEX}&dn=%E0Book&xl=12345`, HEX)).toMatchObject({ title: `${String.fromCharCode(0xfffd)}Book`, size: 12345 });
    expect(manualMagnetResult(`magnet:?xt=urn:btih:${HEX}&xl=-1`, HEX)).toMatchObject({ title: `Manual torrent ${HEX.slice(0, 8)}`, size: 0 });
  });
});
