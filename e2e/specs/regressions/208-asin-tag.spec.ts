/**
 * Component: E2E regression #208 (the ASIN reaches the .m4b, and Audiobookshelf reads it)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * ffmpeg's mp4 muxer drops `----:com.apple.iTunes:ASIN`, so on main no m4b RMAB writes carries
 * the ASIN and Audiobookshelf's file tag `tagASIN` stays empty (the default `{title} {asin}`
 * folder has no `[ASIN]` brackets either). Three real import paths, each ending in a real
 * Audiobookshelf scan:
 *   1. single chaptered m4b, metadata tagging on (the tagger writes the ASIN)
 *   2. multi-file mp3, chapter merging on, tagging off (the merger writes it)
 *   3. multi-file mp3, chapter merging on, tagging on (merge, then the tagger writes it)
 * Each also checks the placed file is moov first (faststart) through Audiobookshelf's container.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, stackExecSync, waitFor, writeEvidence, Rmab, type Book } from '../../lib/harness';
import { psql } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const setConfig = (key: string, value: string) =>
  psql(`update configuration set value = '${value}' where key = '${key}' returning value`);

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
  const { book, evidence } = await importAndScan('asin-m4b', 'martian', 'single m4b');
  expectAsinInFile(book, evidence, 2);
});

test('#208: chapter merge, tagging off: the merged m4b carries the ASIN', async () => {
  setConfig('chapter_merging_enabled', 'true');
  setConfig('metadata_tagging_enabled', 'false');
  try {
    const { book, evidence } = await importAndScan('asin-merge', 'artemis', 'merge, tagging off');
    expectAsinInFile(book, evidence, 2);
  } finally {
    setConfig('chapter_merging_enabled', 'false');
    setConfig('metadata_tagging_enabled', 'true');
  }
});

test('#208: chapter merge, tagging on: the merged and tagged m4b carries the ASIN', async () => {
  setConfig('chapter_merging_enabled', 'true');
  try {
    const { book, evidence } = await importAndScan('asin-merge-tagged', 'phm', 'merge, tagging on');
    expectAsinInFile(book, evidence, 3);
  } finally {
    setConfig('chapter_merging_enabled', 'false');
  }
});
