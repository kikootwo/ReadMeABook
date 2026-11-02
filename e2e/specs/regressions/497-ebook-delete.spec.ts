/**
 * Component: E2E regression #497 (an ebook request delete removes only the ebook file that request placed)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Audiobookshelf backend (default). Audiobooks are imported for real (manual import); ebook files are
 * placed by the app's own organize job (an ebook request + Bull organize_files job). Each case deletes
 * the ebook request through DELETE /api/admin/requests/<id> and checks /media by sha256.
 *   a. the user's own epub in an imported title folder + a failed ebook request (as the ebook search
 *      leaves it, SQL): delete removes nothing, no reason (the issue's steps).
 *   b. a real import of Book.epub beside the user's Book.azw3: the record holds the epub (its sha256);
 *      delete removes the epub only.
 *   c. the user's Book.epub in the title folder, then a real import of a same-name, same-size,
 *      different-bytes epub (placeFile 'present'): record [], request downloaded; delete keeps the
 *      user's file byte for byte and says why.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import {
  PUID, PGID, sh, q, psql, sqlStr, Case, exists, setConfig, newBook, bookRow, genAudio, genEbook, importAudio, importEbook,
  deleteRequest, mediaShas, sameShas, adminUserId, has, eventsSince,
} from './library-delete-helpers';
import { ALREADY_THERE_REASON, fillFile, placedRecord, requestRow, sha256 } from './497-helpers';
import { markJobs } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const SRC = '/downloads/manual/e2e-497';

function finish(c: Case) {
  expect(c.finish()).toEqual([]);
}

async function importedBook(c: Case, rmab: Rmab, key: string, title: string, author: string, asin: string) {
  const audiobookId = newBook(title, author, asin);
  genAudio(`${SRC}/${key}`, ['Book.m4b']);
  const requestId = await importAudio(c, rmab, audiobookId, `${SRC}/${key}`);
  const folder = bookRow(audiobookId).filePath;
  c.check(`${key}: imported into the library (${folder})`, !!folder && exists(folder), 'control');
  return { audiobookId, requestId, folder };
}

test.beforeEach(() => {
  setConfig('ebook_path_template', null);
  sh(`mkdir -p ${q(SRC)}\nchown ${PUID}:${PGID} /downloads/manual ${q(SRC)} 2>/dev/null || true`);
});

test('497a the user\'s epub beside an imported audiobook + a failed ebook request: delete removes nothing', async () => {
  const c = new Case('497-a-failed-request-user-epub');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, '497a', 'Ebook Delete Alpha', 'Ebook Author Alpha', 'B0E497A001');
  genEbook(b.folder, 'Ebook Delete Alpha.epub');
  const ebookReq = psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, parent_request_id, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(b.audiobookId)}, 'ebook', 'failed', 0, 'e2e fixture: no ebook found', ${sqlStr(b.requestId)}, now(), now()) returning id`
  ).split('\n')[0];
  c.check(`the failed request has no record (${JSON.stringify(placedRecord(ebookReq))})`, placedRecord(ebookReq) === 'NULL', 'control');
  const before = mediaShas();
  c.save('media-before.json', before);

  const res = await deleteRequest(c, rmab, ebookReq, 'delete-ebook');
  c.check('filesDeleted false, no filesKeptReason', res.details.filesDeleted === false && !res.details.filesKeptReason, 'safety', JSON.stringify(res.details));
  c.check(`message (${res.message})`, res.message === 'Request deleted successfully', 'control');
  c.check('/media unchanged by sha256 (the user\'s epub, the audiobook)', sameShas(before, mediaShas()), 'safety');
  c.check('request soft-deleted', requestRow(ebookReq).deleted, 'control');
  finish(c);
});

test('497b a real ebook import beside the user\'s azw3: the record holds the epub; delete removes only it', async () => {
  const c = new Case('497-b-recorded-epub-user-azw3');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, '497b', 'Ebook Delete Bravo', 'Ebook Author Bravo', 'B0E497B001');
  genEbook(b.folder, 'Book.azw3');
  genEbook(`${SRC}/497b-ebook`, 'Book.epub');
  const ebookReq = await importEbook(c, b.audiobookId, `${SRC}/497b-ebook`);
  const epub = `${b.folder}/Book.epub`;
  const record = placedRecord(ebookReq);
  c.save('record.json', record);
  c.check('the epub landed in the title folder', exists(epub), 'control');
  c.check(
    'record: one entry, the placed epub with its size and sha256',
    Array.isArray(record) && record.length === 1 && record[0].path === epub && record[0].sha256 === sha256(epub) && record[0].size > 0,
    'safety',
    JSON.stringify(record)
  );
  const before = mediaShas([epub]);

  const res = await deleteRequest(c, rmab, ebookReq, 'delete-ebook');
  c.check('filesDeleted true, no filesKeptReason', res.details.filesDeleted === true && !res.details.filesKeptReason, 'safety', JSON.stringify(res.details));
  c.check('the recorded epub is gone', !exists(epub), 'safety');
  c.check('everything else under /media unchanged (azw3, audio, cover)', sameShas(before, mediaShas()), 'safety');
  c.check('the user\'s azw3 is still there', exists(`${b.folder}/Book.azw3`), 'safety');
  finish(c);
});

test('497c a real import of a same-name, same-size, different-bytes epub: record [], downloaded; delete keeps the user\'s file', async () => {
  const c = new Case('497-c-present-not-recorded');
  const rmab = await Rmab.loginAdmin();
  const b = await importedBook(c, rmab, '497c', 'Ebook Delete Charlie', 'Ebook Author Charlie', 'B0E497C001');
  const userEpub = `${b.folder}/Book.epub`;
  fillFile(b.folder, 'Book.epub', 'the user own edition');
  fillFile(`${SRC}/497c-ebook`, 'Book.epub', 'the downloaded edition');
  const userSha = sha256(userEpub);
  c.check('same size, different bytes', sh(`stat -c %s ${q(userEpub)}`).trim() === sh(`stat -c %s ${q(`${SRC}/497c-ebook/Book.epub`)}`).trim() && userSha !== sha256(`${SRC}/497c-ebook/Book.epub`), 'control');
  const mark = markJobs();
  const ebookReq = await importEbook(c, b.audiobookId, `${SRC}/497c-ebook`);
  const events = eventsSince(mark);
  c.check('the organizer reported the epub as already there (present: not compared)', has(events, 'Ebook already exists at target, skipping copy: Book.epub'), 'log');
  const record = placedRecord(ebookReq);
  c.save('record.json', record);
  c.check(`record is [] (${JSON.stringify(record)})`, Array.isArray(record) && record.length === 0, 'safety');
  const row = requestRow(ebookReq);
  c.check(`request downloaded (${row.status})`, row.status === 'downloaded', 'safety');
  c.check('the user\'s epub unchanged by the import', sha256(userEpub) === userSha, 'safety');
  const before = mediaShas();

  const res = await deleteRequest(c, rmab, ebookReq, 'delete-ebook');
  c.check('filesDeleted false', res.details.filesDeleted === false, 'safety', JSON.stringify(res.details));
  c.check(`filesKeptReason says the ebook was already there (${res.details.filesKeptReason})`, res.details.filesKeptReason === ALREADY_THERE_REASON, 'safety');
  c.check(`message (${res.message})`, res.message === `Request deleted; files kept: ${ALREADY_THERE_REASON}`, 'control');
  c.check('the user\'s epub byte for byte', sha256(userEpub) === userSha, 'safety');
  c.check('/media unchanged by sha256', sameShas(before, mediaShas()), 'safety');
  finish(c);
});
