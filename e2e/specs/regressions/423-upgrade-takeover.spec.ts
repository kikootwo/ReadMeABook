/**
 * Component: E2E regression #423 across an upgrade (rows from before the fix carry no ownership)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * run.mjs --upgrade-from <tag> --upgrade-specs 423-upgrade runs this file on the release image
 * (E2E_PHASE=upgrade-seed), then on the branch image on the same volumes (upgrade-verify).
 *   seed:   B martian grabbed normally; A artemis already in qBittorrent (seeded 2 days before the
 *           grab). Indexer 1 seeds without limit, so the release's own cleanup keeps both (it is
 *           triggered once to show that) and cannot remove A before the upgrade.
 *   verify: the new column exists and both rows are NULL (legacy). With a 1-minute seeding rule the
 *           cleanup removes B (added at the grab) and keeps A (added 2 days before it), recording A
 *           as not RMAB's. run.mjs checks the row counts are unchanged.
 */

import { test, expect } from '@playwright/test';
import { fakeArr, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, writeEvidence } from '../../lib/harness';
import { CaseRun, requestState } from './242-helpers';
import {
  takeoverScenario, loadScenario, seedTakeover, setSeeding, folderShas, fixtureShas, downloadRow, hasOwnershipColumn,
  waitDownloaded, waitAvailable, waitSeeded, runCleanup, qbitDeletes, lastSeq, clientHas,
} from './423-helpers';

const phase = process.env.E2E_PHASE;

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(phase !== 'upgrade-seed' && phase !== 'upgrade-verify', '423-upgrade only runs via run.mjs --upgrade-from --upgrade-specs');

test('423 upgrade-seed: a normal grab and a takeover on the release image', async () => {
  test.skip(phase !== 'upgrade-seed');
  test.setTimeout(20 * 60_000);
  const c = new CaseRun('upgrade-seed', '423');
  const def = takeoverScenario('takeover-423-upgrade', { b: 'martian', a: 'artemis' });
  await loadScenario(def);
  const books = await fakeArr.books();
  const rmab = await Rmab.loginAdmin();
  c.save('indexer-config.json', await setSeeding(rmab, 0)); // unlimited: the old cleanup keeps everything
  const seededA = await seedTakeover('a');
  c.save('seeded.json', seededA);

  const idB = (await rmab.requestBook(books.martian)).request.id;
  const idA = (await rmab.requestBook(books.artemis)).request.id;
  await waitDownloaded(idB);
  await waitDownloaded(idA);
  await waitAvailable(rmab, [{ requestId: idA, title: books.artemis.title }, { requestId: idB, title: books.martian.title }]);
  c.check('the release image has no ownership column', !hasOwnershipColumn(), 'control');

  // The release's own cleanup runs once and must keep both (no seeding limit)
  const before = await lastSeq();
  c.save('old-cleanup-job.tsv', `${await runCleanup(rmab)}\n`);
  const deletes = await qbitDeletes(before);
  c.check('old cleanup removed nothing', deletes.length === 0, 'safety', JSON.stringify(deletes));
  const tB = (await fakeArr.state()).torrents.find((t: any) => t.releaseId === 'b');
  c.check('B in the client', !!tB, 'control');
  c.check('A in the client', await clientHas(seededA.hash), 'control');
  c.save('rows-before-upgrade.tsv', `${requestState(idA)}\n${requestState(idB)}\n`);
  writeEvidence('423/upgrade-seed/ids.json', { a: idA, b: idB, hashA: seededA.hash, hashB: tB?.hash });

  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});

test('423 upgrade-verify: legacy rows are NULL; the cleanup removes B and keeps A', async () => {
  test.skip(phase !== 'upgrade-verify');
  test.setTimeout(15 * 60_000);
  const c = new CaseRun('upgrade-verify', '423');
  const books = await fakeArr.books();
  const rmab = await Rmab.loginAdmin();
  const idA = (await rmab.findRequest(books.artemis.asin))?.id;
  const idB = (await rmab.findRequest(books.martian.asin))?.id;
  c.check('both requests survived the upgrade', !!idA && !!idB, 'safety');
  const torrents = (await fakeArr.state()).torrents;
  const tA = torrents.find((t: any) => t.releaseId === 'a');
  const tB = torrents.find((t: any) => t.releaseId === 'b');
  c.check('A and B still in the client after the upgrade', !!tA && !!tB, 'safety');

  c.check('download_history.added_by_rmab exists', hasOwnershipColumn(), 'safety');
  const rowA = () => downloadRow(idA || '');
  const rowB = () => downloadRow(idB || '');
  c.save('rows-after-upgrade.tsv', `${JSON.stringify(rowA())}\n${JSON.stringify(rowB())}\n`);
  c.check(`A's row is NULL (${rowA()?.addedByRmab})`, rowA()?.addedByRmab === 'null', 'safety');
  c.check(`B's row is NULL (${rowB()?.addedByRmab})`, rowB()?.addedByRmab === 'null', 'safety');

  c.save('indexer-config.json', await setSeeding(rmab, 1));
  if (tB) await waitSeeded(tB.hash, 65);
  const before = await lastSeq();
  c.save('cleanup-job.tsv', `${await runCleanup(rmab)}\n`);
  const deletes = await qbitDeletes(before);
  c.save('qbit-deletes.json', deletes);
  c.check('cleanup removed B with its files', !!tB && deletes.some((d) => d.hashes.includes(tB.hash) && d.deleteFiles), 'safety', JSON.stringify(deletes));
  c.check('cleanup removed nothing but B', !!tB && deletes.flatMap((d) => d.hashes).every((h) => h === tB.hash), 'safety');
  c.check('A still in the client', !!tA && (await clientHas(tA.hash)), 'safety');
  c.check('A files unchanged (sha256 = fixture)', !!tA && folderShas(tA.content_path) === fixtureShas('artemis'), 'safety');
  c.check(`A recorded as not RMAB's, still completed (${JSON.stringify(rowA())})`, rowA()?.addedByRmab === 'false' && rowA()?.status === 'completed', 'safety');
  c.check(`B's row marked removed, ownership left NULL (${JSON.stringify(rowB())})`, rowB()?.status === 'removed' && rowB()?.addedByRmab === 'null', 'control');

  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});
