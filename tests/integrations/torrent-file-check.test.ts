/**
 * Component: Downloaded .torrent File Structure Check tests
 * Documentation: documentation/phase3/download-clients.md
 *
 * The torrents built here are real ones; parse-torrent reads them to show that a file which
 * passes the check still parses.
 */

import { describe, expect, it } from 'vitest';
import parseTorrent from 'parse-torrent';
import { isWellFormedTorrentFile, MAX_TORRENT_DEPTH } from '@/lib/integrations/torrent-file-check';
import { HYBRID, PLAIN, torrentFile } from '../helpers/fake-qbittorrent';

type Bencodable = number | string | Buffer | Bencodable[] | { [key: string]: Bencodable };

/** Minimal bencode encoder for building real torrents (keys sorted, as the spec requires) */
function bencode(value: Bencodable): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]);
  }
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  const keys = Object.keys(value).sort();
  return Buffer.concat([Buffer.from('d'), ...keys.flatMap((k) => [bencode(k), bencode(value[k])]), Buffer.from('e')]);
}

/** Deterministic pseudo-random bytes (LCG) */
function pseudoRandomBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

const singleFileTorrent = bencode({
  announce: 'http://tracker.example/announce',
  'creation date': 1700000000,
  info: { length: 1048576, name: 'Book.m4b', 'piece length': 262144, pieces: pseudoRandomBytes(80, 1) },
});

const multiFileTorrent = bencode({
  announce: 'http://tracker.example/announce',
  'announce-list': [['http://tracker.example/announce'], ['udp://backup.example:6969/announce', 'http://third.example/a']],
  comment: 'generated for tests',
  'creation date': 1700000000,
  info: {
    files: [
      { length: 52428800, path: ['Book', 'Part 1.mp3'] },
      { length: 52428800, path: ['Book', 'Part 2.mp3'] },
      { length: 2048, path: ['cover.jpg'] },
    ],
    name: 'Book',
    'piece length': 16384,
    pieces: pseudoRandomBytes(20 * 6400, 2),
    private: 1,
  },
});

const bytes = (s: string) => Buffer.from(s, 'latin1');

describe('isWellFormedTorrentFile', () => {
  it.each([
    ['a v1 single-file torrent', singleFileTorrent],
    ['a multi-file torrent with a large pieces string and an announce-list', multiFileTorrent],
    ['the plain fixture', torrentFile(PLAIN)],
    ['the hybrid fixture', torrentFile(HYBRID)],
  ])('accepts %s, which parse-torrent also reads', async (_label, file) => {
    expect(isWellFormedTorrentFile(file)).toBe(true);
    const parsed = await parseTorrent(file);
    expect(parsed.infoHash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('accepts every integer form, empty strings, empty containers and nesting at the cap', () => {
    expect(isWellFormedTorrentFile(bytes('d1:ai-5e1:b0:1:cle1:ddee'))).toBe(true);
    const atCap = MAX_TORRENT_DEPTH - 1; // the top-level dict is one level
    expect(isWellFormedTorrentFile(bytes(`d1:a${'l'.repeat(atCap)}${'e'.repeat(atCap)}e`))).toBe(true);
  });

  it.each([
    ['a newline', '\n'],
    ['CRLF', '\r\n'],
    ['a space', ' '],
    ['a NUL byte', '\0'],
  ])('accepts a real torrent followed by %s, which parse-torrent ignores', async (_label, tail) => {
    const file = Buffer.concat([singleFileTorrent, bytes(tail)]);
    expect(isWellFormedTorrentFile(file)).toBe(true);
    expect((await parseTorrent(file)).infoHash).toBe((await parseTorrent(singleFileTorrent)).infoHash);
  });

  it('stops at the end of the top-level dict and ignores whatever follows', () => {
    expect(isWellFormedTorrentFile(bytes('d1:ai1eex'))).toBe(true);
    expect(isWellFormedTorrentFile(bytes('d1:ai1eede'))).toBe(true);
    expect(isWellFormedTorrentFile(bytes('d1:ai1ee4:junk'))).toBe(true);
  });

  it.each(['+', ' ', 'x', ':'])('refuses a string length that is not plain digits (%j before it)', (prefix) => {
    expect(isWellFormedTorrentFile(bytes(`d4:info${prefix}3:abce`))).toBe(false);
  });

  it.each([
    ['a string length that runs past the end of the file', 'd4:infod4:name99:Booke'],
    ['a letter between the length and the colon', 'd4:info3x:abce'],
    ['a space between the length and the colon', 'd4:info3 :abce'],
    ['a 400-digit string length', `d4:info${'9'.repeat(400)}:xe`],
    ['an 11-digit string length', 'd4:info00000000001:xe'],
    ['nesting past the cap', `d1:a${'l'.repeat(MAX_TORRENT_DEPTH)}${'e'.repeat(MAX_TORRENT_DEPTH)}e`],
    ['an empty buffer', ''],
    ['a top-level list', 'l4:spame'],
    ['a top-level string', '4:spam'],
    ['an unclosed dict', 'd1:ai1e'],
    ['an unclosed list', 'd1:al1:x'],
    ['a key with no value', 'd1:ae'],
    ['a non-string dict key', 'di1ei2ee'],
    ['a list as a dict key', 'dlei1ee'],
    ['a missing colon', 'd4infoe'],
    ['an integer with a plus prefix', 'd1:ai+5ee'],
    ['an empty integer', 'd1:aiee'],
    ['a fractional integer', 'd1:ai1.5ee'],
    ['an integer with no end marker', 'd1:ai12'],
    ['a 33-digit integer', `d1:ai${'1'.repeat(33)}ee`],
    ['an unknown type byte', 'd1:axe'],
    ['a stray end byte', 'e'],
  ])('refuses %s', (_label, input) => {
    expect(isWellFormedTorrentFile(bytes(input))).toBe(false);
  });

  it('refuses a 20-byte random buffer, and one that starts like a dict', () => {
    const random = pseudoRandomBytes(20, 42);
    expect(isWellFormedTorrentFile(random)).toBe(false);
    random[0] = 0x64;
    expect(isWellFormedTorrentFile(random)).toBe(false);
  });

  it('refuses input that is not a byte buffer without throwing', () => {
    for (const input of [null, undefined, 'd1:ai1ee', 42, {}]) {
      expect(isWellFormedTorrentFile(input as unknown as Buffer)).toBe(false);
    }
  });

  it('never throws on truncated or mutated copies of a real torrent', () => {
    const base = singleFileTorrent;
    for (let cut = 0; cut < base.length; cut++) {
      expect(isWellFormedTorrentFile(base.subarray(0, cut))).toBe(false);
    }
    for (let i = 0; i < 2000; i++) {
      const copy = Buffer.from(base);
      const noise = pseudoRandomBytes(2, i);
      copy[noise[0] % copy.length] = noise[1];
      expect(typeof isWellFormedTorrentFile(copy)).toBe('boolean');
    }
  });

  it('runs in linear time on large inputs', () => {
    const longList = bytes(`d1:al${'1:x'.repeat(400000)}ee`);
    const longDigits = bytes(`d1:al${'1'.repeat(1_000_000)}`);
    const started = performance.now();
    expect(isWellFormedTorrentFile(longList)).toBe(true);
    expect(isWellFormedTorrentFile(longDigits)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
