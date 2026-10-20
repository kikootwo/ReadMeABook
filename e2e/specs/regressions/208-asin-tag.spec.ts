/**
 * Component: E2E regression #208 (the ASIN reaches the .m4b, and Audiobookshelf reads it)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * ffmpeg's mp4 muxer drops `----:com.apple.iTunes:ASIN`, so on main no m4b RMAB writes carries
 * the ASIN and Audiobookshelf's file tag `tagASIN` stays empty (the default `{title} {asin}`
 * folder has no `[ASIN]` brackets either). Three real import paths, each ending in a real
 * Audiobookshelf scan (each sets both settings and restores them; the organizer's one ASIN step
 * writes the ASIN to the file it places):
 *   1. single chaptered m4b, chapter merging off, tagging on (on the tagged copy)
 *   2. multi-file mp3, chapter merging on, tagging off (on the merged file)
 *   3. multi-file mp3, chapter merging on, tagging on (on the tagged copy of the merge)
 * Each also checks the placed file is moov first (faststart) through Audiobookshelf's container.
 * Requests all three fixture books (phm too, like smoke): run with --isolate-specs next to other specs.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, stackExecSync, waitFor, writeEvidence, Rmab, type Book } from '../../lib/harness';
import { psql, setConfig, sqlStr } from './library-delete-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

type Settings = Partial<Record<'chapter_merging_enabled' | 'metadata_tagging_enabled', 'true' | 'false'>>;

/** The stored value, or null when the row is absent (a fresh stack has no chapter_merging_enabled row). */
function getConfig(key: string): string | null {
  return psql(`select count(*) from configuration where key = ${sqlStr(key)}`) === '0'
    ? null
    : psql(`select value from configuration where key = ${sqlStr(key)}`);
}

/** Run `fn` with these settings (each test states all it relies on), then restore what was there (or no row). */
async function withSettings<T>(settings: Settings, fn: () => Promise<T>): Promise<T> {
  const saved = Object.keys(settings).map((key) => [key, getConfig(key)] as const);
  try {
    for (const [key, value] of Object.entries(settings)) {
      setConfig(key, value as string);
      if (getConfig(key) !== value) throw new Error(`setting ${key} was not stored`);
    }
    return await fn();
  } finally {
    for (const [key, value] of saved) setConfig(key, value);
  }
}

/** Top-level MP4 box types of a file inside the Audiobookshelf container. */
function topLevelTypes(file: string): string[] {
  const script = [
    "const fs = require('fs'); const fd = fs.openSync(process.argv[1], 'r'); const size = fs.fstatSync(fd).size;",
    'const types = []; let pos = 0; const h = Buffer.alloc(16);',
    'while (pos + 8 <= size && types.length < 20) { fs.readSync(fd, h, 0, 16, pos); let s = h.readUInt32BE(0);',
    "  if (s === 1) s = Number(h.readBigUInt64BE(8)); if (s === 0) s = size - pos; types.push(h.toString('latin1', 4, 8)); pos += s; }",
    'console.log(types.join(","));',
  ].join('\n');
  return stackExecSync('abs', ['node', '-e', script, file]).trim().split(',');
}

async function importAndScan(scenario: string, bookKey: string, label: string) {
  await fakeArr.scenario(scenario);
  const book: Book = (await fakeArr.books())[bookKey];
  const rmab = await Rmab.loginAdmin();
  const created = await rmab.requestBook(book);
  const requestId = created.request.id;
  const status = () => psql(`select status from requests where id = '${requestId}'`);
  await waitFor(`${label}: request downloaded/available`, async () => (['downloaded', 'available'].includes(status()) ? true : null), {
    timeoutMs: 300_000,
    intervalMs: 3_000,
  });

  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  const summary = await waitFor(
    `${label}: ABS library item`,
    async () => {
      await abs.req('POST', `/api/libraries/${libraryId}/scan`).catch(() => undefined);
      return (await abs.libraryItems(libraryId)).find((i) => i.media?.metadata?.title === book.title) || null;
    },
    { timeoutMs: 180_000, intervalMs: 5_000 }
  );
  const item = await abs.req('GET', `/api/items/${summary.id}?expanded=1`);
  const audio = item.media.audioFiles;
  const evidence = {
    requestId,
    status: status(),
    path: item.path,
    numAudioFiles: audio.length,
    metaTags: audio[0]?.metaTags,
    bookAsin: item.media.metadata.asin,
    chapters: item.media.chapters?.length,
    embeddedCoverArt: audio[0]?.embeddedCoverArt ?? null,
    layout: audio[0] ? topLevelTypes(audio[0].metadata.path) : [],
  };
  writeEvidence(`208/${scenario}.json`, evidence);
  return { book, evidence };
}

function expectAsinInFile(book: Book, e: Awaited<ReturnType<typeof importAndScan>>['evidence'], chapters: number) {
  expect(e.numAudioFiles, 'one m4b in the library').toBe(1);
  expect(e.metaTags?.tagASIN, 'Audiobookshelf reads the ASIN from the file').toBe(book.asin);
  expect(e.bookAsin).toBe(book.asin);
  expect(e.metaTags?.tagTitle).toBe(book.title);
  expect(e.chapters).toBe(chapters);
  expect(e.layout.slice(0, 2), 'moov first (faststart)').toEqual(['ftyp', 'moov']);
}

test('#208: single m4b, tagging on: the tagged m4b carries the ASIN', async () => {
  await withSettings({ chapter_merging_enabled: 'false', metadata_tagging_enabled: 'true' }, async () => {
    const { book, evidence } = await importAndScan('asin-m4b', 'martian', 'single m4b');
    expectAsinInFile(book, evidence, 2);
  });
});

test('#208: chapter merge, tagging off: the merged m4b carries the ASIN', async () => {
  await withSettings({ chapter_merging_enabled: 'true', metadata_tagging_enabled: 'false' }, async () => {
    const { book, evidence } = await importAndScan('asin-merge', 'artemis', 'merge, tagging off');
    expectAsinInFile(book, evidence, 3);
  });
});

test('#208: chapter merge, tagging on: the merged and tagged m4b carries the ASIN', async () => {
  await withSettings({ chapter_merging_enabled: 'true', metadata_tagging_enabled: 'true' }, async () => {
    const { book, evidence } = await importAndScan('asin-merge-tagged', 'phm', 'merge, tagging on');
    expectAsinInFile(book, evidence, 3);
  });
});
