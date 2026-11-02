/**
 * Component: E2E regression #423 (RMAB never removes a torrent it did not add)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Inline scenario, three torrent releases on indexer 1 (seeding rule: 1 minute, no ratio):
 *   B martian  grabbed normally: RMAB adds it, so the seeding cleanup removes it once seeded.
 *   A artemis  already in qBittorrent (seeded 2 days before the grab, category "manual"): request kept.
 *   C phm      already in qBittorrent the same way: its request is deleted by an admin.
 * Expect: A and C are recorded as not RMAB's (added_by_rmab = false), the request delete leaves C in
 * the client, the cleanup removes B only, a later delete of A's request leaves A in the client, and
 * A's and C's files keep the fixture's sha256.
 * Fails before the fix: the grab writes no ownership, the delete and the cleanup remove A and C.
 */

import { test, expect } from '@playwright/test';
import { fakeArr, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import { psql, sqlStr, markJobs, eventsSince, fmtEvents, CaseRun, requestState } from './242-helpers';
import {
  takeoverScenario, loadScenario, seedTakeover, setSeeding, folderShas, fixtureShas, downloadRow, requestExists,
  waitDownloaded, waitAvailable, waitSeeded, runCleanup, qbitDeletes, lastSeq, clientHas, hasOwnershipColumn,
} from './423-helpers';

// Needs docker exec into the stack (sha256 snapshots, psql): untainted runs only.
test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(Boolean(process.env.E2E_PHASE?.startsWith('upgrade')), 'stack runs only (423-upgrade covers the upgrade)');

test('423 a torrent already in the client is never removed; RMAB still removes its own', async () => {
  test.setTimeout(25 * 60_000);
  const c = new CaseRun('takeover', '423');
  const def = takeoverScenario('takeover-423', { b: 'martian', a: 'artemis', c: 'phm' });
  await loadScenario(def);
  const books = await fakeArr.books();
  const rmab = await Rmab.loginAdmin();
  c.save('scenario-definition.json', def);
  c.save('indexer-config.json', await setSeeding(rmab, 1));

  const seededA = await seedTakeover('a');
  const seededC = await seedTakeover('c');
  c.save('seeded.json', { a: seededA, c: seededC });
  const fixtureA = fixtureShas('artemis');
  const fixtureC = fixtureShas('phm');
  c.check('A seeded with the fixture files', !!fixtureA && folderShas(seededA.contentPath) === fixtureA, 'control');
  c.check('C seeded with the fixture files', !!fixtureC && folderShas(seededC.contentPath) === fixtureC, 'control');

  // Grab all three for real (search, grab, download, organize)
  const since = markJobs();
  const ids: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
  for (const [key, book] of [['b', 'martian'], ['a', 'artemis'], ['c', 'phm']] as const) {
    ids[key] = (await rmab.requestBook(books[book])).request.id;
  }
  for (const id of Object.values(ids)) await waitDownloaded(id);
  const state = await fakeArr.state();
  const tB = state.torrents.find((t: any) => t.releaseId === 'b');
  c.save('after-grab.json', { ids, torrents: state.torrents, rows: Object.values(ids).map(requestState) });

  const column = hasOwnershipColumn();
  c.check('download_history.added_by_rmab exists', column, 'safety');
  const row = (k: 'a' | 'b' | 'c') => downloadRow(ids[k]);
  c.check(`B recorded as RMAB's (${row('b')?.addedByRmab})`, row('b')?.addedByRmab === 'true', 'safety');
  c.check(`A recorded as not RMAB's (${row('a')?.addedByRmab})`, row('a')?.addedByRmab === 'false', 'safety');
  c.check(`C recorded as not RMAB's (${row('c')?.addedByRmab})`, row('c')?.addedByRmab === 'false', 'safety');
  c.check('A grabbed by its existing hash', row('a')?.hash === seededA.hash, 'control');

  // Admin deletes C's request: the download handling must leave C alone
  const beforeDelete = await lastSeq();
  const del = await rmab.raw('DELETE', `/api/admin/requests/${ids.c}`);
  const delBody = await del.json().catch(() => null);
  c.save('delete-c-response.json', { status: del.status, body: delBody });
  c.check(`delete C: HTTP ${del.status}`, del.ok, 'control');
  c.check(`delete C: torrentsKeptNotOwned = 1 (${delBody?.details?.torrentsKeptNotOwned})`, delBody?.details?.torrentsKeptNotOwned === 1, 'safety');
  c.check(`delete C: torrentsRemoved = 0 (${delBody?.details?.torrentsRemoved})`, delBody?.details?.torrentsRemoved === 0, 'safety');
  const deleteCalls = await qbitDeletes(beforeDelete);
  c.check('delete C: no qBittorrent torrents/delete call', deleteCalls.length === 0, 'safety', JSON.stringify(deleteCalls));
  c.check('C still in the client after the request delete', await clientHas(seededC.hash), 'safety');

  // A and B become available (the seeding cleanup only looks at available requests); B seeds 1 minute
  await waitAvailable(rmab, [{ requestId: ids.a, title: books.artemis.title }, { requestId: ids.b, title: books.martian.title }]);
  if (tB) await waitSeeded(tB.hash, 65);

  const beforeCleanup = await lastSeq();
  const job = await runCleanup(rmab);
  c.save('cleanup-job.tsv', `${job}\n`);
  const cleanupDeletes = await qbitDeletes(beforeCleanup);
  c.save('qbit-deletes.json', cleanupDeletes);
  const removed = cleanupDeletes.flatMap((d) => d.hashes);
  c.check(`cleanup removed B with its files (${JSON.stringify(cleanupDeletes)})`, !!tB && cleanupDeletes.some((d) => d.hashes.includes(tB.hash) && d.deleteFiles), 'control');
  c.check('cleanup removed nothing but B', !!tB && removed.every((h) => h === tB.hash), 'safety');
  c.check('A still in the client', await clientHas(seededA.hash), 'safety');
  c.check('C still in the client', await clientHas(seededC.hash), 'safety');
  c.check('A files unchanged (sha256 = fixture)', folderShas(seededA.contentPath) === fixtureA, 'safety');
  c.check('C files unchanged (sha256 = fixture)', folderShas(seededC.contentPath) === fixtureC, 'safety');
  c.check(`B's row marked removed (${row('b')?.status})`, row('b')?.status === 'removed', 'control');
  c.check(`A's row kept: completed, not RMAB's (${row('a')?.status}, ${row('a')?.addedByRmab})`, row('a')?.status === 'completed' && row('a')?.addedByRmab === 'false', 'safety');
  c.check('C\'s soft-deleted request hard-deleted without touching the client', !requestExists(ids.c), 'control');

  // Admin deletes A's request too (available, seeding long met): A stays in the client
  const beforeDeleteA = await lastSeq();
  const delA = await rmab.raw('DELETE', `/api/admin/requests/${ids.a}`);
  const delABody = await delA.json().catch(() => null);
  c.save('delete-a-response.json', { status: delA.status, body: delABody });
  c.check(`delete A: torrentsKeptNotOwned = 1, torrentsRemoved = 0 (${JSON.stringify(delABody?.details)})`, delABody?.details?.torrentsKeptNotOwned === 1 && delABody?.details?.torrentsRemoved === 0, 'safety');
  c.check('delete A: no qBittorrent torrents/delete call', (await qbitDeletes(beforeDeleteA)).length === 0, 'safety');
  c.check('A still in the client after its request delete, files unchanged', (await clientHas(seededA.hash)) && folderShas(seededA.contentPath) === fixtureA, 'safety');

  const events = eventsSince(since);
  c.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  c.save('fake-qbit-torrents.json', (await fakeArr.state()).torrents);
  c.save('download-rows.tsv', `${psql(`select request_id, ${column ? 'coalesce(added_by_rmab::text, \'null\')' : "'no column'"}, coalesce(download_status, ''), coalesce(torrent_hash, '') from download_history where request_id in (${Object.values(ids).map(sqlStr).join(',')}) order by created_at`)}\n`);
  c.check('log: takeover warning at the grab', events.some((e) => e.message.includes('RMAB will never remove it or its files')), 'log');

  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});
