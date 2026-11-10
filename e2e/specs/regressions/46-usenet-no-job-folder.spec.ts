/**
 * Component: E2E regression #46 (usenet cleanup when a job has no folder of its own)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Default flags; exec bridge; its own stack (`--isolate-specs`: it grabs phm). Fake SABnzbd category `audio`
 * at `shared-app*` (a trailing `*` turns off job folders, as in SABnzbd), whose folder already holds another
 * app's real .mp3. PUT `Audio`: stored `audio`, not ReadMeABook's own. phm lands straight in
 * /downloads/shared-app; ReadMeABook imports every audio file there, and with "remove after processing" on
 * the cleanup removes nothing: the other app's .mp3 (same sha256) and phm's files stay, log
 * `Download cleanup skipped: the job has no folder of its own`, no SABnzbd history delete. Restored in afterAll.
 */

import { test, expect } from '@playwright/test';
import { fakeArr, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import { q, sh, PUID, PGID, exists, listing, setRemoveAfterProcessing, sabHistoryDeletes, CaseRun } from './242-helpers';
import { SAB, loadScenario, grabAndImport, putCategory, has } from './46-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '46';
const FOLDER = '/downloads/shared-app';
const FOREIGN = `${FOLDER}/Other App Book - 01.mp3`;

test.afterAll(async () => {
  const rmab = await Rmab.loginAdmin();
  try {
    await putCategory(rmab, SAB, 'readmeabook');
    await setRemoveAfterProcessing(rmab, 2, false);
  } finally {
    await fakeArr.removeCategory('sab', 'audio');
  }
});

test('a job with no folder of its own: cleanup removes nothing in the category folder', async () => {
  test.setTimeout(480_000);
  const c = new CaseRun('usenet-no-job-folder', DIR);
  const rmab = await Rmab.loginAdmin();
  await fakeArr.seedCategory('sab', 'audio', 'shared-app*');
  c.save('indexer-config.json', await setRemoveAfterProcessing(rmab, 2, true));
  // A real .mp3 (so the import takes it as audio), owned by the app user like a download
  sh(`f=$(find /fixtures/martian-mp3 -name '*.mp3' | sort | head -1); mkdir -p ${q(FOLDER)}; cp "$f" ${q(FOREIGN)}; chown -R ${PUID}:${PGID} ${q(FOLDER)}`, { service: 'fake-arr' });
  const foreignSha = sh(`sha256sum ${q(FOREIGN)} | cut -d' ' -f1`).trim();

  const put = await putCategory(rmab, SAB, 'Audio');
  c.save('put.json', put);
  c.check(`stored audio, not ReadMeABook's own (${put.stored?.category}/${put.stored?.ownedCategory})`, put.status === 200 && put.stored?.category === 'audio' && put.stored?.ownedCategory === undefined, 'control');

  await loadScenario('phm', 'usenet', 'phm-m4b');
  c.save('listing-before.txt', listing(FOLDER));
  const run = await grabAndImport(c, rmab, 'phm');
  c.save('listing-after.txt', listing(FOLDER));
  const state = await fakeArr.state();
  const job = state.nzbs.history.find((h: { name?: string }) => h.name === run.book.title);
  c.save('fake-sab.json', { categories: state.sabCategories, job });
  const deletes = await sabHistoryDeletes(job?.nzo_id);

  c.check(`the job reports the category folder itself (${job?.storage})`, job?.storage === FOLDER, 'control');
  c.check(`imported (${run.status}, ${run.libraryFiles.length} files)`, run.libraryFiles.length > 0, 'control');
  c.check("log: Download cleanup skipped: the job has no folder of its own", has(run.events, 'Download cleanup skipped: the job has no folder of its own'), 'log');
  c.check(`the other app's .mp3 survives unchanged: ${FOREIGN}`, exists(FOREIGN) && sh(`sha256sum ${q(FOREIGN)} | cut -d' ' -f1`).trim() === foreignSha, 'safety');
  const leftAudio = listing(FOLDER).split('\n').filter((l) => /\.(mp3|m4b)\t/.test(l) && !l.includes('Other App Book'));
  c.check(`phm's own files stay too (${leftAudio.length})`, leftAudio.length > 0, 'safety');
  c.check(`no SABnzbd history delete (${deletes.length})`, deletes.length === 0, 'control');
  c.check(`log absent: Removed directory: ${FOLDER}`, !has(run.events, `Removed directory: ${FOLDER}`), 'safety');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});
