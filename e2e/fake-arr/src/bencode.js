/**
 * Component: E2E fake-arr bencode + .torrent/.nzb builders
 * Documentation: documentation/testing/e2e-harness.md
 */

import { createHash } from 'node:crypto';

/** Bencode a value (Buffer, string, integer, array, plain object with sorted keys). */
export function bencode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === 'string') return bencode(Buffer.from(value, 'utf8'));
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`bencode: non-integer ${value}`);
    return Buffer.from(`i${value}e`);
  }
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys.flatMap((k) => [bencode(k), bencode(value[k])]);
    return Buffer.concat([Buffer.from('d'), ...parts, Buffer.from('e')]);
  }
  throw new Error(`bencode: unsupported type ${typeof value}`);
}

const PIECE_LENGTH = 256 * 1024;

/**
 * Build a multi-file .torrent for a release.
 * files: [{ path: ['a.mp3'], length }]. Pieces are placeholder hashes: nothing verifies them.
 * Returns { buffer, infoHash } where infoHash is the lowercase hex SHA-1 of the bencoded info dict.
 */
export function buildTorrent({ name, files, announce, source }) {
  const total = files.reduce((sum, f) => sum + f.length, 0);
  const pieceCount = Math.max(1, Math.ceil(total / PIECE_LENGTH));
  const pieces = Buffer.concat(
    Array.from({ length: pieceCount }, (_, i) => createHash('sha1').update(`${name}:${i}`).digest())
  );
  const info = {
    name,
    'piece length': PIECE_LENGTH,
    pieces,
    files: files.map((f) => ({ length: f.length, path: f.path })),
    // `source` (as private trackers use it) makes the info-hash unique per release.
    ...(source ? { source } : {}),
  };
  const infoHash = createHash('sha1').update(bencode(info)).digest('hex');
  const buffer = bencode({ announce, 'created by': 'rmab-e2e-fake-arr', info });
  return { buffer, infoHash };
}

/** Deterministic info-hash for magnet-only releases. */
export function magnetHash(seed) {
  return createHash('sha1').update(`magnet:${seed}`).digest('hex');
}

export function buildMagnet(hash, name, tracker) {
  const params = new URLSearchParams({ dn: name, tr: tracker });
  return `magnet:?xt=urn:btih:${hash}&${params.toString()}`;
}

/** Minimal NZB document; the release id is embedded so each release's NZB is unique. */
export function buildNzb({ name, files, releaseId }) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const fileXml = files
    .map(
      (f, i) =>
        `  <file poster="e2e@fake-arr" date="1700000000" subject="&quot;${escape(f.path.join('/'))}&quot; yEnc (1/1)">\n` +
        `    <groups><group>alt.binaries.e2e</group></groups>\n` +
        `    <segments><segment bytes="${f.length}" number="1">e2e-${i}-${escape(name)}@fake-arr</segment></segments>\n` +
        `  </file>`
    )
    .join('\n');
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">\n` +
      `  <head><meta type="name">${escape(name)}</meta><meta type="x-fake-arr-release">${escape(String(releaseId))}</meta></head>\n${fileXml}\n</nzb>\n`
  );
}
