/**
 * Component: E2E library delete guard, Plex mode (run with --backend plex)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * fake Plex lists <media>/audiobooks/<Author>/<Title ASIN> folders as albums (its DELETE removes the
 * folder, like Plex with media deletion allowed) and keeps an album's file paths until a refresh,
 * like Plex's database. The book is linked to the album guid RMAB's library scan stored. Checks the
 * recorded DELETE /library/metadata/<key> calls: none when files are kept, none for an album whose
 * files lie outside the removed folder, one when the album lived in it.
 */

import { test, expect } from '@playwright/test';
import { env, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, waitFor, Rmab } from '../../lib/harness';
import {
  MEDIA, PUID, PGID, sh, q, psql, sqlStr, Case, exists, newBook, bookRow, genAudio, importAudio, deleteRequest, mediaShas, sameShas, emptyMediaDir, restoreMediaDir,
} from './library-delete-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(env('E2E_BACKEND') !== 'plex', 'needs --backend plex');
test.describe.configure({ mode: 'default' });

const SRC = '/downloads/manual/libdel-plex';

function finish(c: Case) {
  expect(c.finish()).toEqual([]);
}

/** Album guid and rating key RMAB's Plex library scan stored for an ASIN. */
async function scannedAlbum(rmab: Rmab, asin: string): Promise<{ guid: string; ratingKey: string }> {
  return waitFor(
    `plex_library row for ${asin}`,
    async () => {
      await rmab.triggerScheduledJob('plex_library_scan').catch(() => undefined);
      const row = psql(`select plex_guid, coalesce(plex_rating_key,'') from plex_library where plex_guid like ${sqlStr(`%${asin}%`)} limit 1`);
      const [guid, ratingKey] = row.split('\t');
      return guid && ratingKey ? { guid, ratingKey } : null;
    },
    { timeoutMs: 120_000, intervalMs: 5_000 }
  );
}

async function plexBook(c: Case, rmab: Rmab, key: string, title: string, author: string, asin: string) {
  const audiobookId = newBook(title, author, asin);
  genAudio(`${SRC}/${key}`, ['Book.m4b']);
  const requestId = await importAudio(c, rmab, audiobookId, `${SRC}/${key}`);
  const folder = bookRow(audiobookId).filePath;
  c.check(`${key}: imported (${folder})`, !!folder && exists(folder), 'control');
  return { audiobookId, requestId, folder };
}

const lastSeq = async () => (await fakeArr.requests()).reduce((m, r) => Math.max(m, r.seq), 0);
const plexDeletes = async (since: number) =>
  (await fakeArr.requests(since)).filter((r) => r.service === 'plex' && r.method === 'DELETE' && r.path.startsWith('/library/metadata/'));

test.beforeEach(() => {
  sh(`mkdir -p ${q(SRC)}\nchown ${PUID}:${PGID} /downloads/manual ${q(SRC)} 2>/dev/null || true`);
});

test('P1 files kept (foreign audio): no DELETE /library/metadata, album folder intact', async () => {
  const c = new Case('P1-plex-files-kept');
  const rmab = await Rmab.loginAdmin();
  const b = await plexBook(c, rmab, 'p1', 'Plex Guard One', 'Plex Guard Author One', 'B0LDGTP101');
  const album = await scannedAlbum(rmab, 'B0LDGTP101');
  psql(`update audiobooks set plex_guid = ${sqlStr(album.guid)} where id = ${sqlStr(b.audiobookId)}`);
  genAudio(b.folder, ['Bonus Track.m4a'], 3, 880);
  const before = mediaShas();
  const seq = await lastSeq();

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  c.check(`files kept (${res.details.filesKeptReason})`, (res.details.filesKeptReason || '').includes('folder contents changed since import'), 'safety');
  const deletes = await plexDeletes(seq);
  c.save('plex-deletes.json', deletes);
  c.check('no DELETE /library/metadata sent to Plex', deletes.length === 0, 'safety');
  c.check('/media unchanged', sameShas(before, mediaShas()), 'safety');
  c.check('plex_guid kept', bookRow(b.audiobookId).plexGuid === album.guid, 'control');
  finish(c);
});

test('P2 folder removed by RMAB: the album that lived in it is deleted from Plex', async () => {
  const c = new Case('P2-plex-album-inside');
  const rmab = await Rmab.loginAdmin();
  const b = await plexBook(c, rmab, 'p2', 'Plex Guard Two', 'Plex Guard Author Two', 'B0LDGTP201');
  const album = await scannedAlbum(rmab, 'B0LDGTP201');
  psql(`update audiobooks set plex_guid = ${sqlStr(album.guid)} where id = ${sqlStr(b.audiobookId)}`);
  const before = mediaShas([b.folder]);
  const seq = await lastSeq();

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  c.check('filesDeleted true', res.details.filesDeleted === true && !res.details.filesKeptReason, 'safety', JSON.stringify(res.details));
  c.check('title folder removed', !exists(b.folder), 'safety');
  const deletes = await plexDeletes(seq);
  c.save('plex-deletes.json', deletes);
  c.check(`DELETE /library/metadata/${album.ratingKey} sent`, deletes.some((d) => d.path === `/library/metadata/${album.ratingKey}`), 'control');
  c.check('nothing else under /media changed', sameShas(before, mediaShas([b.folder])), 'safety');
  finish(c);
});

test('P3 the linked album is a copy outside the removed folder: no Plex DELETE, the copy survives', async () => {
  const c = new Case('P3-plex-album-outside');
  const rmab = await Rmab.loginAdmin();
  const b = await plexBook(c, rmab, 'p3', 'Plex Guard Three', 'Plex Guard Author Three', 'B0LDGTP301');
  const copy = `${MEDIA}/Plex Copies/Plex Guard Three Copy B0LDGTP302`;
  genAudio(copy, ['Copy.m4b']);
  const copyAlbum = await scannedAlbum(rmab, 'B0LDGTP302');
  psql(`update audiobooks set plex_guid = ${sqlStr(copyAlbum.guid)} where id = ${sqlStr(b.audiobookId)}`);
  const copyBefore = sh(`cd ${q(copy)} && sha256sum * | sort`);
  const seq = await lastSeq();

  const res = await deleteRequest(c, rmab, b.requestId, 'delete');
  c.check('RMAB folder removed', res.details.filesDeleted === true && !exists(b.folder), 'safety', JSON.stringify(res.details));
  const deletes = await plexDeletes(seq);
  c.save('plex-deletes.json', deletes);
  c.check('no DELETE for the copy album', !deletes.some((d) => d.path === `/library/metadata/${copyAlbum.ratingKey}`), 'safety');
  c.check('copy files unchanged', exists(copy) && sh(`cd ${q(copy)} && sha256sum * | sort`) === copyBefore, 'safety');
  finish(c);
});

test('P4 media volume not mounted (media_dir emptied): no Plex DELETE, row and plex_guid stay', async () => {
  const c = new Case('P4-plex-media-not-mounted');
  const rmab = await Rmab.loginAdmin();
  const b = await plexBook(c, rmab, 'p4', 'Plex Guard Four', 'Plex Guard Author Four', 'B0LDGTP401');
  const album = await scannedAlbum(rmab, 'B0LDGTP401');
  psql(`update audiobooks set plex_guid = ${sqlStr(album.guid)} where id = ${sqlStr(b.audiobookId)}`);
  emptyMediaDir();
  const seq = await lastSeq();
  let res;
  try {
    res = await deleteRequest(c, rmab, b.requestId, 'delete');
  } finally {
    restoreMediaDir();
  }
  c.check(`files kept (${res.details.filesKeptReason})`, (res.details.filesKeptReason || '').includes('is the media volume mounted?'), 'safety');
  const deletes = await plexDeletes(seq);
  c.save('plex-deletes.json', deletes);
  c.check('no DELETE /library/metadata sent to Plex', deletes.length === 0, 'safety');
  c.check('folder back and intact', exists(`${b.folder}/Book.m4b`), 'safety');
  c.check('plex_guid and file_path kept', bookRow(b.audiobookId).plexGuid === album.guid && bookRow(b.audiobookId).filePath === b.folder, 'safety');
  finish(c);
});
