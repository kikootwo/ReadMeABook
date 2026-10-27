/**
 * Component: E2E multi-file request download (zip through the download link, archiver 8)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Smoke scenario book (3 mp3 tracks) is requested, downloaded and organized. One more audio file,
 * whose name holds backslashes, is copied into the book folder. The download link from
 * POST /api/requests/:id/download-token is fetched with no auth header, and the zip is read back
 * here: every entry is flat, and each one's bytes match the file on disk by sha256.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, urls, waitFor, writeEvidence, evidencePath } from '../../lib/harness';
import { asApp, psql, q } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

interface ZipEntry { name: string; method: number; sha256: string; size: number }

/** Reads every entry of a zip (central directory, then each local header's data). */
function readZip(buf: Buffer): ZipEntry[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('no end of central directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error(`bad central header at ${pos}`);
    const method = buf.readUInt16LE(pos + 10);
    const compressed = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + compressed);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    entries.push({ name, method, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('349: a multi-file request downloads as one zip with flat entry names and the files\' bytes', async () => {
  await fakeArr.scenario('smoke');
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();
  const requestId = (await rmab.requestBook(book)).request.id;

  await waitFor('request downloaded/available', async () => (
    ['downloaded', 'available'].includes(psql(`select status from requests where id = '${requestId}'`)) ? true : null
  ), { timeoutMs: 300_000, intervalMs: 3_000 });

  const dir = psql(`select a.file_path from requests r join audiobooks a on a.id = r.audiobook_id where r.id = '${requestId}'`);
  expect(dir, 'organized book folder').toMatch(/^\/media\//);

  const tracks = asApp(`cd ${q(dir)}\nls -1 | grep -i '\\.mp3$'`).trim().split('\n').filter(Boolean);
  expect(tracks.length, 'the smoke book is several mp3 files, so the route zips them').toBeGreaterThanOrEqual(2);
  const oddName = 'Disc 2\\Extra track.mp3';
  asApp(`cd ${q(dir)}\ncp ${q(tracks[0])} ${q(oddName)}`);

  // Hash from stdin: sha256sum escapes a file name argument holding '\' and prefixes its line with '\'
  const onDisk = Object.fromEntries(
    asApp(`cd ${q(dir)}\nfor f in *.mp3; do printf '%s\\t%s\\n' "$(sha256sum < "$f" | cut -d' ' -f1)" "$f"; done`)
      .trim().split('\n').map((line) => { const [sha, name] = line.split('\t'); return [name, sha]; })
  );

  const { downloadUrl } = await rmab.post<{ downloadUrl: string }>(`/api/requests/${requestId}/download-token`);
  const res = await fetch(`${urls.rmab()}${downloadUrl}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/zip');
  const zip = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(evidencePath('349', 'download.zip'), zip);

  const entries = readZip(zip);
  const expected = Object.entries(onDisk)
    .map(([name, sha256]) => ({ name: name.replace(/[\\/:]/g, '_'), sha256 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const got = entries.map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name));
  writeEvidence('349/zip-download.json', {
    requestId, dir, contentDisposition: res.headers.get('content-disposition'), zipBytes: zip.length, onDisk, entries,
  });

  expect(Object.keys(onDisk)).toContain(oddName);
  expect(got).toEqual(expected);
  expect(got.map((e) => e.name)).toContain('Disc 2_Extra track.mp3');
  expect(got.filter((e) => e.name.includes('/') || e.name.includes('\\'))).toEqual([]);
});
