/**
 * Component: E2E library delete guard (an admin request delete removes only what that request put there)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Audiobookshelf backend (default). Books are imported for real (manual import; ebooks through an
 * ebook request + organize job) and linked to the ABS item ABS reports for their folder. Each case
 * deletes a request through DELETE /api/admin/requests/<id> (or the admin table, E-h) and checks
 * /media by sha256, the ABS item, the book row and the API's filesKeptReason.
 * Cases: E-a..E-h (plan), R1 ABS second copy, R3 coerced .m4a, R4 re-run organize, R5 flat ebook
 * folder with foreign ebooks, R6 removal failure (EACCES), R7 media volume not mounted (emptied),
 * E-g2 replace after a refused delete. Plex mode: library-delete-plex.spec.ts.
 */

import { test, expect } from '@playwright/test';
import { env, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, snap } from '../../lib/harness';
import {
  MEDIA, PUID, PGID, sh, asApp, q, psql, sqlStr, Case, exists, setConfig, newBook, bookRow, genAudio, genEbook, importAudio, importEbook,
  linkAbs, absItemExists, absItemFor, deleteRequest, mediaShas, sameShas, emptyMediaDir, restoreMediaDir,
} from './library-delete-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(env('E2E_BACKEND') === 'plex', 'Audiobookshelf-backed cases; Plex mode runs library-delete-plex.spec.ts');
test.describe.configure({ mode: 'default' });

const SRC = '/downloads/manual/libdel';

function finish(c: Case) {
  expect(c.finish()).toEqual([]);
}

/** A fresh book imported from generated audio; returns its ids and stored folder. */
async function importedBook(c: Case, rmab: Rmab, key: string, title: string, author: string, asin: string, names = ['Book.m4b']) {
  const audiobookId = newBook(title, author, asin);
  genAudio(`${SRC}/${key}`, names);
  const requestId = await importAudio(c, rmab, audiobookId, `${SRC}/${key}`);
  const folder = bookRow(audiobookId).filePath;
  c.check(`${key}: imported into the library (${folder})`, !!folder && exists(folder), 'control');
  return { audiobookId, requestId, folder };
}

function expectRemoved(c: Case, label: string, res: { details: { filesDeleted?: boolean; filesKeptReason?: string } }, folder: string) {
  c.check(`${label}: filesDeleted true, no filesKeptReason`, res.details.filesDeleted === true && !res.details.filesKeptReason, 'safety', JSON.stringify(res.details));
  c.check(`${label}: title folder removed`, !exists(folder), 'safety');
}

function expectKept(c: Case, label: string, res: { details: { filesDeleted?: boolean; filesKeptReason?: string } }, reason: string) {
  c.check(`${label}: filesKeptReason contains "${reason}"`, (res.details.filesKeptReason || '').includes(reason), 'safety', JSON.stringify(res.details));
}

test.beforeEach(() => {
  setConfig('ebook_path_template', null);
  sh(`mkdir -p ${q(SRC)}\nchown ${PUID}:${PGID} /downloads/manual ${q(SRC)} 2>/dev/null || true`);
});

test('E-a default template, ebook imported after the audio (row overwritten): delete removes only the title folder; ABS item gone', async () => {
  const c = new Case('E-a-default-ebook-after-audio');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'ea', 'Guard Book Alpha', 'Guard Author Alpha', 'B0LDGTEA01');
  genEbook(`${SRC}/ea-ebook`, 'Guard Book Alpha.epub');
  await importEbook(c, b.audiobookId, `${SRC}/ea-ebook`);
  const row = bookRow(b.audiobookId);
  c.check(`ebook landed in the title folder; row now says ${row.fileFormat}`, row.filePath === b.folder, 'control', JSON.stringify(row));
  const abs = await linkAbs(b.audiobookId, b.folder);
  const before = mediaShas([b.folder]);

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  expectRemoved(c, 'delete', res, b.folder);
  c.check('nothing else under /media changed', sameShas(before, mediaShas([b.folder])), 'safety');
  c.check('ABS item deleted', !(await absItemExists(abs)), 'control');
  c.check('row cleared (file_path, files_hash)', !bookRow(b.audiobookId).filePath && !bookRow(b.audiobookId).filesHash, 'control');
  finish(c);
});

test('E-b default template, ebook imported before the audio: delete removes the title folder', async () => {
  const c = new Case('E-b-default-ebook-before-audio');
  const rmab = await Rmab.loginAdmin();
  const audiobookId = newBook('Guard Book Bravo', 'Guard Author Bravo', 'B0LDGTEB01');
  genEbook(`${SRC}/eb-ebook`, 'Guard Book Bravo.epub');
  await importEbook(c, audiobookId, `${SRC}/eb-ebook`);
  genAudio(`${SRC}/eb`, ['Book.m4b']);
  const requestId = await importAudio(c, rmab, audiobookId, `${SRC}/eb`);
  const row = bookRow(audiobookId);
  c.check(`audio organize wrote fileFormat (${row.fileFormat})`, row.fileFormat === 'm4b', 'control');
  const before = mediaShas([row.filePath]);

  const res = await deleteRequest(c, rmab, requestId, 'delete');
  expectRemoved(c, 'delete', res, row.filePath);
  c.check('nothing else under /media changed', sameShas(before, mediaShas([row.filePath])), 'safety');
  finish(c);
});

test('E-c flat "Ebooks" ebook template, two books: neither delete touches the shared folder; reason given; ABS items stay', async () => {
  const c = new Case('E-c-flat-ebooks-two-books');
  const rmab = await Rmab.loginAdmin();
  const one = await importedBook(c, rmab, 'ec1', 'Guard Book Charlie One', 'Guard Author Charlie', 'B0LDGTEC01');
  const two = await importedBook(c, rmab, 'ec2', 'Guard Book Charlie Two', 'Guard Author Charlie', 'B0LDGTEC02');
  const absOne = await linkAbs(one.audiobookId, one.folder);
  const absTwo = await linkAbs(two.audiobookId, two.folder);
  setConfig('ebook_path_template', 'Ebooks');
  genEbook(`${SRC}/ec1-ebook`, 'Charlie One.epub');
  genEbook(`${SRC}/ec2-ebook`, 'Charlie Two.epub');
  const ebookOne = await importEbook(c, one.audiobookId, `${SRC}/ec1-ebook`, 'ebook-one');
  await importEbook(c, two.audiobookId, `${SRC}/ec2-ebook`, 'ebook-two');
  const shared = `${MEDIA}/Ebooks`;
  c.check('both rows point at the shared Ebooks folder', bookRow(one.audiobookId).filePath === shared && bookRow(two.audiobookId).filePath === shared, 'control');
  const before = mediaShas();

  const ebookRes = await deleteRequest(c, rmab, ebookOne, 'delete-ebook');
  expectKept(c, 'delete-ebook', ebookRes, 'also the folder of "Guard Book Charlie Two"');
  const audioRes = await deleteRequest(c, rmab, one.requestId, 'delete-audiobook');
  expectKept(c, 'delete-audiobook', audioRes, 'also the folder of "Guard Book Charlie Two"');
  c.check('/media unchanged (both ebooks, both audio folders)', sameShas(before, mediaShas()), 'safety');
  c.check('ABS items of both books still there', (await absItemExists(absOne)) && (await absItemExists(absTwo)), 'safety');
  finish(c);
});

test('E-d foreign audio added to the title folder: delete refused; folder and ABS item stay; reason given', async () => {
  const c = new Case('E-d-foreign-audio');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'ed', 'Guard Book Delta', 'Guard Author Delta', 'B0LDGTED01');
  const abs = await linkAbs(b.audiobookId, b.folder);
  genAudio(b.folder, ['Bonus Track.m4a'], 3, 880);
  const before = mediaShas();

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  expectKept(c, 'delete', res, 'folder contents changed since import');
  c.check(`message says files kept (${res.message})`, res.message.startsWith('Request deleted; files kept:'), 'control');
  c.check('/media unchanged', sameShas(before, mediaShas()), 'safety');
  c.check('ABS item still there', await absItemExists(abs), 'safety');
  c.check('row keeps its folder and linkage', bookRow(b.audiobookId).filePath === b.folder && bookRow(b.audiobookId).absItemId === abs, 'safety');
  finish(c);
});

test('E-e title folder is a symlink to a seeding folder: delete refused; link and target intact', async () => {
  const c = new Case('E-e-symlinked-title-folder');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'ee', 'Guard Book Echo', 'Guard Author Echo', 'B0LDGTEE01');
  const abs = await linkAbs(b.audiobookId, b.folder);
  const seeding = '/downloads/seed/libdel-echo';
  asApp(`mkdir -p /downloads/seed\nrm -rf ${q(seeding)}\nmv ${q(b.folder)} ${q(seeding)}\nln -s ${q(seeding)} ${q(b.folder)}`);
  const seedBefore = sh(`cd ${q(seeding)} && sha256sum * | sort`);

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  expectKept(c, 'delete', res, 'outside the media library');
  c.check('link still in place', sh(`[ -L ${q(b.folder)} ] && echo yes || echo no`).trim() === 'yes', 'safety');
  c.check('seeding target unchanged', sh(`cd ${q(seeding)} && sha256sum * | sort`) === seedBefore, 'safety');
  c.check('ABS item still there', await absItemExists(abs), 'safety');
  finish(c);
});

test('E-f the library already held the folder (every file differs, no files hash): delete refused; files and ABS item stay', async () => {
  const c = new Case('E-f-preexisting-differs');
  const rmab = await Rmab.loginAdmin();
  const audiobookId = newBook('Guard Book Foxtrot', 'Guard Author Foxtrot', 'B0LDGTEF01');
  const target = `${MEDIA}/Guard Author Foxtrot/Guard Book Foxtrot B0LDGTEF01`;
  genAudio(target, ['Book.m4b'], 9, 330); // longer, so larger: 'differs', never overwritten
  genAudio(`${SRC}/ef`, ['Book.m4b']);
  const abs = await absItemFor(target);
  const requestId = await importAudio(c, rmab, audiobookId, `${SRC}/ef`);
  psql(`update audiobooks set abs_item_id = ${sqlStr(abs)} where id = ${sqlStr(audiobookId)}`);
  const row = bookRow(audiobookId);
  c.check(`import stored no files hash (${row.filesHash || 'none'})`, row.filePath === target && !row.filesHash, 'control', JSON.stringify(row));
  const before = mediaShas();

  const res = await deleteRequest(c, rmab, requestId, 'delete');
  expectKept(c, 'delete', res, 'no import record');
  c.check('/media unchanged', sameShas(before, mediaShas()), 'safety');
  c.check('ABS item still there', await absItemExists(abs), 'safety');
  finish(c);
});

test('E-g re-source (reported issue, replace) after a refusal: 409 with the reason; book, files and requests unchanged', async () => {
  const c = new Case('E-g-replace-after-refusal');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'eg', 'Guard Book Golf', 'Guard Author Golf', 'B0LDGTEG01');
  genAudio(b.folder, ['Bonus Track.m4a'], 3, 880);
  const issueId = psql(
    `insert into reported_issues (id, audiobook_id, reporter_id, reason, status, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(b.audiobookId)}, ${sqlStr(psql(`select id from users where role = 'admin' order by created_at limit 1`))}, 'e2e: wrong narrator', 'open', now(), now()) returning id`
  ).split('\n')[0];
  const requestsBefore = psql(`select count(*) from requests where audiobook_id = ${sqlStr(b.audiobookId)} and deleted_at is null`);
  const rowBefore = bookRow(b.audiobookId);
  const before = mediaShas();

  const res = await rmab.raw('POST', `/api/admin/reported-issues/${issueId}/replace`, {
    torrent: { guid: 'e2e-replace', title: 'Guard Book Golf', size: 50_000_000, indexer: 'E2E', downloadUrl: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=golf', publishDate: new Date().toISOString() },
  });
  const body = await res.json().catch(() => ({}));
  c.save('replace-response.json', { status: res.status, body });
  c.check(`replace answered 409 (HTTP ${res.status})`, res.status === 409, 'safety', JSON.stringify(body));
  c.check(`message gives the reason (${body.message})`, String(body.message || '').includes('folder contents changed since import'), 'control');
  c.check('/media unchanged', sameShas(before, mediaShas()), 'safety');
  c.check('book row unchanged', JSON.stringify(bookRow(b.audiobookId)) === JSON.stringify(rowBefore), 'safety');
  c.check('no new request, old one not deleted', psql(`select count(*) from requests where audiobook_id = ${sqlStr(b.audiobookId)} and deleted_at is null`) === requestsBefore, 'safety');
  c.check('issue still open', psql(`select status from reported_issues where id = ${sqlStr(issueId)}`) === 'open', 'control');
  finish(c);
});

test('E-h admin requests table shows the "files kept" warning toast', async ({ page }) => {
  const c = new Case('E-h-ui-files-kept-toast');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'eh', 'Guard Book Hotel', 'Guard Author Hotel', 'B0LDGTEH01');
  genAudio(b.folder, ['Bonus Track.m4a'], 3, 880);

  await page.goto('/login');
  if (await page.getByRole('button', { name: /Admin Login/ }).isVisible().catch(() => false)) await page.getByRole('button', { name: /Admin Login/ }).click();
  await page.locator('#admin-username').fill(env('E2E_ADMIN_USER'));
  await page.locator('#admin-password').fill(env('E2E_ADMIN_PASSWORD'));
  await page.getByRole('button', { name: /^Login( as Admin)?$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await page.goto('/admin');
  await page.getByPlaceholder('Search by title or author...').fill('Guard Book Hotel');
  const row = page.locator('tr', { hasText: 'Guard Book Hotel' }).first();
  await row.getByTitle('Actions').click();
  await page.getByRole('menuitem', { name: 'Delete Request' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const toast = page.getByText('Request deleted; files kept: folder contents changed since import');
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await snap(page, c.dir, 'files-kept-toast');
  c.check('folder still there', exists(b.folder), 'safety');
  finish(c);
});

test('R1 ABS item of a second copy outside the RMAB folder survives; the RMAB folder goes', async () => {
  const c = new Case('R1-abs-second-copy');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'r1', 'Guard Book India', 'Guard Author India', 'B0LDGTRI01');
  const copy = `${MEDIA}/Copies/Guard Book India Copy`;
  genAudio(copy, ['Copy.m4b']);
  const copyItem = await linkAbs(b.audiobookId, copy);
  const copyBefore = sh(`cd ${q(copy)} && sha256sum * | sort`);

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  expectRemoved(c, 'delete', res, b.folder);
  c.check('ABS item of the copy still there', await absItemExists(copyItem), 'safety');
  c.check('copy files unchanged', sh(`cd ${q(copy)} && sha256sum * | sort`) === copyBefore, 'safety');
  finish(c);
});

test('R3 coerced single-file .m4a import (renamed .m4b): delete removes the folder', async () => {
  const c = new Case('R3-coerced-m4a');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'r3', 'Guard Book Juliett', 'Guard Author Juliett', 'B0LDGTRJ01', ['Book.m4a']);
  const files = sh(`ls ${q(b.folder)}`);
  c.save('folder.txt', files);
  c.check(`coercion renamed the audio to .m4b (${files.replace(/\n/g, ', ')})`, /\.m4b/.test(files) && !/\.m4a/.test(files), 'control');
  c.check(`row fileFormat m4b (${bookRow(b.audiobookId).fileFormat})`, bookRow(b.audiobookId).fileFormat === 'm4b', 'control');

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  expectRemoved(c, 'delete', res, b.folder);
  finish(c);
});

test('R4 a re-run organize of the same source (files already in place): delete removes the folder', async () => {
  const c = new Case('R4-rerun-organize');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'r4', 'Guard Book Kilo', 'Guard Author Kilo', 'B0LDGTRK01', ['Part 1.m4a', 'Part 2.m4a']);
  const hashBefore = bookRow(b.audiobookId).filesHash;
  const again = await importAudio(c, rmab, b.audiobookId, `${SRC}/r4`, 'audio-again');
  c.check(`re-run kept the files hash (${bookRow(b.audiobookId).filesHash.slice(0, 12)})`, !!hashBefore && bookRow(b.audiobookId).filesHash === hashBefore, 'control');

  const res = await deleteRequest(c, rmab, again, 'delete');
  expectRemoved(c, 'delete', res, b.folder);
  finish(c);
});

test('R5 ebook delete in a flat folder holding one RMAB ebook and foreign ebooks: refused; every ebook stays', async () => {
  const c = new Case('R5-flat-folder-foreign-ebooks');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'r5', 'Guard Book Lima', 'Guard Author Lima', 'B0LDGTRL01');
  const shelf = `${MEDIA}/Shelf`;
  genEbook(shelf, 'Calibre One.epub');
  genEbook(shelf, 'Calibre Two.epub');
  setConfig('ebook_path_template', 'Shelf');
  genEbook(`${SRC}/r5-ebook`, 'Lima.epub');
  const ebookReq = await importEbook(c, b.audiobookId, `${SRC}/r5-ebook`);
  const before = mediaShas();

  const res = await deleteRequest(c, rmab, ebookReq, 'delete-ebook');
  expectKept(c, 'delete-ebook', res, 'holds 3 ebook files');
  c.check('/media unchanged (all three ebooks, the audio folder)', sameShas(before, mediaShas()), 'safety');
  finish(c);
});

test('R6 the folder cannot be removed (EACCES): no backend delete, row fields stay', async () => {
  const c = new Case('R6-remove-fails-eacces');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'r6', 'Guard Book Mike', 'Guard Author Mike', 'B0LDGTRM01');
  const abs = await linkAbs(b.audiobookId, b.folder);
  // A root-owned, read-only subfolder (no audio): the app user cannot remove what is inside it
  sh(`mkdir -p ${q(`${b.folder}/locked`)}\necho note > ${q(`${b.folder}/locked/note.txt`)}\nchown -R 0:0 ${q(`${b.folder}/locked`)}\nchmod 0555 ${q(`${b.folder}/locked`)}`);

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  expectKept(c, 'delete', res, 'partly removed (permission denied); remove the rest manually');
  c.check('ABS item still there', await absItemExists(abs), 'safety');
  const row = bookRow(b.audiobookId);
  c.check('row keeps file_path, files_hash and linkage', row.filePath === b.folder && !!row.filesHash && row.absItemId === abs, 'safety', JSON.stringify(row));
  c.check('locked subfolder still there', exists(`${b.folder}/locked/note.txt`), 'control');
  sh(`chmod 0755 ${q(`${b.folder}/locked`)}`);
  finish(c);
});

test('R7 media volume not mounted (media_dir emptied): delete keeps everything; row, linkage and ABS item stay', async () => {
  const c = new Case('R7-media-not-mounted');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'r7', 'Guard Book November', 'Guard Author November', 'B0LDGTRN01');
  const abs = await linkAbs(b.audiobookId, b.folder);
  // What the app sees when the share is not mounted yet: an empty media_dir
  emptyMediaDir();
  let res;
  try {
    c.check('media_dir is empty', sh(`ls -A ${q(MEDIA)} | wc -l`).trim() === '0', 'control');
    res = await deleteRequest(c, rmab, b.requestId, 'delete');
  } finally {
    restoreMediaDir();
  }
  expectKept(c, 'delete', res, 'is the media volume mounted?');
  c.check('folder back and intact', exists(`${b.folder}/Book.m4b`), 'safety');
  const row = bookRow(b.audiobookId);
  c.check('row keeps file_path, files_hash and linkage', row.filePath === b.folder && !!row.filesHash && row.absItemId === abs, 'safety', JSON.stringify(row));
  c.check('ABS item still there', await absItemExists(abs), 'safety');
  finish(c);
});

test('E-g2 replace after a refused delete (no active request, folder stored): 409, no ABS hard delete, files intact', async () => {
  const c = new Case('E-g2-replace-after-refused-delete');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, 'eg2', 'Guard Book Oscar', 'Guard Author Oscar', 'B0LDGTEG02');
  const abs = await linkAbs(b.audiobookId, b.folder);
  genAudio(b.folder, ['Bonus Track.m4a'], 3, 880);
  const del = await deleteRequest(c, rmab, b.requestId, 'delete');
  expectKept(c, 'delete', del, 'folder contents changed since import');
  const issueId = psql(
    `insert into reported_issues (id, audiobook_id, reporter_id, reason, status, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(b.audiobookId)}, ${sqlStr(psql(`select id from users where role = 'admin' order by created_at limit 1`))}, 'e2e: wrong edition', 'open', now(), now()) returning id`
  ).split('\n')[0];
  const before = mediaShas();

  const res = await rmab.raw('POST', `/api/admin/reported-issues/${issueId}/replace`, {
    torrent: { guid: 'e2e-replace-2', title: 'Guard Book Oscar', size: 50_000_000, indexer: 'E2E', downloadUrl: 'magnet:?xt=urn:btih:89abcdef0123456789abcdef0123456789abcdef&dn=oscar', publishDate: new Date().toISOString() },
  });
  const body = await res.json().catch(() => ({}));
  c.save('replace-response.json', { status: res.status, body });
  c.check(`replace answered 409 (HTTP ${res.status})`, res.status === 409, 'safety', JSON.stringify(body));
  c.check(`message: nothing was changed (${body.message})`, String(body.message || '').includes('Nothing was changed'), 'control');
  c.check('/media unchanged (no ABS hard delete)', sameShas(before, mediaShas()), 'safety');
  c.check('ABS item still there', await absItemExists(abs), 'safety');
  c.check('no new request', psql(`select count(*) from requests where audiobook_id = ${sqlStr(b.audiobookId)} and deleted_at is null`) === '0', 'safety');
  c.check('issue still open', psql(`select status from reported_issues where id = ${sqlStr(issueId)}`) === 'open', 'control');
  finish(c);
});
