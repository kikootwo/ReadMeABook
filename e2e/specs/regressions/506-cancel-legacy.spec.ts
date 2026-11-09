/**
 * Component: E2E regression #228 across an upgrade (requests cancelled before cancelled_at existed)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * run.mjs --upgrade-from 1.2.12 --upgrade-specs 506-cancel-legacy runs this file on the release image
 * (E2E_PHASE=upgrade-seed), then on the branch image on the same volumes (upgrade-verify).
 *   seed:   L1 phm cancelled mid-download on the release image: the torrent keeps going and completes.
 *           L2 martian still downloading at the upgrade (slow release).
 *   verify: requests.cancelled_at exists, nullable, no default, NULL on L1. With a 1-minute seeding rule
 *           the cleanup runs twice at least 60 s apart and never removes L1 (torrent and sha256 intact).
 *           L2 cancelled after the upgrade: its torrent and partial download are removed.
 * Not named *upgrade.spec.ts (the stock run's filter is a path regex). run.mjs checks row counts.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, writeEvidence } from '../../lib/harness';
import { CaseRun, requestState } from './242-helpers';
import { loadScenario, setSeeding, folderShas, fixtureShas, runCleanup, qbitDeletes, lastSeq, waitSeeded } from './423-helpers';
import { cancelScenario, cancelRow, waitDownloading, waitComplete, torrentOf, cancelledAtColumn, requestIdByAsin } from './506-helpers';

const phase = process.env.E2E_PHASE;
const DIR = '506';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(phase !== 'upgrade-seed' && phase !== 'upgrade-verify', '506-cancel-legacy only runs via run.mjs --upgrade-from --upgrade-specs');

test('506 upgrade-seed: a cancel on the release image leaves the download running', async () => {
  test.skip(phase !== 'upgrade-seed');
  test.setTimeout(20 * 60_000);
  const c = new CaseRun('legacy-seed', DIR);
  // L2 must still be downloading after the upgrade and the verify phase's two cleanups
  const def = cancelScenario('cancel-506-legacy', [
    { id: 'l1', book: 'phm', completeMs: 120_000 },
    { id: 'l2', book: 'martian', completeMs: 40 * 60_000 },
  ]);
  await loadScenario(def);
  c.save('scenario-definition.json', def);
  const books = await fakeArr.books();
  const rmab = await Rmab.loginAdmin();
  c.save('indexer-config.json', await setSeeding(rmab, 0));

  const idL1 = (await rmab.requestBook(books.phm)).request.id;
  const idL2 = (await rmab.requestBook(books.martian)).request.id;
  await waitDownloading(idL1);
  await waitDownloading(idL2);
  const t1 = await torrentOf('l1');
  c.check(`L1 partial before the cancel (progress ${t1?.progress})`, !!t1 && t1.progress < 1, 'control');

  const before = await lastSeq();
  const res = await rmab.raw('PATCH', `/api/requests/${idL1}`, { action: 'cancel' });
  c.save('l1-cancel.json', { status: res.status, body: await res.json().catch(() => null) });
  c.check(`L1 cancelled on the release image (${res.status})`, res.ok, 'control');
  c.check('the release image made no torrents/delete', (await qbitDeletes(before)).length === 0, 'control');

  const done = await waitComplete('l1');
  c.check('L1 completed in the client after its cancel', done.progress === 1, 'control');
  c.check('L1 files are the fixture (sha256)', folderShas(done.content_path) === fixtureShas('phm'), 'control');
  const t2 = await torrentOf('l2');
  c.check(`L2 still downloading (progress ${t2?.progress})`, !!t2 && t2.progress < 1, 'control');
  c.check('the release image has no cancelled_at column', !cancelledAtColumn().exists, 'control');
  c.save('rows-before-upgrade.tsv', `${requestState(idL1)}\n${requestState(idL2)}\n`);
  writeEvidence(`${DIR}/legacy-seed/ids.json`, { l1: idL1, l2: idL2, hashL1: done.hash, hashL2: t2?.hash });

  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});

test('506 upgrade-verify: an old cancel is never swept; a new cancel removes the download', async () => {
  test.skip(phase !== 'upgrade-verify');
  test.setTimeout(20 * 60_000);
  const c = new CaseRun('legacy-verify', DIR);
  const books = await fakeArr.books();
  const rmab = await Rmab.loginAdmin();
  const idL1 = requestIdByAsin(books.phm.asin);
  const idL2 = requestIdByAsin(books.martian.asin);
  c.check('both requests survived the upgrade', !!idL1 && !!idL2, 'safety');
  const t1 = await torrentOf('l1');
  c.check('L1 still in the client after the upgrade', !!t1, 'safety');

  const column = cancelledAtColumn();
  c.save('cancelled-at-column.json', column);
  c.check(`requests.cancelled_at exists, nullable, no default (${JSON.stringify(column)})`, column.exists && column.nullable === 'YES' && column.defaultValue === '', 'safety');
  const rowL1 = cancelRow(idL1);
  c.save('l1-after-upgrade.json', rowL1);
  c.check(`L1 still cancelled with cancelled_at NULL (${JSON.stringify(rowL1)})`, rowL1.status === 'cancelled' && rowL1.cancelledAt === '', 'safety');

  c.save('indexer-config.json', await setSeeding(rmab, 1));
  if (t1) await waitSeeded(t1.hash, 65);
  const fixture = fixtureShas('phm');
  for (const run of [1, 2]) {
    const before = await lastSeq();
    const job = await runCleanup(rmab);
    c.save(`cleanup-${run}.tsv`, `${job}\n`);
    const deletes = await qbitDeletes(before);
    c.check(`cleanup ${run}: no torrents/delete`, deletes.length === 0, 'safety', JSON.stringify(deletes));
    c.check(`cleanup ${run}: L1 still in the client, files intact`, !!t1 && !!(await torrentOf('l1')) && folderShas(t1.content_path) === fixture, 'safety');
    if (run === 1) await new Promise((r) => setTimeout(r, 65_000));
  }
  c.check(`L1's row untouched (${JSON.stringify(cancelRow(idL1))})`, JSON.stringify(cancelRow(idL1)) === JSON.stringify(rowL1), 'safety');

  // L2 was started on the release image and is cancelled now
  await waitDownloading(idL2);
  const t2 = await torrentOf('l2');
  c.check(`L2 partial before the cancel (progress ${t2?.progress})`, !!t2 && t2.progress < 1, 'control');
  const before = await lastSeq();
  const res = await rmab.raw('PATCH', `/api/requests/${idL2}`, { action: 'cancel' });
  const body = await res.json().catch(() => null);
  c.save('l2-cancel.json', { status: res.status, body });
  c.check(`L2 cancel 200, download removed (${res.status}, ${body?.download})`, res.ok && body?.download === 'removed', 'safety');
  const deletes = await qbitDeletes(before);
  c.save('l2-qbit-deletes.json', deletes);
  c.check('L2: torrents/delete with deleteFiles for its hash only', !!t2 && deletes.length === 1 && deletes[0].hashes.includes(t2.hash) && deletes[0].deleteFiles, 'safety', JSON.stringify(deletes));
  c.check('L2 gone from the client; L1 still there', !(await torrentOf('l2')) && !!(await torrentOf('l1')), 'safety');
  const rowL2 = cancelRow(idL2);
  c.check(`L2 row removed, cancelled_at set (${JSON.stringify(rowL2)})`, rowL2.status === 'cancelled' && rowL2.downloadStatus === 'removed' && !!rowL2.cancelledAt, 'safety');

  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});
