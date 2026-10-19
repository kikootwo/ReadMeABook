#!/usr/bin/env node
/**
 * Component: E2E fixture generator (synthetic audiobooks from ffmpeg tones)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Usage: node e2e/fixtures/generate.mjs --out <dir> [--manifest <file>] [--metadata <file>] [--ffmpeg <bin>]
 *   --metadata  JSON { "<asin>": { title, author, narrator, runtimeMin } } used instead of Audnexus (offline).
 * Writes <out>/<fixtureId>/<files> and <out>/index.json (books + fixture file lists with sizes).
 * Output is small (well under 2 MB total). Nothing here is committed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDNEXUS = 'https://api.audnex.us/books';

export function parseArgs(argv) {
  const args = { manifest: path.join(HERE, 'manifest.json'), ffmpeg: process.env.FFMPEG || 'ffmpeg' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!['out', 'manifest', 'metadata', 'ffmpeg'].includes(key)) throw new Error(`unknown option ${argv[i]}`);
    args[key] = argv[++i];
  }
  if (!args.out) throw new Error('--out <dir> is required');
  return args;
}

/** Strip characters that are illegal in file names on any common filesystem. */
export function safeName(name) {
  return name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

export function fillTemplate(template, book) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (book[k] === undefined) throw new Error(`template field {{${k}}} missing for ${book.asin}`);
    return book[k];
  });
}

async function resolveBook(asin, offline) {
  if (offline) {
    const meta = offline[asin];
    if (!meta) throw new Error(`--metadata has no entry for ${asin}`);
    return { asin, ...meta };
  }
  const res = await fetch(`${AUDNEXUS}/${asin}`, { headers: { 'User-Agent': 'rmab-e2e-fixtures' } });
  if (!res.ok) throw new Error(`Audnexus ${asin}: HTTP ${res.status}`);
  const j = await res.json();
  return {
    asin,
    title: j.title,
    author: (j.authors || []).map((a) => a.name).join(', '),
    narrator: (j.narrators || []).map((n) => n.name).join(', '),
    runtimeMin: j.runtimeLengthMin ?? null,
  };
}

function ffmpeg(bin, args) {
  execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function tone(i) {
  return `sine=frequency=${220 + 110 * i}:sample_rate=22050`;
}

function genMp3Multi(bin, dir, def, book) {
  const files = [];
  for (let n = 1; n <= def.tracks; n++) {
    const file = `${String(n).padStart(2, '0')} - Chapter ${n}.mp3`;
    ffmpeg(bin, [
      '-f', 'lavfi', '-i', `${tone(n)}:duration=${def.seconds}`,
      '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', '-id3v2_version', '3',
      '-metadata', `title=Chapter ${n}`,
      '-metadata', `album=${book.title}`,
      '-metadata', `album_artist=${book.author}`,
      '-metadata', `artist=${book.author}`,
      '-metadata', `composer=${book.narrator}`,
      '-metadata', `track=${n}/${def.tracks}`,
      '-metadata', 'genre=Audiobook',
      path.join(dir, file),
    ]);
    files.push(file);
  }
  return files;
}

function genM4bChapters(bin, dir, def, book) {
  const file = `${safeName(book.title)}.m4b`;
  const chapterMs = def.seconds * 1000;
  const meta = [';FFMETADATA1', `title=${book.title}`, `album=${book.title}`, `artist=${book.author}`, `album_artist=${book.author}`, `composer=${book.narrator}`, 'genre=Audiobook'];
  for (let c = 0; c < def.chapters; c++) {
    meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${c * chapterMs}`, `END=${(c + 1) * chapterMs}`, `title=Chapter ${c + 1}`);
  }
  const metaFile = path.join(dir, '.chapters.txt');
  fs.writeFileSync(metaFile, `${meta.join('\n')}\n`);
  ffmpeg(bin, [
    '-f', 'lavfi', '-i', `${tone(1)}:duration=${def.seconds * def.chapters}`,
    '-i', metaFile, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1',
    '-ac', '1', '-c:a', 'aac', '-b:a', '32k', '-f', 'ipod', path.join(dir, file),
  ]);
  fs.rmSync(metaFile);
  return [file];
}

function genWrong(dir) {
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'Not an audiobook. fake-arr wrong-files fixture.\n');
  fs.writeFileSync(path.join(dir, 'sample.nfo'), 'Release notes for a fixture that contains no audio.\n');
  return ['readme.txt', 'sample.nfo'];
}

export async function generate({ out, manifest, metadata, ffmpeg: bin }) {
  const spec = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const offline = metadata ? JSON.parse(fs.readFileSync(metadata, 'utf8')) : null;
  const books = {};
  for (const [key, b] of Object.entries(spec.books)) books[key] = await resolveBook(b.asin, offline);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const fixtures = {};
  for (const [id, def] of Object.entries(spec.fixtures)) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`fixture id must be [a-z0-9-]+: ${id}`);
    const book = def.book ? books[def.book] : null;
    if (def.book && !book) throw new Error(`fixture ${id}: unknown book ${def.book}`);
    const dir = path.join(out, id);
    fs.mkdirSync(dir, { recursive: true });
    let files;
    if (def.kind === 'mp3-multi') files = genMp3Multi(bin, dir, def, book);
    else if (def.kind === 'm4b-chapters') files = genM4bChapters(bin, dir, def, book);
    else if (def.kind === 'wrong') files = genWrong(dir);
    else throw new Error(`fixture ${id}: unknown kind ${def.kind}`);
    fixtures[id] = {
      book: def.book || null,
      kind: def.kind,
      folder: safeName(book ? fillTemplate(def.folder, book) : def.folder),
      files: files.map((rel) => ({ rel, size: fs.statSync(path.join(dir, rel)).size })),
    };
  }
  const index = { generatedAt: new Date().toISOString(), books, fixtures };
  fs.writeFileSync(path.join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = await generate(parseArgs(process.argv.slice(2)));
    const total = Object.values(index.fixtures).flatMap((f) => f.files).reduce((s, f) => s + f.size, 0);
    console.log(`[fixtures] ${Object.keys(index.fixtures).length} fixtures, ${(total / 1024).toFixed(0)} KiB`);
  } catch (error) {
    console.error(`[fixtures] ${error.message}`);
    process.exit(1);
  }
}
