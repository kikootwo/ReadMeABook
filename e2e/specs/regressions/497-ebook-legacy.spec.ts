/**
 * Component: E2E regression #497 across an upgrade (ebook requests imported before the placement record)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * run.mjs --upgrade-from 1.2.12 --upgrade-specs 497-ebook-legacy runs this file on the release image
 * (E2E_PHASE=upgrade-seed), then on the branch image on the same volumes (upgrade-verify).
 *   seed:   L1 an audiobook + a delivered ebook import (the release copies the epub, keeps no record);
 *           L2 an audiobook + the user's own epub in its folder + a failed ebook request (SQL);
 *           L3 an audiobook + a pending ebook request (SQL), imported only after the upgrade.
 *   verify: requests.placed_ebook_files exists and is NULL on all three. Deleting L1 removes nothing
 *           and says it was imported before RMAB kept records; deleting L2 removes nothing, no reason.
 *           L3's import (into the existing row: no new requests or audiobooks row) records its epub,
 *           and deleting L3 removes only that file. run.mjs checks the row counts are unchanged.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import {
  PUID, PGID, sh, q, psql, sqlStr, Case, exists, setConfig, newBook, bookRow, genAudio, genEbook, importAudio, importEbook,
  organizeEbookInto, deleteRequest, mediaShas, sameShas, adminUserId,
} from './library-delete-helpers';
import { LEGACY_REASON, hasPlacedColumn, placedRecord, requestRow, sha256 } from './497-helpers';

const phase = process.env.E2E_PHASE;
const SRC = '/downloads/manual/e2e-497-legacy';
const BOOKS = {
  l1: { title: 'Ebook Legacy One', author: 'Ebook Legacy Author', asin: 'B0E497L001' },
  l2: { title: 'Ebook Legacy Two', author: 'Ebook Legacy Author', asin: 'B0E497L002' },
  l3: { title: 'Ebook Legacy Three', author: 'Ebook Legacy Author', asin: 'B0E497L003' },
};

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(phase !== 'upgrade-seed' && phase !== 'upgrade-verify', '497-ebook-legacy only runs via run.mjs --upgrade-from --upgrade-specs');

function finish(c: Case) {
  expect(c.finish()).toEqual([]);
}

async function importedBook(c: Case, rmab: Rmab, key: keyof typeof BOOKS) {
  const { title, author, asin } = BOOKS[key];
  const audiobookId = newBook(title, author, asin);
  genAudio(`${SRC}/${key}`, ['Book.m4b']);
  const requestId = await importAudio(c, rmab, audiobookId, `${SRC}/${key}`, `${key}-audio`);
  const folder = bookRow(audiobookId).filePath;
  c.check(`${key}: imported into the library (${folder})`, !!folder && exists(folder), 'control');
  return { audiobookId, requestId, folder };
}

function insertEbookRequest(audiobookId: string, parentId: string, status: string): string {
  return psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, parent_request_id, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(audiobookId)}, 'ebook', ${sqlStr(status)}, 0, ${sqlStr(parentId)}, now(), now()) returning id`
  ).split('\n')[0];
}

/** The newest active ebook request of the seeded book (the one the seed made), and the book row id. */
function seeded(key: keyof typeof BOOKS): { requestId: string; audiobookId: string; folder: string } {
  const audiobookId = psql(`select id from audiobooks where audible_asin = ${sqlStr(BOOKS[key].asin)}`);
  const requestId = psql(
    `select id from requests where audiobook_id = ${sqlStr(audiobookId)} and type = 'ebook' and deleted_at is null order by created_at desc limit 1`
  );
  return { requestId, audiobookId, folder: bookRow(audiobookId).filePath };
}

test('497 upgrade-seed: ebook requests on the release image (no placement record)', async () => {
  test.skip(phase !== 'upgrade-seed');
  test.setTimeout(15 * 60_000);
  const c = new Case('497-legacy-seed');
  setConfig('ebook_path_template', null);
  sh(`mkdir -p ${q(SRC)}\nchown ${PUID}:${PGID} /downloads/manual ${q(SRC)} 2>/dev/null || true`);
  const rmab = await Rmab.loginAdmin();
  c.check('the release image has no placed_ebook_files column', !hasPlacedColumn(), 'control');

  const l1 = await importedBook(c, rmab, 'l1');
  genEbook(`${SRC}/l1-ebook`, 'Book.epub');
  const l1Ebook = await importEbook(c, l1.audiobookId, `${SRC}/l1-ebook`, 'l1-ebook');
  c.check(`L1: the release imported the epub (${requestRow(l1Ebook).status})`, exists(`${l1.folder}/Book.epub`) && requestRow(l1Ebook).status === 'downloaded', 'control');

  const l2 = await importedBook(c, rmab, 'l2');
  genEbook(l2.folder, 'Book.epub');
  insertEbookRequest(l2.audiobookId, l2.requestId, 'failed');

  const l3 = await importedBook(c, rmab, 'l3');
  insertEbookRequest(l3.audiobookId, l3.requestId, 'pending');

  c.save('media-after-seed.json', mediaShas());
  finish(c);
});

test('497 upgrade-verify: legacy ebook requests delete nothing; a new import records and deletes only its file', async () => {
  test.skip(phase !== 'upgrade-verify');
  test.setTimeout(15 * 60_000);
  const c = new Case('497-legacy-verify');
  const rmab = await Rmab.loginAdmin();
  const l1 = seeded('l1');
  const l2 = seeded('l2');
  const l3 = seeded('l3');
  c.save('seeded.json', { l1, l2, l3 });
  c.check('all three ebook requests survived the upgrade', !!l1.requestId && !!l2.requestId && !!l3.requestId, 'safety');
  c.check('requests.placed_ebook_files exists', hasPlacedColumn(), 'safety');
  for (const [key, s] of Object.entries({ l1, l2, l3 })) {
    c.check(`${key}: placed_ebook_files is NULL (${JSON.stringify(placedRecord(s.requestId))})`, placedRecord(s.requestId) === 'NULL', 'safety');
  }
  const l1Epub = `${l1.folder}/Book.epub`;
  const before = mediaShas();
  c.save('media-before.json', before);

  const r1 = await deleteRequest(c, rmab, l1.requestId, 'delete-l1');
  c.check('L1: filesDeleted false', r1.details.filesDeleted === false, 'safety', JSON.stringify(r1.details));
  c.check(`L1: reason says imported before records (${r1.details.filesKeptReason})`, r1.details.filesKeptReason === LEGACY_REASON, 'safety');
  c.check('L1: its epub is still there', exists(l1Epub), 'safety');

  const r2 = await deleteRequest(c, rmab, l2.requestId, 'delete-l2');
  c.check('L2: filesDeleted false, no reason (never delivered)', r2.details.filesDeleted === false && !r2.details.filesKeptReason, 'safety', JSON.stringify(r2.details));
  c.check('/media unchanged by sha256 after both legacy deletes', sameShas(before, mediaShas()), 'safety');

  sh(`mkdir -p ${q(SRC)}\nchown ${PUID}:${PGID} /downloads/manual ${q(SRC)} 2>/dev/null || true`);
  genEbook(`${SRC}/l3-ebook`, 'Book.epub');
  await organizeEbookInto(c, l3.requestId, l3.audiobookId, `${SRC}/l3-ebook`, 'l3-ebook');
  const l3Epub = `${l3.folder}/Book.epub`;
  const record = placedRecord(l3.requestId);
  c.save('l3-record.json', record);
  c.check(`L3: request downloaded (${requestRow(l3.requestId).status})`, requestRow(l3.requestId).status === 'downloaded', 'control');
  c.check(
    'L3: the record holds the placed epub (path, sha256)',
    Array.isArray(record) && record.length === 1 && record[0].path === l3Epub && record[0].sha256 === sha256(l3Epub),
    'safety',
    JSON.stringify(record)
  );
  const beforeL3 = mediaShas([l3Epub]);

  const r3 = await deleteRequest(c, rmab, l3.requestId, 'delete-l3');
  c.check('L3: filesDeleted true, no reason', r3.details.filesDeleted === true && !r3.details.filesKeptReason, 'safety', JSON.stringify(r3.details));
  c.check('L3: its epub is gone', !exists(l3Epub), 'safety');
  c.check('everything else under /media unchanged', sameShas(beforeL3, mediaShas()), 'safety');
  finish(c);
});
