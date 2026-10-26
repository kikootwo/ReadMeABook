/**
 * Component: E2E regression #434 (multi-disc books import whole, disc by disc)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * A book folder whose audio sits in 2+ disc folders (`Disc 1/`, `CD2/`, ...) and none directly
 * inside. Tagging off in every test. Run with `--offline-fixtures --overrides abs-fake-metadata`
 * so no RMAB lookup reaches a real metadata provider; books are fake ASINs seeded in the database.
 *   A  Manual Import UI (details modal on /requests, merge off): the folder is selectable, the footer
 *      counts 2 discs, the UI sends `Disc 1/01.m4a`..., 7 files land as `Disc 1-01.m4a`.., `04 Epilogue.m4a`,
 *      `Extras/bonus.m4a` stays out. On main there is no footer/button; the same body gets a 400.
 *   B  Manual Import API without selectedFiles, merge on: chapters (identified by their unique
 *      durations) run Intro, Disc 1 01-03, Disc 2 01-03.
 *   C  Bulk Import scan + execute (the wizard's body): untagged CD1/ + CD2/ fold into one entry with
 *      4 files; one success, no "Already being processed", 4 files in the library.
 *   D  Guards: a single-folder book keeps its names and filesHash; `Extras/..`, `../`, `Disc 1/../` are 400.
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
  markJobs, waitOrganized, eventsSince, fmtEvents, bookRow, psql, sqlStr, type Track,
} from './434-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });
test.use({ storageState: evidencePath('storage-state.json') });

const ASIN = { A: 'B0E2E434A1', B: 'B0E2E434B1', C: 'B0E2E434C1', D: 'B0E2E434D1', E: 'B0E2E434E1' };
const sorted = (xs: string[]) => [...xs].sort();

test.afterAll(() => {
  const errors = cleanup(Object.values(ASIN));
  saveJson('cleanup', { errors });
});

test('434 A: Manual Import UI selects a multi-disc folder and imports it disc by disc', async ({ page }) => {
  const title = 'E2E Multi Disc A';
  const src = `${ROOT}/Book A [${ASIN.A}]`;
  const tracks: Track[] = [
    { rel: 'Disc 1/01.m4a', seconds: 2.0 }, { rel: 'Disc 1/02.m4a', seconds: 2.3 }, { rel: 'Disc 1/03.m4a', seconds: 2.6 },
    { rel: 'Disc 2/01.m4a', seconds: 2.9 }, { rel: 'Disc 2/02.m4a', seconds: 3.2 }, { rel: 'Disc 2/03.m4a', seconds: 3.5 },
    { rel: 'Disc 2/04 Epilogue.m4a', seconds: 3.8 }, { rel: 'Extras/bonus.m4a', seconds: 4.1 },
  ];
  const bookFiles = tracks.filter((t) => !t.rel.startsWith('Extras/')).map((t) => t.rel);
  const expectedNames = ['Disc 1-01.m4a', 'Disc 1-02.m4a', 'Disc 1-03.m4a', 'Disc 2-01.m4a', 'Disc 2-02.m4a', 'Disc 2-03.m4a', '04 Epilogue.m4a'];
  genTracks(src, tracks);
  const bookId = seedBook(ASIN.A, title);
  failedRequest(bookId);
  const obs: Record<string, any> = { src, sources: probeDurations(src) };
  const rmab = await Rmab.loginAdmin();

  await withSettings(ALL_OFF, async () => {
    const browse = await rmab.raw('GET', `/api/admin/filesystem/browse?path=${encodeURIComponent(src)}`);
    const b = await browse.json().catch(() => ({}));
    obs.browseApi = { status: browse.status, entries: (b.entries || []).map((e: any) => e.name), audioFiles: (b.audioFiles || []).map((f: any) => f.name), discCount: b.discCount ?? null };

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

    // Informational: Audiobookshelf's track order (index) for the imported folder
    if (obs.libraryFolder) {
      try {
        const id = await absItemFor(obs.libraryFolder);
        const item = await (await Abs.login()).req('GET', `/api/items/${id}?expanded=1`);
        obs.absAudioFiles = (item.media?.audioFiles || []).map((f: any) => ({ index: f.index, filename: f.metadata?.filename, track: f.trackNumFromMeta ?? null }));
        obs.absOrderMatchesImport = JSON.stringify(obs.absAudioFiles.map((f: any) => f.filename)) === JSON.stringify(expectedNames);
      } catch (error) {
        obs.absError = String(error);
      }
    }
  });
  saveJson('A-manual-import-ui', obs);
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
