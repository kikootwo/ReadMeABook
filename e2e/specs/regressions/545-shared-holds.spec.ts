/**
 * Component: E2E regression #545 (shared torrents: who keeps a torrent and until when)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Inline scenario: three torrent releases on indexer 1 "E2E Torrents" (seeds 1 min); indexer 3 "Slow"
 * seeds 600 min. The admin requests all three books for real (grab, download, organize, available).
 * A second (local) user's requests on the same books are written into the DB with a selected row on the
 * same torrent. A and B pair the admin's row (added_by_rmab true) with a legacy NULL row grabbed at the
 * same time; the product can't make that exact pair (NULL rows predate the column), but every verdict is
 * the one for two legacy rows inside the ownership window, or two v1.2.11 duplicate rows, which it can:
 *   A artemis: R2 soft-deleted on Slow, a legacy row (added_by_rmab NULL) grabbed with the same torrent.
 *   B martian: R5 cancelled before cancelled_at existed (NULL), legacy row grabbed with it, on Slow.
 *   C phm:     R9 cancelled (NULL) and R10 soft-deleted, both took the torrent over (false), on Slow.
 * Cleanup 1: A kept (R2 still seeds), B kept (R5 still seeds), C removed (rows that took it over never keep it).
 * Admin delete of A's request: kept (torrentsKeptShared 1), its row stays completed.
 * Slow set to 1 min, cleanup 2: A removed through the deleted owner, B removed (R5 met).
 * Fails before the fix: cleanup 1 removes A (deleted requests ignored) and keeps C forever; B is never removed.
 * Covers the seeding cleanup and request delete only; the cancel step's holds and the `until_met` hold of an
 * active request that took the torrent over are covered by unit tests.
 */

import { test, expect } from '@playwright/test';
import { fakeArr, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import { psql, sqlStr, markJobs, eventsSince, fmtEvents, CaseRun, requestState } from './242-helpers';
import {
  loadScenario, folderShas, downloadRow, requestExists, waitDownloaded, waitAvailable, waitSeeded, runCleanup, qbitDeletes, lastSeq, clientHas,
} from './423-helpers';
import { registerReader, cleanupCounts } from './506-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(Boolean(process.env.E2E_PHASE?.startsWith('upgrade')), 'stack runs only');

const FAST = { id: 1, name: 'E2E Torrents' };
const SLOW = { id: 3, name: 'Slow' };
const TITLE = '{{author}} - {{title}} (Unabridged) [MP3 64kbps]';

const scenario = {
  name: 'shared-holds-545',
  description: 'Three torrents on indexer 1; indexer 3 (Slow) has no releases and a long seeding rule (#545).',
  indexers: [{ ...FAST, protocol: 'torrent', priority: 25 }, { ...SLOW, protocol: 'torrent', priority: 25 }],
  releases: [['a', 'artemis'], ['b', 'martian'], ['c', 'phm']].map(([id, book]) => ({
    id, book, title: TITLE, sizeMB: 420, seeders: 60, fixture: `${book}-mp3`,
  })),
};

/** Seeding rules saved the way the Settings page does (GET, then PUT the list) */
async function setRules(rmab: Rmab, fastMinutes: number, slowMinutes: number) {
  const body = await rmab.get<{ indexers: any[]; flagConfigs: any[] }>('/api/admin/settings/prowlarr/indexers');
  const rule = (minutes: number) => ({ enabled: true, seedingTimeMinutes: minutes, ratioLimit: 0, removeAfterProcessing: false });
  const indexers = body.indexers.map((i) => (i.id === FAST.id ? { ...i, ...rule(fastMinutes) } : i.id === SLOW.id ? { ...i, ...rule(slowMinutes) } : i));
  const res = await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers, flagConfigs: body.flagConfigs });
  if (!res.ok) throw new Error(`PUT indexers: HTTP ${res.status} ${await res.text()}`);
  return psql(`select value from configuration where key = 'prowlarr_indexers'`);
}

interface Sibling {
  userId: string;
  ownerRequestId: string;
  status: 'cancelled' | 'available';
  deleted: boolean;
  /** 'legacy': added_by_rmab NULL, grabbed with the owner's row; 'taken-over': false, grabbed now */
  row: 'legacy' | 'taken-over';
}

/** Another user's request on the owner's book, with a selected completed row on the same torrent (Slow) */
function insertSibling(s: Sibling): string {
  const owner = `(select %s from download_history where request_id = ${sqlStr(s.ownerRequestId)} and selected order by created_at desc limit 1)`;
  const createdAt = s.row === 'legacy' ? owner.replace('%s', 'created_at') : 'now()';
  return psql(
    `with r as (
       insert into requests (id, user_id, audiobook_id, type, status, progress, deleted_at, created_at, updated_at)
       select gen_random_uuid(), ${sqlStr(s.userId)}, audiobook_id, 'audiobook', ${sqlStr(s.status)}, 100, ${s.deleted ? 'now()' : 'null'}, now(), now()
       from requests where id = ${sqlStr(s.ownerRequestId)} returning id
     )
     insert into download_history (id, request_id, indexer_name, indexer_id, torrent_name, torrent_hash, selected, download_client,
       download_client_id, download_status, added_by_rmab, completed_at, created_at)
     select gen_random_uuid(), r.id, ${sqlStr(SLOW.name)}, ${SLOW.id}, 'e2e-545 sibling', ${owner.replace('%s', 'torrent_hash')}, true, 'qbittorrent',
       ${owner.replace('%s', 'download_client_id')}, 'completed', ${s.row === 'legacy' ? 'null' : 'false'}, now(), ${createdAt}
     from r returning request_id`
  ).split('\n')[0];
}

const deletedAt = (id: string) => psql(`select coalesce(deleted_at::text, '') from requests where id = ${sqlStr(id)}`);
/** The request's row on the torrent: 'gone' once the request is hard-deleted */
const rowStatus = (id: string) => (requestExists(id) ? downloadRow(id)?.status ?? '' : 'gone');
const deletesOf = (deletes: { hashes: string[] }[], hash: string) => deletes.filter((d) => d.hashes.includes(hash.toLowerCase()));

test('545 deleted and cancelled requests keep a shared torrent only through a row they own, until their own rule is met', async () => {
  test.setTimeout(30 * 60_000);
  const c = new CaseRun('shared-holds', '545');
  await loadScenario(scenario);
  c.save('scenario-definition.json', scenario);
  const books = await fakeArr.books();
  const rmab = await Rmab.loginAdmin();
  c.save('indexer-config-1.json', await setRules(rmab, 1, 600));

  // The admin's three requests, for real
  const since = markJobs();
  const r1 = (await rmab.requestBook(books.artemis)).request.id;
  const r4 = (await rmab.requestBook(books.martian)).request.id;
  const r8 = (await rmab.requestBook(books.phm)).request.id;
  for (const id of [r1, r4, r8]) await waitDownloaded(id);
  await waitAvailable(rmab, [
    { requestId: r1, title: books.artemis.title }, { requestId: r4, title: books.martian.title }, { requestId: r8, title: books.phm.title },
  ]);
  const state = await fakeArr.state();
  const torrent = (release: string) => state.torrents.find((t: any) => t.releaseId === release);
  const [tA, tB, tC] = [torrent('a'), torrent('b'), torrent('c')];
  c.check('three torrents in the client', !!tA && !!tB && !!tC, 'control');
  for (const [id, label] of [[r1, 'R1'], [r4, 'R4'], [r8, 'R8']] as const) {
    c.check(`${label} row recorded as RMAB's and completed (${JSON.stringify(downloadRow(id))})`, downloadRow(id)?.addedByRmab === 'true' && downloadRow(id)?.status === 'completed', 'control');
  }

  // The second user's requests on the same torrents
  const reader = await registerReader(rmab, 'e2e-545-reader');
  const r2 = insertSibling({ userId: reader.userId, ownerRequestId: r1, status: 'available', deleted: true, row: 'legacy' });
  const r5 = insertSibling({ userId: reader.userId, ownerRequestId: r4, status: 'cancelled', deleted: false, row: 'legacy' });
  const r9 = insertSibling({ userId: reader.userId, ownerRequestId: r8, status: 'cancelled', deleted: false, row: 'taken-over' });
  const r10 = insertSibling({ userId: reader.userId, ownerRequestId: r8, status: 'available', deleted: true, row: 'taken-over' });
  const ids = { r1, r2, r4, r5, r8, r9, r10 };
  c.save('ids.json', { ...ids, torrents: { a: tA, b: tB, c: tC } });
  c.save('rows-before.tsv', `${Object.values(ids).map(requestState).join('\n')}\n`);
  c.check('siblings written with the owners\' hashes', downloadRow(r2)?.hash === downloadRow(r1)?.hash && downloadRow(r5)?.hash === downloadRow(r4)?.hash && downloadRow(r9)?.hash === downloadRow(r8)?.hash, 'control');
  for (const t of [tA, tB, tC]) if (t) await waitSeeded(t.hash, 65);

  // Cleanup 1: A kept (a1), B kept (b2), C removed (b3 + a4)
  const before1 = await lastSeq();
  const job1 = await runCleanup(rmab);
  const deletes1 = await qbitDeletes(before1);
  c.save('cleanup-1.tsv', `${job1}\n`);
  c.save('cleanup-1-deletes.json', deletes1);
  c.save('rows-after-cleanup-1.tsv', `${Object.values(ids).map(requestState).join('\n')}\n`);
  c.check(`cleanup 1 completed without errors (${job1.split('\t')[0]}, errors ${cleanupCounts(job1)?.errors})`, job1.startsWith('completed') && cleanupCounts(job1)?.errors === 0, 'control');
  if (tA) {
    c.check('a1: no torrents/delete for A while the deleted R2 still seeds on Slow', deletesOf(deletes1, tA.hash).length === 0, 'safety', JSON.stringify(deletes1));
    c.check('a1: A still in the client', await clientHas(tA.hash), 'safety');
  }
  c.check(`a1: R1 row still completed (${rowStatus(r1)}), R2 still soft-deleted with its row (${rowStatus(r2)})`, rowStatus(r1) === 'completed' && rowStatus(r2) === 'completed' && !!deletedAt(r2), 'safety');
  if (tB) c.check('b2: no torrents/delete for B while the cancelled R5 still seeds on Slow', deletesOf(deletes1, tB.hash).length === 0 && await clientHas(tB.hash), 'safety');
  if (tC) {
    const del = deletesOf(deletes1, tC.hash);
    c.check(`b3/a4: C removed once with its files (${del.length} delete(s))`, del.length === 1 && del[0].deleteFiles && !(await clientHas(tC.hash)), 'safety', JSON.stringify(deletes1));
    c.check('b3/a4: C\'s download folder is gone', folderShas(tC.content_path) === '', 'safety');
  }
  c.check(`b3/a4: R8 and R9 rows removed (${rowStatus(r8)}, ${rowStatus(r9)}); R10 forgotten (${rowStatus(r10)})`, rowStatus(r8) === 'removed' && rowStatus(r9) === 'removed' && ['gone', 'removed'].includes(rowStatus(r10)), 'safety');
  const events1 = eventsSince(since);
  c.check('log: the cleanup names R2 and R5 as still needing their torrents', fmtEvents(events1).includes(`${r2} (deleted, still seeding for Slow`) && fmtEvents(events1).includes(`${r5} (cancelled, still seeding for Slow`), 'log');

  // a2: the admin deletes R1: the deleted R2 still keeps A
  const beforeDel = await lastSeq();
  const del = await rmab.raw('DELETE', `/api/admin/requests/${r1}`);
  const delBody = await del.json().catch(() => null);
  c.save('a2-delete-r1.json', { status: del.status, body: delBody });
  c.check(`a2: delete R1 kept A for R2 (HTTP ${del.status}, ${JSON.stringify(delBody?.details)})`, del.ok && delBody?.details?.torrentsKeptShared === 1 && delBody?.details?.torrentsRemoved === 0, 'safety');
  c.check('a2: no torrents/delete', (await qbitDeletes(beforeDel)).length === 0, 'safety');
  c.check(`a2: R1 soft-deleted, its row completed (${rowStatus(r1)})`, !!deletedAt(r1) && rowStatus(r1) === 'completed', 'safety');

  // Slow now seeds 1 minute: cleanup 2 removes A (a3) and B (b1)
  c.save('indexer-config-2.json', await setRules(rmab, 1, 1));
  const before2 = await lastSeq();
  const job2 = await runCleanup(rmab);
  const deletes2 = await qbitDeletes(before2);
  c.save('cleanup-2.tsv', `${job2}\n`);
  c.save('cleanup-2-deletes.json', deletes2);
  c.save('rows-after-cleanup-2.tsv', `${Object.values(ids).map(requestState).join('\n')}\n`);
  c.check(`cleanup 2 completed without errors (${job2.split('\t')[0]}, errors ${cleanupCounts(job2)?.errors})`, job2.startsWith('completed') && cleanupCounts(job2)?.errors === 0, 'control');
  if (tA) {
    const delA = deletesOf(deletes2, tA.hash);
    c.check(`a3: A removed exactly once with its files (${delA.length})`, delA.length === 1 && delA[0].deleteFiles && !(await clientHas(tA.hash)) && folderShas(tA.content_path) === '', 'safety', JSON.stringify(deletes2));
  }
  c.check(`a3: R1 and R2 hard-deleted or rows removed (${rowStatus(r1)}, ${rowStatus(r2)})`, ['gone', 'removed'].includes(rowStatus(r1)) && ['gone', 'removed'].includes(rowStatus(r2)), 'safety');
  if (tB) {
    const delB = deletesOf(deletes2, tB.hash);
    c.check(`b1: B removed once the cancelled R5's rule is met (${delB.length})`, delB.length === 1 && delB[0].deleteFiles && !(await clientHas(tB.hash)), 'safety', JSON.stringify(deletes2));
  }
  c.check(`b1: R4 and R5 rows removed (${rowStatus(r4)}, ${rowStatus(r5)})`, rowStatus(r4) === 'removed' && rowStatus(r5) === 'removed', 'safety');
  c.save('rmab-job-events.log', `${fmtEvents(eventsSince(since))}\n`);

  const failed = c.finish({ ids });
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});
