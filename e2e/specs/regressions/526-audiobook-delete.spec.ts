/**
 * Component: E2E regression #526 (an audiobook request delete removes only the files that request placed)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Audiobookshelf backend (default). The audio is imported for real (manual import); Book.epub is
 * placed by the app's own ebook organize job (recorded, #497) for an ebook request linked to the
 * audiobook request, as the automatic one is. cover.jpg is written beside them when the import
 * placed none (the delete matches it by name). Deletes go through DELETE /api/admin/requests/<id>
 * (case b: the admin table). /media is checked by sha256.
 *   a. audio + cover + the recorded epub: the audio and cover go; the epub, its folder and its
 *      request stay (unlinked); the book keeps the ebook's folder; the ebook still downloads; a
 *      library scan leaves the book requested; then the ebook request delete leaves no folder.
 *   b. + the user's notes.txt: the cover stays beside it; the admin table's warning toast lists
 *      what stayed (screenshots at 1280 px light and 375 px dark).
 */

import { test, expect, type Page } from '@playwright/test';
import { Abs, authState, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, snap, waitFor, loginAdminUi } from '../../lib/harness';
import {
  PUID, PGID, sh, asApp, q, psql, sqlStr, Case, exists, setConfig, newBook, bookRow, genAudio, genEbook, importAudio, importEbook,
  linkAbs, absItemExists, deleteRequest, mediaShas, sameShas,
} from './library-delete-helpers';
import { placedRecord, sha256 } from './497-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const SRC = '/downloads/manual/e2e-526';
const OTHER_EBOOK = 'ebook of another request';
const NO_RECORD = 'RMAB has no record that it placed it';

interface FolderKept { folder: string; files: Array<{ name: string; why: string }>; more: number }

function finish(c: Case) {
  expect(c.finish()).toEqual([]);
}

const ls = (dir: string) => sh(`ls -A ${q(dir)} | sort`).trim().split('\n').filter(Boolean);

function childRow(id: string): { deleted: boolean; parent: string; status: string } {
  return JSON.parse(psql(
    `select json_build_object('deleted', deleted_at is not null, 'parent', coalesce(parent_request_id::text, ''), 'status', status)::text from requests where id = ${sqlStr(id)}`
  ));
}

/** Audio imported for real, a cover beside it, Book.epub placed by a linked ebook request (recorded). */
async function bookWithEbook(c: Case, rmab: Rmab, key: string, title: string, asin: string) {
  const audiobookId = newBook(title, `Author ${title}`, asin);
  genAudio(`${SRC}/${key}`, ['Book.m4b']);
  const requestId = await importAudio(c, rmab, audiobookId, `${SRC}/${key}`);
  const folder = bookRow(audiobookId).filePath;
  c.check(`imported into the library (${folder})`, !!folder && exists(folder), 'control');
  if (!exists(`${folder}/cover.jpg`)) asApp(`printf 'cover bytes' > ${q(`${folder}/cover.jpg`)}`);
  genEbook(`${SRC}/${key}-ebook`, 'Book.epub');
  const ebookId = await importEbook(c, audiobookId, `${SRC}/${key}-ebook`);
  psql(`update requests set parent_request_id = ${sqlStr(requestId)} where id = ${sqlStr(ebookId)}`);
  const epub = `${folder}/Book.epub`;
  const record = placedRecord(ebookId);
  c.check('the epub is recorded for the ebook request', Array.isArray(record) && record.length === 1 && record[0].path === epub, 'control', JSON.stringify(record));
  return { audiobookId, requestId, ebookId, folder, epub };
}

test.beforeEach(() => {
  setConfig('ebook_path_template', null);
  sh(`mkdir -p ${q(SRC)}\nchown ${PUID}:${PGID} /downloads/manual ${q(SRC)} 2>/dev/null || true`);
});

test('526a audio + cover + the recorded epub: audio and cover go, the epub and its request stay; then the ebook delete leaves no folder', async () => {
  const c = new Case('526-a-audio-cover-epub');
  const rmab = await Rmab.loginAdmin();
  const b = await bookWithEbook(c, rmab, '526a', 'Scoped Delete Alpha', 'B0S526A001');
  c.save('folder-before.txt', ls(b.folder).join('\n'));
  const abs = await linkAbs(b.audiobookId, b.folder);
  const epubSha = sha256(b.epub);
  const outside = mediaShas([b.folder]);
  c.save('media-before.json', mediaShas());

  const res = await deleteRequest(c, rmab, b.requestId, 'delete-audiobook');
  const kept = (res.details as { folderKept?: FolderKept }).folderKept;
  c.save('media-after-audiobook-delete.json', mediaShas());
  c.check('filesDeleted true, no filesKeptReason', res.details.filesDeleted === true && !res.details.filesKeptReason, 'safety', JSON.stringify(res.details));
  c.check(`folderKept lists the epub only (${JSON.stringify(kept)})`, JSON.stringify(kept?.files) === JSON.stringify([{ name: 'Book.epub', why: OTHER_EBOOK }]), 'safety');
  c.check(`message (${res.message})`, res.message === `Request deleted; the book folder stays because it still holds: Book.epub (${OTHER_EBOOK})`, 'control');
  c.check(`the folder holds only the epub (${ls(b.folder).join(', ')})`, JSON.stringify(ls(b.folder)) === JSON.stringify(['Book.epub']), 'safety');
  c.check('the epub byte for byte', sha256(b.epub) === epubSha, 'safety');
  c.check('everything outside the folder unchanged', sameShas(outside, mediaShas([b.folder])), 'safety');
  c.check('ABS item of the audiobook deleted', !(await absItemExists(abs)), 'control');

  const child = childRow(b.ebookId);
  c.check(`the ebook request stays, unlinked (${JSON.stringify(child)})`, !child.deleted && child.parent === '' && child.status === 'downloaded', 'safety');
  c.check('its placement record is unchanged', JSON.stringify(placedRecord(b.ebookId)) !== '"NULL"' && (placedRecord(b.ebookId) as Array<{ sha256: string }>)[0].sha256 === epubSha, 'safety');
  const row = bookRow(b.audiobookId);
  c.save('book-row-after-audiobook-delete.json', row);
  c.check(`book row: the ebook's folder and format, no hash, requested (${JSON.stringify(row)})`, row.filePath === b.folder && row.fileFormat === 'epub' && !row.filesHash && row.status === 'requested' && !row.absItemId, 'safety');

  // The ebook request still works: listed as downloadable, the download serves the epub, select-ebook finds no missing parent
  const list = await (await rmab.raw('GET', '/api/requests?limit=100&type=ebook')).json();
  const listed = (list.requests || []).find((r: { id: string }) => r.id === b.ebookId);
  c.check(`GET /api/requests: downloadAvailable true (${listed?.downloadAvailable})`, listed?.downloadAvailable === true, 'safety');
  const token = await (await rmab.raw('POST', `/api/requests/${b.ebookId}/download-token`)).json();
  const dl = await rmab.raw('GET', String(token.downloadUrl || ''));
  const body = Buffer.from(await dl.arrayBuffer());
  const { createHash } = await import('node:crypto');
  c.check(`download serves the epub (HTTP ${dl.status}, ${body.length} bytes)`, dl.status === 200 && createHash('sha256').update(body).digest('hex') === epubSha, 'safety');
  const pick = await rmab.raw('POST', `/api/requests/${b.ebookId}/select-ebook`, {
    ebook: { source: 'prowlarr', guid: 'e2e-526', title: 'Scoped Delete Alpha', downloadUrl: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=alpha', indexer: 'E2E', size: 1000, format: 'epub' },
  });
  const pickBody = await pick.json().catch(() => ({}));
  c.save('select-ebook-response.json', { status: pick.status, body: pickBody });
  c.check(`select-ebook does not answer "parent not found" (HTTP ${pick.status} ${JSON.stringify(pickBody)})`, pick.status !== 404, 'safety');

  // A library scan after the delete: ABS sees only an ebook; the book stays requested, nothing relinks it
  const absApi = await Abs.login();
  const libraryId = authState().absLibraryId;
  await absApi.req('POST', `/api/libraries/${libraryId}/scan`).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 15_000)); // ABS scans in the background
  const absItems = (await absApi.libraryItems(libraryId)).filter((i: { path?: string }) => i.path === b.folder);
  c.save('abs-items-for-folder.json', absItems.map((i: { id: string; mediaType?: string; media?: { numAudioFiles?: number } }) => ({ id: i.id, mediaType: i.mediaType, numAudioFiles: i.media?.numAudioFiles })));
  const t0 = psql('select now()::text');
  await rmab.triggerScheduledJob('plex_library_scan');
  const scan = await waitFor('RMAB library scan finished', async () => {
    const s = psql(`select status from jobs where type in ('scan_plex','plex_library_scan') and created_at > ${sqlStr(t0)}::timestamptz order by created_at desc limit 1`);
    return s === 'completed' || s === 'failed' ? s : null;
  }, { timeoutMs: 300_000, intervalMs: 2_000 });
  const afterScan = bookRow(b.audiobookId);
  c.save('book-row-after-scan.json', { scan, row: afterScan });
  c.check(`after the scan (${scan}) the book is still requested, not linked (${JSON.stringify(afterScan)})`, afterScan.status === 'requested' && !afterScan.absItemId, 'safety');

  // Then the ebook request: the folder (and its empty author folder) goes; the rest of /media is unchanged
  const del2 = await deleteRequest(c, rmab, b.ebookId, 'delete-ebook');
  c.check('ebook delete: filesDeleted true, no reason', del2.details.filesDeleted === true && !del2.details.filesKeptReason, 'safety', JSON.stringify(del2.details));
  c.check('no book folder left', !exists(b.folder), 'safety');
  c.check('no empty author folder left', !exists(b.folder.replace(/\/[^/]+$/, '')), 'control');
  c.check('everything else under /media unchanged', sameShas(outside, mediaShas()), 'safety');
  c.check(`book row points at nothing (${JSON.stringify(bookRow(b.audiobookId))})`, !bookRow(b.audiobookId).filePath, 'safety');
  c.save('media-after.json', mediaShas());
  finish(c);
});

async function deleteFromTable(page: Page, title: string) {
  await page.goto('/admin');
  await page.getByPlaceholder('Search by title or author...').fill(title);
  const row = page.locator('tr', { hasText: title }).first();
  await row.getByTitle('Actions').click();
  await page.getByRole('menuitem', { name: 'Delete Request' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
}

test('526b a user file beside it: the cover stays too; the admin table warns with what stayed', async ({ page }) => {
  const c = new Case('526-b-user-file-toast');
  const rmab = await Rmab.loginAdmin();
  const b = await bookWithEbook(c, rmab, '526b', 'Scoped Delete Bravo', 'B0S526B001');
  asApp(`printf 'my notes' > ${q(`${b.folder}/notes.txt`)}`);
  const before = mediaShas();
  const keep = ['Book.epub', 'cover.jpg', 'notes.txt'];
  const keptShas = Object.fromEntries(keep.map((n) => [n, sha256(`${b.folder}/${n}`)]));
  c.save('kept-before.json', keptShas);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await loginAdminUi(page);
  await deleteFromTable(page, 'Scoped Delete Bravo');
  const text = `Request deleted; the book folder stays because it still holds: Book.epub (${OTHER_EBOOK}), cover.jpg (${NO_RECORD}), notes.txt (${NO_RECORD})`;
  const toast = page.getByText(text);
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await snap(page, c.dir, 'folder-kept-toast');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(toast).toBeVisible();
  await page.waitForTimeout(600);
  await snap(page, c.dir, 'folder-kept-toast-375-dark');

  c.check(`the folder holds the epub, cover and notes (${ls(b.folder).join(', ')})`, JSON.stringify(ls(b.folder)) === JSON.stringify(keep), 'safety');
  c.check('each kept file byte for byte', keep.every((n) => sha256(`${b.folder}/${n}`) === keptShas[n]), 'safety');
  const after = mediaShas();
  const removed = Object.keys(before).filter((p) => !(p in after));
  c.save('removed.json', removed);
  c.check(`only the audio was removed (${removed.join(', ')})`, JSON.stringify(removed) === JSON.stringify([`${b.folder}/Book.m4b`]), 'safety');
  finish(c);
});
