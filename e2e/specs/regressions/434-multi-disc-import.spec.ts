/**
 * Component: E2E regression #434 (multi-disc books import whole, disc by disc)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * A book folder whose audio sits in 2+ disc folders (`Disc 1/`, `CD2/`, ...) and none directly
 * inside. Run with `--offline-fixtures --overrides abs-fake-metadata` so no RMAB lookup reaches a
 * real metadata provider; books are fake ASINs seeded in the database.
 *   A  Manual Import UI (details modal on /requests, tagging on, merge off): the folder is selectable,
 *      the footer counts 2 discs, the UI sends `Disc 1/01.m4a`..., 7 files with mixed and chapter-title
 *      names land flat (`Disc 1-01.m4a`, `Kingdoms Fall.m4a`...), `Extras/bonus.m4a` stays out; each file
 *      carries disc d/2 and track n/7, and Audiobookshelf's audioFiles (by index) run disc then track.
 *      On main there is no footer/button; the same body gets a 400.
 *   A2 Control, tagging off, same layout through the API: Audiobookshelf orders the names alone.
 *   B  Manual Import API without selectedFiles, merge on: chapters (identified by their unique
 *      durations) run Intro, Disc 1 01-03, Disc 2 01-03.
 *   C  Bulk Import scan + execute (the wizard's body): untagged CD1/ + CD2/ fold into one entry with
 *      4 files; one success, no "Already being processed", 4 files in the library.
 *   D  Guards: a single-folder book keeps its names and filesHash; `Extras/..`, `../`, `Disc 1/../` are 400.
 * B-D run with tagging off.
 * The details response for the fake ASIN is answered in the browser (page.route): it is metadata only.
 * The scan's Audible match is null offline; execute sends the seeded ASIN as the matched one.
 * Every value is recorded first (expect.soft + 434/<test>.json) so a run on main shows each miss.
 */

import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, Abs, Rmab } from '../../lib/harness';
import { absItemFor } from './library-delete-helpers';
import {
  ROOT, AUTHOR, ALL_OFF, genTracks, probeDurations, seedBook, failedRequest, withSettings, libraryFolder, libraryFiles,
  chaptersOf, labelByDuration, manualImportApi, organizeJobs, bulkScan, waitRequestsSettled, saveJson, cleanup,
  markJobs, waitOrganized, eventsSince, fmtEvents, bookRow, psql, sqlStr, sh, q, type Track,
} from './434-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });
test.use({ storageState: evidencePath('storage-state.json') });

const ASIN = { A: 'B0E2E434A1', A2: 'B0E2E434A2', B: 'B0E2E434B1', C: 'B0E2E434C1', D: 'B0E2E434D1', E: 'B0E2E434E1' };
const sorted = (xs: string[]) => [...xs].sort();

/** Book A's layout: mixed and chapter-title names that do not sort in play order once flattened. */
const A_TRACKS: Track[] = [
  { rel: 'Disc 1/01.m4a', seconds: 2.0 }, { rel: 'Disc 1/Kingdoms Fall.m4a', seconds: 2.3 }, { rel: 'Disc 1/The Storm.m4a', seconds: 2.6 },
  { rel: 'Disc 2/01.m4a', seconds: 2.9 }, { rel: 'Disc 2/Crowns.m4a', seconds: 3.2 }, { rel: 'Disc 2/Epilogue.m4a', seconds: 3.5 },
  { rel: 'Disc 2/Exile.m4a', seconds: 3.8 }, { rel: 'Extras/bonus.m4a', seconds: 4.1 },
];
/** Import order (discs by number, natural order inside) and the flat names in the library. */
const A_BOOK_FILES = A_TRACKS.filter((t) => !t.rel.startsWith('Extras/')).map((t) => t.rel);
const A_NAMES = ['Disc 1-01.m4a', 'Kingdoms Fall.m4a', 'The Storm.m4a', 'Disc 2-01.m4a', 'Crowns.m4a', 'Epilogue.m4a', 'Exile.m4a'];

/** Audiobookshelf's audio files for a library folder, by index, with the disc/track it read. */
async function absOrder(folder: string): Promise<Record<string, any>> {
  try {
    const id = await absItemFor(folder);
    const item = await (await Abs.login()).req('GET', `/api/items/${id}?expanded=1`);
    const files = [...(item.media?.audioFiles || [])].sort((a: any, b: any) => a.index - b.index);
    return {
      audioFiles: files.map((f: any) => ({ index: f.index, filename: f.metadata?.filename, track: f.trackNumFromMeta ?? null, disc: f.discNumFromMeta ?? null })),
      order: files.map((f: any) => f.metadata?.filename),
    };
  } catch (error) {
    return { error: String(error) };
  }
}

/** The disc and track tags ffprobe reads from each placed file. */
function placedTags(folder: string, names: string[]): Record<string, { track: string | null; disc: string | null }> {
  return Object.fromEntries(names.map((name) => {
    const tags = JSON.parse(sh(`ffprobe -v error -show_entries format_tags=track,disc -of json ${q(`${folder}/${name}`)}`) || '{}').format?.tags ?? {};
    return [name, { track: tags.track ?? null, disc: tags.disc ?? null }];
  }));
}

test.afterAll(() => {
  const errors = cleanup(Object.values(ASIN));
  saveJson('cleanup', { errors });
});

test('434 A: Manual Import UI imports a multi-disc folder; disc/track tags give Audiobookshelf the order', async ({ page }) => {
  const title = 'E2E Multi Disc A';
  const src = `${ROOT}/Book A [${ASIN.A}]`;
  const bookFiles = A_BOOK_FILES;
  const expectedNames = A_NAMES;
  genTracks(src, A_TRACKS);
  const bookId = seedBook(ASIN.A, title);
  failedRequest(bookId);
  const obs: Record<string, any> = { src, sources: probeDurations(src) };
  const rmab = await Rmab.loginAdmin();

  await withSettings({ ...ALL_OFF, metadata_tagging_enabled: 'true' }, async () => {
    const browse = await rmab.raw('GET', `/api/admin/filesystem/browse?path=${encodeURIComponent(src)}`);
    const b = await browse.json().catch(() => ({}));
    obs.browseApi = { status: browse.status, entries: (b.entries || []).map((e: any) => e.name), audioFiles: (b.audioFiles || []).map((f: any) => f.name) };

    await page.route(`**/api/audiobooks/${ASIN.A}`, (route) =>
      route.fulfill({ json: { success: true, audibleBaseUrl: 'https://www.audible.com', audiobook: { asin: ASIN.A, title, author: AUTHOR, narrator: 'E2E Narrator', description: 'Generated test book.', coverArtUrl: '', durationMinutes: 1, genres: [] } } })
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/requests');
    await page.locator('div.shadow-md', { hasText: title }).first().locator('[role="button"]').first().click();
    await page.getByTitle('Manual Import').click();
    await page.getByRole('button', { name: /\/downloads/ }).first().click();
    for (const seg of src.split('/').slice(2)) await page.getByRole('button', { name: seg, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Disc 1', exact: true })).toBeVisible();
    await page.waitForTimeout(800);
    const select = page.getByRole('button', { name: /Select This Folder/ });
    const footer = page.locator('p', { hasText: /audio files? in / });
    obs.ui = { selectButtonVisible: await select.isVisible(), footerText: (await footer.count()) ? (await footer.first().innerText()).trim() : null };
    await snap(page, '434', 'A-browse-book-folder');
    expect.soft(obs.ui.selectButtonVisible, '"Select This Folder" shown for the multi-disc folder').toBe(true);
    expect.soft(obs.ui.footerText, 'footer counts the discs').toMatch(/^7 audio files in 2 discs( ·|$)/);

    const mark = markJobs();
    if (obs.ui.selectButtonVisible) {
      await select.click();
      await expect(page.getByRole('button', { name: 'Start Import' })).toBeVisible();
      await snap(page, '434', 'A-confirm');
      const reqP = page.waitForRequest((r) => r.url().endsWith('/api/admin/manual-import') && r.method() === 'POST');
      const resP = page.waitForResponse((r) => r.url().endsWith('/api/admin/manual-import'));
      await page.getByRole('button', { name: 'Start Import' }).click();
      const [req, res] = await Promise.all([reqP, resP]);
      obs.sent = req.postDataJSON();
      obs.response = { status: res.status(), body: await res.json().catch(() => ({})) };
      if (res.ok()) await waitOrganized(mark, obs.response.body.requestId).catch((e) => (obs.organizeError = String(e)));
    } else {
      // What the fixed UI sends, straight to the API (main: no button to click)
      obs.sent = { asin: ASIN.A, folderPath: src, selectedFiles: bookFiles, cleanupSource: false, via: 'api (no UI button)' };
      const r = await manualImportApi(rmab, { asin: ASIN.A, folderPath: src, selectedFiles: bookFiles, cleanupSource: false }, mark);
      obs.response = { status: r.status, body: r.body };
      if (r.organizeError) obs.organizeError = r.organizeError;
    }
    obs.organizeJobs = organizeJobs(mark).map((j) => ({ status: j.status, selectedFiles: j.payload?.selectedFiles ?? null }));
    obs.events = fmtEvents(eventsSince(mark)).split('\n').filter((l) => /disc|Disc|selected|audio files|error|Error/.test(l));
    expect.soft(obs.sent?.selectedFiles, 'UI sends the disc files as relative names').toEqual(bookFiles);
    expect.soft(obs.response?.status, 'manual import accepted').toBe(200);

    obs.libraryFolder = libraryFolder(ASIN.A);
    obs.libraryFiles = libraryFiles(obs.libraryFolder);
    expect.soft(sorted(obs.libraryFiles), 'all 7 book files, duplicate names prefixed with their disc').toEqual(sorted(expectedNames));
    expect.soft(obs.libraryFiles.some((f: string) => f.includes('bonus')), 'Extras/bonus.m4a not imported').toBe(false);

    if (obs.libraryFolder) {
      const present = expectedNames.filter((n) => obs.libraryFiles.includes(n));
      obs.placedTags = placedTags(obs.libraryFolder, present);
      expect.soft(obs.placedTags, 'each file carries its disc (d/2) and its track across the book (n/7)').toEqual(
        Object.fromEntries(expectedNames.map((n, i) => [n, { track: `${i + 1}/7`, disc: i < 3 ? '1/2' : '2/2' }]))
      );
      obs.abs = await absOrder(obs.libraryFolder);
      expect.soft(obs.abs.order, "Audiobookshelf's audioFiles by index run disc then track").toEqual(expectedNames);
    }
  });
  saveJson('A-manual-import-ui', obs);
});

test('434 A2: control, tagging off: Audiobookshelf orders the same flat names by name alone', async () => {
  const src = `${ROOT}/Book A2 [${ASIN.A2}]`;
  genTracks(src, A_TRACKS);
  const bookId = seedBook(ASIN.A2, 'E2E Multi Disc A2');
  const obs: Record<string, any> = { src };
  const rmab = await Rmab.loginAdmin();
  await withSettings(ALL_OFF, async () => {
    const r = await manualImportApi(rmab, { audiobookId: bookId, folderPath: src, selectedFiles: A_BOOK_FILES, cleanupSource: false });
    obs.response = { status: r.status, body: r.body, organizeError: r.organizeError };
  });
  obs.libraryFolder = libraryFolder(ASIN.A2);
  obs.libraryFiles = libraryFiles(obs.libraryFolder);
  expect.soft(sorted(obs.libraryFiles), 'same 7 flat names as A').toEqual(sorted(A_NAMES));
  if (obs.libraryFolder) {
    obs.placedTags = placedTags(obs.libraryFolder, A_NAMES.filter((n) => obs.libraryFiles.includes(n)));
    obs.abs = await absOrder(obs.libraryFolder);
    obs.absOrderMatchesImport = JSON.stringify(obs.abs.order) === JSON.stringify(A_NAMES);
  }
  expect.soft(sorted(obs.abs?.order ?? []), 'the Audiobookshelf order was read, all 7 files').toEqual(sorted(A_NAMES));
  expect.soft(obs.absOrderMatchesImport, 'without the tags the names alone do not give the import order').toBe(false);
  saveJson('A2-control-tagging-off', obs);
});

test('434 B: merged m4b chapters run root file, Disc 1, Disc 2', async () => {
  const src = `${ROOT}/Book B [${ASIN.B}]`;
  const tracks: Track[] = [
    { rel: '00 Intro.m4a', seconds: 2.0 },
    { rel: 'Disc 1/01.m4a', seconds: 2.3 }, { rel: 'Disc 1/02.m4a', seconds: 2.6 }, { rel: 'Disc 1/03.m4a', seconds: 2.9 },
    { rel: 'Disc 2/01.m4a', seconds: 3.2 }, { rel: 'Disc 2/02.m4a', seconds: 3.5 }, { rel: 'Disc 2/03.m4a', seconds: 3.8 },
  ];
  genTracks(src, tracks);
  const bookId = seedBook(ASIN.B, 'E2E Multi Disc B');
  const obs: Record<string, any> = { src, sources: probeDurations(src) };
  const rmab = await Rmab.loginAdmin();
  await withSettings({ ...ALL_OFF, chapter_merging_enabled: 'true' }, async () => {
    const mark = markJobs();
    const r = await manualImportApi(rmab, { audiobookId: bookId, folderPath: src, cleanupSource: false }, mark);
    obs.response = { status: r.status, body: r.body, organizeError: r.organizeError };
    obs.events = fmtEvents(eventsSince(mark)).split('\n').filter((l) => /order|chapter|Chapter|Multi-disc|merge|Merge/.test(l));
  });
  expect.soft(obs.response.status, 'manual import accepted').toBe(200);
  obs.libraryFolder = libraryFolder(ASIN.B);
  obs.libraryFiles = libraryFiles(obs.libraryFolder);
  const m4b = obs.libraryFiles.filter((f: string) => f.endsWith('.m4b'));
  expect.soft(m4b.length, 'one merged m4b').toBe(1);
  if (m4b.length === 1) {
    obs.chapters = chaptersOf(`${obs.libraryFolder}/${m4b[0]}`);
    obs.chapterOrder = labelByDuration(obs.chapters, obs.sources);
  }
  expect.soft(obs.chapterOrder, 'chapters in disc-then-track order (by unique duration)').toEqual(tracks.map((t) => t.rel));
  saveJson('B-merge-order', obs);
});

test('434 C: Bulk Import folds untagged CD1/CD2 into one book and imports it once', async () => {
  const scanRoot = `${ROOT}/bulk`;
  const bookDir = `${scanRoot}/Book C [${ASIN.C}]`;
  const tracks: Track[] = [
    { rel: 'CD1/01.m4a', seconds: 2.0 }, { rel: 'CD1/02.m4a', seconds: 2.3 },
    { rel: 'CD2/01.m4a', seconds: 2.6 }, { rel: 'CD2/02.m4a', seconds: 2.9 },
  ];
  genTracks(bookDir, tracks);
  seedBook(ASIN.C, 'E2E Multi Disc C');
  const obs: Record<string, any> = { scanRoot, bookDir };
  const rmab = await Rmab.loginAdmin();
  await withSettings(ALL_OFF, async () => {
    const scan = await bulkScan(rmab, scanRoot);
    const entries = scan.events.filter((e) => e.event === 'book_matched').map((e) => e.data);
    obs.scan = {
      status: scan.status,
      eventTypes: scan.events.map((e) => e.event),
      entries: entries.map((b: any) => ({ folderPath: b.folderPath, audioFiles: b.audioFiles, audioFileCount: b.audioFileCount, extractedAsin: b.extractedAsin, searchTerm: b.searchTerm, match: b.match?.asin ?? null })),
    };
    expect.soft(entries.length, 'one scan entry for the book').toBe(1);
    expect.soft(entries[0]?.folderPath, 'entry is the book folder').toBe(bookDir);
    expect.soft(sorted(entries[0]?.audioFiles || []), 'entry lists all 4 disc files').toEqual(tracks.map((t) => t.rel));

    // The wizard's body (BulkImportWizard handleStartImport), with the seeded ASIN as the matched one
    const imports = entries.map((b: any) => ({ folderPath: b.folderPath, asin: ASIN.C, audioFiles: b.audioFiles }));
    obs.executeBody = { imports };
    const mark = markJobs();
    const res = await rmab.raw('POST', '/api/admin/bulk-import/execute', { imports });
    const body = await res.json().catch(() => ({}));
    const results: any[] = body.results || [];
    obs.execute = { status: res.status, body };
    const ok = results.filter((x) => x.success);
    expect.soft(res.status, 'execute answered 200').toBe(200);
    expect.soft(ok.length, 'one successful import').toBe(1);
    expect.soft(results.map((x) => x.error).filter(Boolean), 'no "Already being processed"').toEqual([]);
    if (ok.length) {
      obs.settled = await waitRequestsSettled(mark, ok.map((x) => x.requestId)).catch((e) => String(e));
      obs.organizeJobs = organizeJobs(mark).map((j) => ({ status: j.status, selectedFiles: j.payload?.selectedFiles ?? null }));
    }
  });
  obs.libraryFolder = libraryFolder(ASIN.C);
  obs.libraryFiles = libraryFiles(obs.libraryFolder);
  expect.soft(obs.libraryFiles.filter((f: string) => f.endsWith('.m4a')).length, 'all 4 files in the library').toBe(4);
  saveJson('C-bulk-import', obs);
});

test('434 D: single-folder book unchanged; selectedFiles outside the disc set refused', async () => {
  const rmab = await Rmab.loginAdmin();
  const obs: Record<string, any> = {};

  // D1: plain single-folder book (as the UI sends it: file names)
  const srcD = `${ROOT}/Book D [${ASIN.D}]`;
  genTracks(srcD, [{ rel: '01.m4a', seconds: 2.0 }, { rel: '02.m4a', seconds: 2.3 }, { rel: '03.m4a', seconds: 2.6 }]);
  const bookD = seedBook(ASIN.D, 'E2E Single Folder D');
  await withSettings(ALL_OFF, async () => {
    const r = await manualImportApi(rmab, { audiobookId: bookD, folderPath: srcD, selectedFiles: ['01.m4a', '02.m4a', '03.m4a'], cleanupSource: false });
    obs.d1 = { status: r.status, body: r.body, organizeError: r.organizeError };
  });
  obs.d1.libraryFolder = libraryFolder(ASIN.D);
  obs.d1.libraryFiles = libraryFiles(obs.d1.libraryFolder);
  obs.d1.filesHash = bookRow(bookD).filesHash;
  obs.d1.expectedFilesHash = crypto.createHash('sha256').update(JSON.stringify(['01.m4a', '02.m4a', '03.m4a'])).digest('hex');
  expect.soft(obs.d1.status, 'D1 import accepted').toBe(200);
  expect.soft(obs.d1.libraryFiles, 'D1 names kept').toEqual(['01.m4a', '02.m4a', '03.m4a']);
  expect.soft(obs.d1.filesHash, 'D1 filesHash = sha256 of the sorted basenames').toBe(obs.d1.expectedFilesHash);

  // D2: refused selections on a multi-disc folder with Extras/
  const srcE = `${ROOT}/Book E [${ASIN.E}]`;
  genTracks(srcE, [
    { rel: 'Disc 1/01.m4a', seconds: 2.0 }, { rel: 'Disc 1/02.m4a', seconds: 2.3 }, { rel: 'Disc 1/03.m4a', seconds: 2.6 },
    { rel: 'Disc 2/01.m4a', seconds: 2.9 }, { rel: 'Disc 2/02.m4a', seconds: 3.2 }, { rel: 'Disc 2/03.m4a', seconds: 3.5 },
    { rel: 'Extras/bonus.m4a', seconds: 3.8 },
  ]);
  const bookE = seedBook(ASIN.E, 'E2E Guard E');
  obs.d2 = {};
  for (const sel of [['Extras/bonus.m4a'], ['../x.m4a'], ['Disc 1/../Disc 2/01.m4a']]) {
    const res = await rmab.raw('POST', '/api/admin/manual-import', { audiobookId: bookE, folderPath: srcE, selectedFiles: sel, cleanupSource: false });
    obs.d2[sel[0]] = { status: res.status, body: await res.json().catch(() => ({})) };
    expect.soft(res.status, `selectedFiles ${JSON.stringify(sel)} refused`).toBe(400);
  }
  obs.d2.requestsForBookE = Number(psql(`select count(*) from requests where audiobook_id = ${sqlStr(bookE)}`));
  expect.soft(obs.d2.requestsForBookE, 'no request created by a refused selection').toBe(0);
  saveJson('D-guards', obs);
});
