/**
 * Component: E2E regression #68 (File placement: hard link instead of copy; metadata.opf instead of tags)
 * Documentation: documentation/features/library-placement.md
 *
 * Audiobookshelf mode, real import path (fake Prowlarr + fake qBittorrent, real Audiobookshelf),
 * settings saved through the real admin PUT. Flags: --offline-fixtures --overrides abs-fake-metadata.
 * 0. Library files section only (the page's path-preview examples stay out of frame): the default view
 *    (Copy + Tags) and Hard link + OPF at 1280 light and 375 dark; Plex mode (backend switched for the
 *    shot) shows neither control; both stored-conflict messages.
 * 2. Stock layout (/downloads and /media are two mounts), Hard link: the whole book is copied, the request
 *    says why, and after it is `available` the Paths page shows "Last book copied instead of linked".
 * 3. Stock layout, Hard link only: nothing imported, request `warn` with the message, no blocklist row,
 *    download unchanged; Hard link (copy if not possible) + Retry imports it by copy.
 * 1. Shared mount (download_dir /media/downloads), Hard link + OPF: library file and download are one file
 *    (same dev/ino, link count 2), cover.jpg and metadata.opf on their own inodes.
 * 4. The real Audiobookshelf shows the OPF's title, both authors, narrator, series, ASIN and year for a
 *    file whose own tags name another book.
 * 5. The download keeps its bytes and stays listed by the client after import, after the seeded-torrent
 *    cleanup and after a request delete (the fake client has no recheck: "listed, bytes unchanged").
 * 6. Manual Import from the media folder (outside the download folders): Hard link copies it and says
 *    why, Hard link only imports nothing and says why. A failure on file 3 of 3 (an interrupted copy in
 *    the library) leaves no link behind in either mode. The book imported again from its own library
 *    folder imports in place under Hard link only, with no note.
 * The settings each leg changes are put back afterwards. Exec bridge required.
 */

import { test, expect, type Page } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, waitFor, writeEvidence, type Book } from '../../lib/harness';
import { asApp, MEDIA, psql, q, sh, sqlStr } from './242-helpers';
import { disableSchedules } from './284-helpers';
import {
  absBookPageShot, absItemFor, adminPage, blocklistRows, bookFolder, devOf, elementShot, fileId, filesUnder, generateTones, insertBook,
  loadRelease, manualImport, openPaths, regionShot, requestAndWait, requestMessage, requestStatus, savePaths, seedBook, SHARED_DOWNLOADS,
  STOCK_DOWNLOADS, torrentOf,
} from './68-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
// Ordered (one worker, in file order) but not serial: a failed leg doesn't hide the others' results
test.describe.configure({ timeout: 900_000 });

const AUTHORS = 'Test Author, Second Writer';
const OFF = { metadataTaggingEnabled: false, chapterMergingEnabled: false };
/** The page saves a changed Paths tab only after Test Paths passed (as an admin does). */
async function testThenSave(page: Page) {
  await page.getByRole('button', { name: 'Test Paths' }).click();
  await expect(page.getByText('All paths are valid and writable')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Save Settings' }).click();
}
let books: Record<string, Book>;
let rmab: Rmab;

/** Scan schedules a leg turned off; turned back on by that leg or, after a failure, by afterEach. */
const disabledSchedules: string[] = [];
async function reenableSchedules() {
  for (const id of disabledSchedules.splice(0)) await rmab.raw('PUT', `/api/admin/jobs/${id}`, { enabled: true });
}
test.afterEach(reenableSchedules);

/** The settings this spec changes, as found; put back after the last leg (later specs on one stack import as before). */
const RESTORE = ['downloadDir', 'filePlacement', 'metadataOpfEnabled', 'metadataTaggingEnabled', 'chapterMergingEnabled'] as const;
let original: Record<string, unknown> = {};

test.beforeAll(async () => {
  books = await fakeArr.books();
  expect(books.martian.title, 'run with --offline-fixtures (made-up fixture titles)').toMatch(/^Fixture Book /);
  rmab = await Rmab.loginAdmin();
  const { paths } = await rmab.get<{ paths: Record<string, unknown> }>('/api/admin/settings');
  original = Object.fromEntries(RESTORE.map((key) => [key, paths[key]]));
});

test.afterAll(async () => {
  const restored = await savePaths(rmab, original);
  writeEvidence('68/settings-restored.json', { original, restored });
  expect(restored.status, 'settings put back').toBe(200);
});

/** The Library files section alone (the page's path-preview examples are not in frame). */
const sectionShot = (page: Page, name: string) => elementShot(page, page.getByTestId('library-files-section'), name);

const VIEWS = [{ name: '1280-light', w: 1280, h: 900, dark: false }, { name: '375-dark', w: 375, h: 812, dark: true }];

test('0: the Paths page shows File placement and Metadata in Audiobookshelf mode only, and explains a stored conflict', async ({ browser }) => {
  for (const view of VIEWS) {
    // What an upgrading admin sees first: Copy + Tags (today's settings; the 1280 view saves a hard link below)
    expect((await savePaths(rmab, { filePlacement: 'copy', metadataTaggingEnabled: true, metadataOpfEnabled: false, chapterMergingEnabled: false })).status).toBe(200);
    const { ctx, page } = await adminPage(browser, view.w, view.h, view.dark);
    try {
      await openPaths(page);
      const section = page.getByTestId('library-files-section');
      await expect(section).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Copy', exact: true })).toBeChecked();
      await expect(page.getByRole('radio', { name: 'Hard link (copy if not possible)' })).toBeDisabled();
      await expect(section.getByText('Hard links need Metadata set to OPF file or None.')).toBeVisible();
      await sectionShot(page, `paths-default-${view.name}`);
      await page.getByRole('checkbox', { name: /Auto-merge chapters/ }).uncheck();
      await page.getByRole('radio', { name: 'OPF file (metadata.opf)' }).check();
      await page.getByRole('radio', { name: 'Hard link (copy if not possible)' }).check();
      await expect(page.getByRole('radio', { name: 'Tags in the audio files' })).toBeDisabled();
      await expect(page.getByRole('checkbox', { name: /Auto-merge chapters/ })).toBeDisabled();
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflowX, `${view.name}: no horizontal scroll`).toBeLessThanOrEqual(0);
      await expect(section.getByText(/Don't use Audiobookshelf's Embed Metadata on linked books/)).toBeVisible();
      await sectionShot(page, `paths-link-opf-${view.name}`);
      if (view.name === '1280-light') {
        const saved = page.waitForResponse((r) => r.url().endsWith('/api/admin/settings/paths') && r.request().method() === 'PUT');
        await testThenSave(page);
        expect((await saved).status(), 'saved through the page').toBe(200);
        expect(psql(`select value from configuration where key = 'audiobook_file_placement'`)).toBe('hardlink');
        expect(psql(`select value from configuration where key = 'metadata_opf_enabled'`)).toBe('true');
      }
    } finally {
      await ctx.close();
    }
  }

  // The API refuses what the page can't send (Audiobookshelf mode)
  const refusals = {
    tags: await savePaths(rmab, { filePlacement: 'hardlink', metadataTaggingEnabled: true, chapterMergingEnabled: false }),
    merge: await savePaths(rmab, { filePlacement: 'hardlink_only', metadataTaggingEnabled: false, chapterMergingEnabled: true }),
    symlink: await savePaths(rmab, { filePlacement: 'symlink' }),
  };
  writeEvidence('68/api-refusals.json', refusals);
  expect.soft(refusals.tags).toEqual({ status: 400, body: { error: 'Hard links need Metadata set to OPF file or None.' } });
  expect.soft(refusals.merge).toEqual({ status: 400, body: { error: 'Turn off chapter merge to use hard links.' } });
  expect.soft(refusals.symlink).toEqual({ status: 400, body: { error: 'File placement must be copy, hardlink or hardlink_only' } });

  // Audiobookshelf -> Plex (tick tagging and merge there) -> Audiobookshelf: the stored conflict is shown, Save is held
  // The config service caches a key for 60 s: wait it out after each switch, so the PUT and the
  // importer see the mode the page shows.
  const cacheTtl = () => new Promise((r) => setTimeout(r, 62_000));
  // Hard link + OPF stored (as the 1280 view saved it; the 375 view started from Copy + Tags)
  expect((await savePaths(rmab, { ...OFF, filePlacement: 'hardlink', metadataOpfEnabled: true })).status).toBe(200);
  const mode = psql(`select value from configuration where key = 'system.backend_mode'`);
  psql(`update configuration set value = 'plex' where key = 'system.backend_mode'`);
  await cacheTtl();
  try {
    // Plex mode: neither control; the tagging and merge checkboxes as before (framed from tagging to merge)
    for (const view of [...VIEWS].reverse()) {
      const { ctx, page } = await adminPage(browser, view.w, view.h, view.dark);
      try {
        await openPaths(page);
        await expect(page.getByTestId('library-files-section')).toHaveCount(0);
        await expect(page.getByRole('radio')).toHaveCount(0);
        // The innermost box holding the checkbox (the Paths card around them is rounded too)
        const block = (id: string) => page.locator('div.rounded-lg').filter({ has: page.locator(`#${id}`) }).last();
        await regionShot(page, block('metadata-tagging-settings'), block('chapter-merging-settings'), `paths-plex-${view.name}`);
      } finally {
        await ctx.close();
      }
    }
    const { ctx, page } = await adminPage(browser, 1280, 900, false);
    try {
      await openPaths(page);
      await expect(page.getByLabel(/Auto-tag audio files with metadata/)).toBeEnabled();
      await page.getByLabel(/Auto-tag audio files with metadata/).check();
      await page.getByRole('checkbox', { name: /Auto-merge chapters/ }).check();
      const saved = page.waitForResponse((r) => r.url().endsWith('/api/admin/settings/paths') && r.request().method() === 'PUT');
      await testThenSave(page);
      expect((await saved).status(), 'Plex mode never refuses').toBe(200);
    } finally {
      await ctx.close();
    }
  } finally {
    psql(`update configuration set value = ${sqlStr(mode)} where key = 'system.backend_mode'`);
    await cacheTtl();
  }
  const { ctx, page } = await adminPage(browser, 1280, 900, false);
  try {
    await openPaths(page);
    const section = page.getByTestId('library-files-section');
    await expect(page.getByRole('radio', { name: 'Hard link (copy if not possible)' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Tags in the audio files' })).toBeChecked();
    await expect(section.getByRole('alert')).toHaveText('Hard links need Metadata set to OPF file or None, and chapter merge off.');
    // Nothing changed yet, so Save is simply off; the red line is the explanation
    await expect(page.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
    await sectionShot(page, 'refusal-stored-conflict-tags');
    await page.getByRole('radio', { name: 'OPF file (metadata.opf)' }).check();
    await expect(section.getByRole('alert')).toHaveText('Turn off chapter merge to use hard links.');
    await expect(page.getByText('Turn off chapter merge to use hard links.').first()).toBeVisible();
    await sectionShot(page, 'refusal-stored-conflict-merge');
  } finally {
    await ctx.close();
  }
  expect((await savePaths(rmab, { ...OFF, filePlacement: 'hardlink', metadataOpfEnabled: true })).status).toBe(200);
});

test('2: separate mounts, Hard link: the book is copied, and the Paths page keeps saying so after it is available', async ({ browser }) => {
  expect((await savePaths(rmab, { ...OFF, downloadDir: STOCK_DOWNLOADS, filePlacement: 'hardlink', metadataOpfEnabled: true })).status).toBe(200);
  const book = books.artemis;
  await loadRelease('hardlink-exdev-68', 'artemis', 'artemis-mp3', '{{author}} - {{title}} (Unabridged) [MP3]');
  // Scan schedules off until the request row is shot: the match would make it available and clear its message
  await disableSchedules(rmab, disabledSchedules);
  const run = await requestAndWait(rmab, book, 'Test Author', ['downloaded', 'available']);
  expect(run.status, 'imported').toMatch(/downloaded|available/);
  const folder = bookFolder(run.requestId);
  const torrent = await torrentOf(run.requestId);
  const library = filesUnder(folder).filter((f) => f.endsWith('.mp3')).map(fileId);
  const downloads = filesUnder(torrent.contentPath!).filter((f) => f.endsWith('.mp3')).map(fileId);
  const message = requestMessage(run.requestId);
  const evidence = { requestId: run.requestId, folder, devDownloads: devOf(STOCK_DOWNLOADS), devMedia: devOf('/media/audiobooks'), library, downloads, message, torrent };
  writeEvidence('68/leg2-exdev.json', evidence);
  expect.soft(library.length, 'both files copied').toBe(2);
  expect.soft(library.every((f) => f.nlink === 1) && downloads.every((f) => f.nlink === 1), 'separate files, link count 1').toBe(true);
  expect.soft(library.map((f) => f.sha).sort()).toEqual(downloads.map((f) => f.sha).sort());
  expect.soft(message).toMatch(/^copied, not hard-linked \(the download and library folders are separate mounts, EXDEV\)/);
  expect.soft(filesUnder(folder).some((f) => f.endsWith('/metadata.opf')), 'metadata.opf written on the copy fallback too').toBe(true);

  {
    const { ctx, page } = await adminPage(browser, 1280, 900, false);
    try {
      await page.goto('/admin');
      const row = page.getByText(message, { exact: true }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await elementShot(page, page.locator('tr', { has: row }).first(), 'request-copied-not-linked');
    } finally {
      await ctx.close();
    }
  }
  await reenableSchedules();

  // Run the match so the request becomes available (which clears the request's message)
  await waitFor('request available', async () => {
    await absItemFor(folder).catch(() => null);
    await rmab.triggerScheduledJob('plex_library_scan').catch(() => undefined);
    return requestStatus(run.requestId) === 'available' ? true : null;
  }, { timeoutMs: 300_000, intervalMs: 15_000 });
  expect.soft(requestMessage(run.requestId), 'available clears the request message').toBe('');
  const note = JSON.parse(psql(`select value from configuration where key = 'audiobook_link_fallback_last'`));
  writeEvidence('68/leg2-durable-note.json', note);
  expect.soft(note).toMatchObject({ title: book.title, reason: 'the download and library folders are separate mounts, EXDEV' });
  const { ctx, page } = await adminPage(browser, 1280, 900, false);
  try {
    await openPaths(page);
    const line = page.getByTestId('link-fallback-last');
    await expect(line).toContainText(`Last book copied instead of linked: ${book.title} (the download and library folders are separate mounts, EXDEV)`);
    await sectionShot(page, 'paths-copied-instead-of-linked');
  } finally {
    await ctx.close();
  }
});

test('3: separate mounts, Hard link only: nothing imported, request in warn; Retry after the change imports it', async ({ browser }) => {
  expect((await savePaths(rmab, { ...OFF, downloadDir: STOCK_DOWNLOADS, filePlacement: 'hardlink_only', metadataOpfEnabled: true })).status).toBe(200);
  const book = books.phm;
  await loadRelease('hardlink-only-68', 'phm', 'phm-mp3', '{{author}} - {{title}} (Unabridged) [MP3]');
  const run = await requestAndWait(rmab, book, 'Test Author', ['warn', 'downloaded', 'available']);
  const torrent = await torrentOf(run.requestId);
  const before = filesUnder(torrent.contentPath!).map(fileId);
  const libraryFiles = filesUnder('/media/audiobooks').filter((f) => f.includes(book.title));
  const evidence = {
    requestId: run.requestId, status: run.status, message: requestMessage(run.requestId), torrent, before, libraryFiles,
    blocklist: blocklistRows(run.requestId),
  };
  writeEvidence('68/leg3-refused.json', evidence);
  expect.soft(run.status, 'request waits in warn').toBe('warn');
  expect.soft(evidence.message).toBe(
    'Not imported: hard link not possible (the download and library folders are separate mounts, EXDEV). Nothing was copied. ' +
      'Fix the mounts, or set File placement to Hard link (copy if not possible), then retry.'
  );
  expect.soft(libraryFiles, 'no audio and no metadata.opf in the library').toEqual([]);
  expect.soft(evidence.blocklist, 'not blocklisted').toBe('0');
  expect.soft(torrent.listed, 'torrent still listed by the client').toBe(true);

  {
    const { ctx, page } = await adminPage(browser, 1280, 900, false);
    try {
      await page.goto('/admin');
      const row = page.getByText(evidence.message, { exact: true }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await elementShot(page, page.locator('tr', { has: row }).first(), 'request-warn-hard-link-only');
    } finally {
      await ctx.close();
    }
  }

  expect((await savePaths(rmab, { ...OFF, filePlacement: 'hardlink' })).status).toBe(200);
  const retry = await rmab.raw('PATCH', `/api/requests/${run.requestId}`, { action: 'retry' });
  expect(retry.status, 'Retry accepted').toBe(200);
  const status = await waitFor('retried import', async () => {
    const s = requestStatus(run.requestId);
    return ['downloaded', 'available', 'failed'].includes(s) ? s : null;
  }, { timeoutMs: 300_000, intervalMs: 3_000 });
  const folder = bookFolder(run.requestId);
  const after = { status, folder, library: filesUnder(folder).map(fileId), download: filesUnder(torrent.contentPath!).map(fileId), message: requestMessage(run.requestId) };
  writeEvidence('68/leg3-retried.json', after);
  expect.soft(status).toMatch(/downloaded|available/);
  expect.soft(after.library.filter((f) => f.path.endsWith('.mp3')).length, 'every audio file imported by copy').toBe(before.filter((f) => f.path.endsWith('.mp3')).length);
  expect.soft(after.library.every((f) => f.nlink === 1), 'copies, not links').toBe(true);
  expect.soft(after.download.map((f) => f.sha), 'download unchanged').toEqual(before.map((f) => f.sha));
});

test('1, 4, 5: one mount, Hard link + OPF: one file on disk, Audiobookshelf reads the OPF, the download is never changed', async ({ browser }) => {
  asApp(`mkdir -p ${SHARED_DOWNLOADS}`);
  expect((await savePaths(rmab, { ...OFF, downloadDir: SHARED_DOWNLOADS, filePlacement: 'hardlink', metadataOpfEnabled: true })).status).toBe(200);
  const book = books.martian;
  seedBook(book, AUTHORS, 'Fixture Saga', 2011);
  await loadRelease('hardlink-shared-68', 'martian', 'martian-m4b-cover', `${AUTHORS} - {{title}} (Unabridged) [M4B]`);
  const run = await requestAndWait(rmab, book, AUTHORS, ['downloaded', 'available']);
  expect(run.status, 'imported').toMatch(/downloaded|available/);
  const folder = bookFolder(run.requestId);
  const torrent = await torrentOf(run.requestId);
  const download = filesUnder(torrent.contentPath!).filter((f) => f.endsWith('.m4b')).map(fileId);
  const libraryAll = filesUnder(folder);
  const library = libraryAll.filter((f) => f.endsWith('.m4b')).map(fileId);
  const cover = libraryAll.find((f) => f.endsWith('/cover.jpg'));
  const opf = libraryAll.find((f) => f.endsWith('/metadata.opf'));
  const jobLines = psql(`select string_agg(e.message, E'\\n' order by e.created_at) from job_events e join jobs j on j.id = e.job_id where j.request_id = ${sqlStr(run.requestId)} and (e.message like 'Linked%' or e.message like 'Wrote metadata.opf%' or e.message like 'Hard link%')`);
  const leg1 = { requestId: run.requestId, torrent, download, library, libraryAll, cover: cover ? fileId(cover) : null, opf: opf ? fileId(opf) : null, message: requestMessage(run.requestId), jobLines };
  writeEvidence('68/leg1-linked.json', leg1);
  expect.soft(torrent.savePath, 'download landed under the shared mount').toBe(SHARED_DOWNLOADS);
  expect.soft(library.length, 'one audio file').toBe(1);
  expect.soft(library[0] && { dev: library[0].dev, ino: library[0].ino, nlink: library[0].nlink, sha: library[0].sha }, 'library file IS the download')
    .toEqual(download[0] && { dev: download[0].dev, ino: download[0].ino, nlink: 2, sha: download[0].sha });
  expect.soft(leg1.opf?.nlink, 'metadata.opf written, its own file').toBe(1);
  // The fixture's cover is inside the m4b and offline there is no cover URL: a cover.jpg, if any, is a copy
  if (leg1.cover) expect.soft(leg1.cover.nlink, 'cover.jpg is its own file').toBe(1);
  expect.soft(libraryAll.filter((f) => /\.tmp$|\.part$|rmab-partial/.test(f)), 'no partials').toEqual([]);
  expect.soft(jobLines).toContain('Linked 1 file(s) to the download (one copy on disk)');
  expect.soft(leg1.message, 'no request message').toBe('');

  // 4. Audiobookshelf reads the OPF (the file's own tags say "Fixture Source Title/Author")
  const item = await absItemFor(folder);
  writeEvidence('68/leg4-abs-item.json', item);
  expect.soft(item.title).toBe(book.title);
  // Audiobookshelf doesn't keep the OPF's author order (it listed Second Writer first)
  expect.soft([...item.authors].sort()).toEqual(['Second Writer', 'Test Author']);
  expect.soft(item.narrators).toEqual([book.narrator]);
  expect.soft(item.series).toEqual([{ name: 'Fixture Saga', sequence: '1' }]);
  expect.soft(item.asin).toBe(book.asin);
  expect.soft(String(item.publishedYear)).toBe('2011');
  expect.soft(fileId(download[0].path).sha, 'ABS scan did not change the file').toBe(download[0].sha);
  const shotError = await absBookPageShot(browser, item.id, book.title, 'abs-book-page-opf-metadata');
  expect.soft(shotError, 'Audiobookshelf book page screenshot').toBeNull();

  // 5. Seeded-torrent cleanup (seeding rule not met), then a request delete
  await rmab.triggerScheduledJob('cleanup_seeded_torrents');
  await new Promise((r) => setTimeout(r, 15_000));
  const afterCleanup = { torrent: await torrentOf(run.requestId), download: fileId(download[0].path), library: fileId(library[0].path) };
  const del = await rmab.raw('DELETE', `/api/admin/requests/${run.requestId}`);
  const deleted = { status: del.status, body: await del.json().catch(() => ({})) };
  const afterDelete = { torrent: await torrentOf(run.requestId), download: fileId(download[0].path), folderLeft: filesUnder(folder) };
  writeEvidence('68/leg5-download-kept.json', { afterCleanup, deleted, afterDelete });
  expect.soft(afterCleanup.torrent.listed, 'listed after cleanup').toBe(true);
  expect.soft([afterCleanup.download.sha, afterCleanup.download.nlink], 'both names after cleanup').toEqual([download[0].sha, 2]);
  expect.soft(deleted.status).toBe(200);
  expect.soft(afterDelete.folderLeft, 'library names, cover.jpg and metadata.opf gone').toEqual([]);
  expect.soft([afterDelete.download.sha, afterDelete.download.nlink], 'download bytes unchanged, link count 1').toEqual([download[0].sha, 1]);
  expect.soft(afterDelete.torrent.listed, 'listed after the delete').toBe(true);
});

/** The request row on the admin page, as one picture. */
async function requestRowShot(browser: Parameters<typeof adminPage>[0], message: string, name: string) {
  const { ctx, page } = await adminPage(browser, 1280, 900, false);
  try {
    await page.goto('/admin');
    const row = page.getByText(message, { exact: true }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await elementShot(page, page.locator('tr', { has: row }).first(), name);
  } finally {
    await ctx.close();
  }
}

test('6: Manual Import from outside the download folders, and a failure in the middle of the link pass', async ({ browser }) => {
  asApp(`mkdir -p ${SHARED_DOWNLOADS}`);
  const OUTSIDE_COPY = 'copied, not hard-linked (the files are not in a download folder, OUTSIDE)';
  const OUTSIDE_ONLY =
    'Not imported: hard link not possible (the files are not in a download folder, OUTSIDE). Nothing was copied. ' +
    'Only files in a download folder can be hard-linked: set File placement to Hard link (copy if not possible), then run the import again.';
  const srcRoot = `${MEDIA}/_e2e-68-import`;
  const results: Record<string, unknown> = {};
  let template: string | null = null;
  await disableSchedules(rmab, disabledSchedules);
  try {
    // a. Hard link (copy if not possible): copied as Copy mode does, with the reason
    expect((await savePaths(rmab, { ...OFF, downloadDir: SHARED_DOWNLOADS, filePlacement: 'hardlink', metadataOpfEnabled: true })).status).toBe(200);
    const aSources = generateTones(`${srcRoot}/a`, ['01.mp3', '02.mp3']);
    const a = await manualImport(rmab, `${srcRoot}/a`, { audiobookId: insertBook('Fixture Book 68 Import A', 'B0E2E68A00') });
    const aFolder = bookFolder(a.requestId);
    const aLeg = { ...a, message: requestMessage(a.requestId), folder: aFolder, library: filesUnder(aFolder).filter((f) => f.endsWith('.mp3')).map(fileId), sources: aSources.map(fileId) };
    results.outsideHardlink = aLeg;
    expect.soft(aLeg.status).toBe('downloaded');
    expect.soft(aLeg.message).toBe(OUTSIDE_COPY);
    expect.soft(aLeg.library.length, 'both files imported').toBe(2);
    expect.soft([...aLeg.library, ...aLeg.sources].every((f) => f.nlink === 1), 'copies: every name has link count 1').toBe(true);
    expect.soft(aLeg.library.map((f) => f.sha).sort()).toEqual(aLeg.sources.map((f) => f.sha).sort());
    if (aLeg.message === OUTSIDE_COPY) await requestRowShot(browser, OUTSIDE_COPY, 'request-not-in-download-folder-hardlink');

    // b. Hard link only: nothing imported, and the request says why (not "fix the mounts")
    expect((await savePaths(rmab, { filePlacement: 'hardlink_only' })).status).toBe(200);
    generateTones(`${srcRoot}/b`, ['01.mp3']);
    const b = await manualImport(rmab, `${srcRoot}/b`, { audiobookId: insertBook('Fixture Book 68 Import B', 'B0E2E68B00') });
    const bLeg = { ...b, message: requestMessage(b.requestId), library: filesUnder(MEDIA).filter((f) => f.includes('Fixture Book 68 Import B')) };
    results.outsideHardlinkOnly = bLeg;
    expect.soft(bLeg.status).toBe('failed');
    expect.soft(bLeg.message).toBe(OUTSIDE_ONLY);
    expect.soft(bLeg.library, 'nothing in the library').toEqual([]);
    if (bLeg.message === OUTSIDE_ONLY) await requestRowShot(browser, OUTSIDE_ONLY, 'request-not-in-download-folder-hardlink-only');

    // c. File 3 of 3 can't be linked (an interrupted copy of it is in the library): links 1 and 2 are removed again
    // The default folder template for this import, so the book folder is known before it runs (put back below)
    template = psql(`select coalesce((select value from configuration where key = 'audiobook_path_template'), '')`);
    psql(`insert into configuration (id, key, value, updated_at) values (gen_random_uuid()::text, 'audiobook_path_template', '{author}/{title} {asin}', now())
          on conflict (key) do update set value = excluded.value`);
    const midDir = `${SHARED_DOWNLOADS}/e2e-68-mid`;
    const mid = generateTones(midDir, ['01.mp3', '02.mp3', '03.mp3']);
    const cFolder = `${MEDIA}/Test Author/Fixture Book 68 Mid B0E2E68C00`;
    asApp(`mkdir -p ${q(cFolder)} && head -c 4096 ${q(mid[2])} > ${q(`${cFolder}/03.mp3`)}`);
    const c = await manualImport(rmab, midDir, { audiobookId: insertBook('Fixture Book 68 Mid', 'B0E2E68C00') });
    const cOnly = { ...c, message: requestMessage(c.requestId), folder: filesUnder(cFolder).map(fileId), sources: mid.map(fileId) };
    results.midPassHardlinkOnly = cOnly;
    expect.soft(cOnly.status).toBe('failed');
    expect.soft(cOnly.message).toContain('(an interrupted copy of this file is in the library, PREFIX)');
    expect.soft(cOnly.folder.map((f) => f.path.split('/').pop()), 'only the interrupted copy is left, no link').toEqual(['03.mp3']);
    expect.soft(cOnly.sources.every((f) => f.nlink === 1), 'no download file has a second name').toBe(true);

    expect((await savePaths(rmab, { filePlacement: 'hardlink' })).status).toBe(200);
    const c2 = await manualImport(rmab, midDir, { requestId: c.requestId });
    const cCopy = { ...c2, message: requestMessage(c.requestId), folder: filesUnder(cFolder).filter((f) => f.endsWith('.mp3')).map(fileId), sources: mid.map(fileId) };
    results.midPassHardlink = cCopy;
    expect.soft(cCopy.status).toBe('downloaded');
    expect.soft(cCopy.message).toMatch(/^copied, not hard-linked \(an interrupted copy of this file is in the library, PREFIX\)/);
    expect.soft([...cCopy.folder, ...cCopy.sources].every((f) => f.nlink === 1), 'copied: no link left from the pass').toBe(true);
    expect.soft(cCopy.folder.map((f) => f.sha)).toEqual(cCopy.sources.map((f) => f.sha));

    // d. The same book imported again from its own library folder (in place) under Hard link only: imported, untouched, no note
    expect((await savePaths(rmab, { filePlacement: 'hardlink_only' })).status).toBe(200);
    const mp3s = () => filesUnder(cFolder).filter((f) => f.endsWith('.mp3')).map(fileId);
    const before = mp3s();
    const d = await manualImport(rmab, cFolder, { requestId: c.requestId });
    const dLeg = { ...d, message: requestMessage(c.requestId), before, after: mp3s() };
    results.inPlaceHardlinkOnly = dLeg;
    expect.soft(dLeg.status).toBe('downloaded');
    expect.soft(dLeg.message ?? '', 'no copy note, no refusal').toBe('');
    expect.soft(dLeg.after, 'the same files, untouched').toEqual(dLeg.before);
  } finally {
    writeEvidence('68/leg6-outside-and-mid-pass.json', results);
    if (template !== null) {
      psql(template ? `update configuration set value = ${sqlStr(template)} where key = 'audiobook_path_template'` : `delete from configuration where key = 'audiobook_path_template'`);
    }
    await reenableSchedules();
    sh(`rm -rf ${q(srcRoot)} ${q(`${SHARED_DOWNLOADS}/e2e-68-mid`)}`);
  }
});
