/**
 * Component: E2E regression #68 (File placement: hard link instead of copy; metadata.opf instead of tags)
 * Documentation: documentation/features/library-placement.md
 *
 * Audiobookshelf mode, real import path (fake Prowlarr + fake qBittorrent, real Audiobookshelf),
 * settings saved through the real admin PUT. Flags: --offline-fixtures --overrides abs-fake-metadata.
 * 0. Paths page: both settings at 1280 light and 375 dark; the page in Plex mode (backend switched for
 *    the shot); both stored-conflict messages.
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
 * Exec bridge required.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, waitFor, writeEvidence, type Book } from '../../lib/harness';
import { asApp, psql, sqlStr } from './242-helpers';
import {
  absItemFor, adminPage, blocklistRows, bookFolder, devOf, elementShot, fileId, filesUnder, fullShot, loadRelease, openPaths,
  requestAndWait, requestMessage, requestStatus, savePaths, seedBook, SHARED_DOWNLOADS, STOCK_DOWNLOADS, torrentOf,
} from './68-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial', timeout: 900_000 });

const AUTHORS = 'Test Author, Second Writer';
const OFF = { metadataTaggingEnabled: false, chapterMergingEnabled: false };
let books: Record<string, Book>;
let rmab: Rmab;

test.beforeAll(async () => {
  books = await fakeArr.books();
  expect(books.martian.title, 'run with --offline-fixtures (made-up fixture titles)').toMatch(/^Fixture Book /);
  rmab = await Rmab.loginAdmin();
});

test('0: the Paths page shows File placement and Metadata in Audiobookshelf mode only, and explains a stored conflict', async ({ browser }) => {
  for (const view of [{ name: '1280-light', w: 1280, h: 900, dark: false }, { name: '375-dark', w: 375, h: 812, dark: true }]) {
    const { ctx, page } = await adminPage(browser, view.w, view.h, view.dark);
    try {
      await openPaths(page);
      const section = page.getByTestId('library-files-section');
      await expect(section).toBeVisible();
      await page.getByRole('checkbox', { name: /Auto-merge chapters/ }).uncheck();
      await page.getByRole('radio', { name: 'OPF file (metadata.opf)' }).check();
      await page.getByRole('radio', { name: 'Hard link (copy if not possible)' }).check();
      await expect(page.getByRole('radio', { name: 'Tags in the audio files' })).toBeDisabled();
      await expect(page.getByRole('checkbox', { name: /Auto-merge chapters/ })).toBeDisabled();
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflowX, `${view.name}: no horizontal scroll`).toBeLessThanOrEqual(0);
      await fullShot(page, `paths-abs-${view.name}`);
      if (view.name === '1280-light') {
        const saved = page.waitForResponse((r) => r.url().endsWith('/api/admin/settings/paths') && r.request().method() === 'PUT');
        await page.getByRole('button', { name: 'Save Settings' }).click();
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
  const mode = psql(`select value from configuration where key = 'system.backend_mode'`);
  psql(`update configuration set value = 'plex' where key = 'system.backend_mode'`);
  await cacheTtl();
  try {
    const { ctx, page } = await adminPage(browser, 1280, 900, false);
    try {
      await openPaths(page);
      await expect(page.getByTestId('library-files-section')).toHaveCount(0);
      await expect(page.getByLabel(/Auto-tag audio files with metadata/)).toBeEnabled();
      await fullShot(page, 'paths-plex-1280-light');
      await page.getByLabel(/Auto-tag audio files with metadata/).check();
      await page.getByRole('checkbox', { name: /Auto-merge chapters/ }).check();
      const saved = page.waitForResponse((r) => r.url().endsWith('/api/admin/settings/paths') && r.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Save Settings' }).click();
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
    await expect(section.getByRole('alert')).toHaveText('Needs Metadata: OPF file or None, and chapter merge off.');
    await expect(page.getByText('Hard links need Metadata set to OPF file or None.').first()).toBeVisible();
    await elementShot(page, section, 'refusal-stored-conflict-tags');
    await page.getByRole('radio', { name: 'OPF file (metadata.opf)' }).check();
    await expect(page.getByText('Turn off chapter merge to use hard links.').first()).toBeVisible();
    await elementShot(page, section, 'refusal-stored-conflict-merge');
  } finally {
    await ctx.close();
  }
  expect((await savePaths(rmab, { ...OFF, filePlacement: 'hardlink', metadataOpfEnabled: true })).status).toBe(200);
});

test('2: separate mounts, Hard link: the book is copied, and the Paths page keeps saying so after it is available', async ({ browser }) => {
  expect((await savePaths(rmab, { ...OFF, downloadDir: STOCK_DOWNLOADS, filePlacement: 'hardlink', metadataOpfEnabled: true })).status).toBe(200);
  const book = books.artemis;
  await loadRelease('hardlink-exdev-68', 'artemis', 'artemis-mp3', '{{author}} - {{title}} (Unabridged) [MP3]');
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
  expect.soft(message).toBe('copied, not hard-linked (the download and library folders are separate mounts (EXDEV))');
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

  // Run the match so the request becomes available (which clears the request's message)
  await waitFor('request available', async () => {
    await absItemFor(folder).catch(() => null);
    await rmab.triggerScheduledJob('plex_library_scan').catch(() => undefined);
    return requestStatus(run.requestId) === 'available' ? true : null;
  }, { timeoutMs: 300_000, intervalMs: 15_000 });
  expect.soft(requestMessage(run.requestId), 'available clears the request message').toBe('');
  const note = JSON.parse(psql(`select value from configuration where key = 'audiobook_link_fallback_last'`));
  writeEvidence('68/leg2-durable-note.json', note);
  expect.soft(note).toMatchObject({ title: book.title, reason: 'the download and library folders are separate mounts (EXDEV)' });
  const { ctx, page } = await adminPage(browser, 1280, 900, false);
  try {
    await openPaths(page);
    const line = page.getByTestId('link-fallback-last');
    await expect(line).toContainText(`Last book copied instead of linked: ${book.title} (the download and library folders are separate mounts (EXDEV))`);
    await elementShot(page, page.getByTestId('library-files-section'), 'paths-copied-instead-of-linked');
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
  expect.soft(after.library.filter((f) => f.path.endsWith('.mp3')).length, 'imported by copy').toBe(2);
  expect.soft(after.download.map((f) => f.sha), 'download unchanged').toEqual(before.map((f) => f.sha));
});

test('1, 4, 5: one mount, Hard link + OPF: one file on disk, Audiobookshelf reads the OPF, the download is never changed', async () => {
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
  expect.soft(Boolean(opf && cover), 'metadata.opf and cover.jpg written').toBe(true);
  expect.soft(leg1.cover?.nlink, 'cover is its own file').toBe(1);
  expect.soft(libraryAll.filter((f) => /\.tmp$|\.part$|rmab-partial/.test(f)), 'no partials').toEqual([]);
  expect.soft(jobLines).toContain('Linked 1 file(s) to the download (one copy on disk)');
  expect.soft(leg1.message, 'no request message').toBe('');

  // 4. Audiobookshelf reads the OPF (the file's own tags say "Fixture Source Title/Author")
  const item = await absItemFor(folder);
  writeEvidence('68/leg4-abs-item.json', item);
  expect.soft(item.title).toBe(book.title);
  expect.soft(item.authors).toEqual(['Test Author', 'Second Writer']);
  expect.soft(item.narrators).toEqual([book.narrator]);
  expect.soft(item.series).toEqual([{ name: 'Fixture Saga', sequence: '1' }]);
  expect.soft(item.asin).toBe(book.asin);
  expect.soft(String(item.publishedYear)).toBe('2011');
  expect.soft(fileId(download[0].path).sha, 'ABS scan did not change the file').toBe(download[0].sha);

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
