/**
 * Component: E2E fixture generator tests (node:test, host-run, needs ffmpeg/ffprobe on PATH)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate, parseArgs, safeName, fillTemplate } from '../generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..');
let out;
let index;

const probe = (file, entries) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-of', 'json', ...entries, file], { encoding: 'utf8' }));

before(async () => {
  out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-fx-')), 'fx');
  index = await generate({
    out,
    manifest: path.join(FIXTURES, 'manifest.json'),
    metadata: path.join(HERE, 'offline-metadata.json'),
    ffmpeg: process.env.FFMPEG || 'ffmpeg',
  });
});

after(() => fs.rmSync(path.dirname(out), { recursive: true, force: true }));

test('index lists every manifest fixture with real file sizes, total under 2 MB', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(index.fixtures).sort(), Object.keys(manifest.fixtures).sort());
  let total = 0;
  for (const [id, fx] of Object.entries(index.fixtures)) {
    for (const f of fx.files) {
      const size = fs.statSync(path.join(out, id, f.rel)).size;
      assert.equal(size, f.size);
      total += size;
    }
  }
  assert.ok(total < 2 * 1024 * 1024, `fixtures total ${total} bytes`);
});

test('multi-file mp3s carry album / album_artist / composer / track tags', () => {
  const fx = index.fixtures['phm-mp3'];
  assert.equal(fx.files.length, 3);
  const tags = probe(path.join(out, 'phm-mp3', fx.files[1].rel), ['-show_entries', 'format_tags']).format.tags;
  assert.equal(tags.album, 'Fixture Book One');
  assert.equal(tags.album_artist, 'Test Author');
  assert.equal(tags.composer, 'Test Narrator');
  assert.equal(tags.track, '2/3');
});

test('m4b has one chapter per manifest chapter and book-level tags', () => {
  const fx = index.fixtures['phm-m4b'];
  assert.equal(fx.files.length, 1);
  assert.match(fx.files[0].rel, /\.m4b$/);
  const file = path.join(out, 'phm-m4b', fx.files[0].rel);
  const { chapters } = probe(file, ['-show_chapters']);
  assert.equal(chapters.length, 3);
  assert.equal(chapters[2].tags.title, 'Chapter 3');
  const tags = probe(file, ['-show_entries', 'format_tags']).format.tags;
  assert.equal(tags.album, 'Fixture Book One');
});

test('ASIN folder fixture is named "<title> [<ASIN>]"', () => {
  assert.equal(index.fixtures['phm-asin'].folder, 'Fixture Book One [B08G9PRS1K]');
  assert.match(index.fixtures['phm-asin'].folder, /\[B0[A-Z0-9]{8}\]$/);
});

test('wrong-files fixture contains no audio', () => {
  assert.ok(index.fixtures['wrong-files'].files.every((f) => !/\.(mp3|m4b|m4a|flac)$/.test(f.rel)));
});

test('helpers: safeName strips path characters; fillTemplate rejects unknown fields; parseArgs validates', () => {
  assert.equal(safeName('A/B: C?'), 'AB C');
  assert.throws(() => fillTemplate('{{missing}}', { asin: 'X' }), /missing/);
  assert.throws(() => parseArgs(['--bogus', '1']), /unknown option/);
  assert.throws(() => parseArgs([]), /--out/);
});
