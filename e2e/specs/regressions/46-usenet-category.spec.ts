/**
 * Component: E2E regression #46 / #579 (download client category on fake SABnzbd, cleanup in another app's category)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Default flags; exec bridge. One stack for all three books:
 *   1  custom new `AudioBooks-E2E` via the API: stored with ownedCategory; two grabs (phm, martian) send one
 *      set_config in total (SABnzbd's array category list read by name, names compared in any case); both import
 *   2  pre-existing `books` at `other-app` (artemis), its job folder already holding another app's file;
 *      PUT `Books`: stored `books` (ownedCategory still the earlier `audiobooks-e2e`), no set_config for it; the job lands in /downloads/other-app;
 *      import with "remove after processing" on removes the imported files only: the other app's file and its
 *      folder stay; `books` still points at other-app
 *   3  restore `readmeabook`
 */

import { test, expect } from '@playwright/test';
import { fakeArr, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import { q, asApp, exists, listing, setRemoveAfterProcessing, CaseRun } from './242-helpers';
import { SAB, loadScenario, callsSince, lastSeq, grabAndImport, putCategory, has, type FakeNzb } from './46-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });

const DIR = '46';
const setConfigs = (calls: { query: Record<string, string> }[]) => calls.filter((r) => r.query.mode === 'set_config');

test('1 custom new category on SABnzbd: one set_config for two grabs', async () => {
  test.setTimeout(720_000);
  const c = new CaseRun('usenet-1-custom-new', DIR);
  const rmab = await Rmab.loginAdmin();
  const since = await lastSeq();
  const put = await putCategory(rmab, SAB, 'AudioBooks-E2E');
  c.save('put.json', put);
  c.check(`stored category and ownedCategory audiobooks-e2e (${put.stored?.category}/${put.stored?.ownedCategory})`, put.status === 200 && put.stored?.category === 'audiobooks-e2e' && put.stored?.ownedCategory === 'audiobooks-e2e', 'control');

  await loadScenario('phm', 'usenet', 'phm-m4b');
  const first = await grabAndImport(c, rmab, 'phm');
  await loadScenario('martian', 'usenet', 'martian-m4b');
  const second = await grabAndImport(c, rmab, 'martian');

  const calls = await callsSince(since, 'sab');
  c.save('sab-calls.json', calls.map((r) => ({ seq: r.seq, method: r.method, query: { ...r.query, apikey: undefined }, body: r.body })));
  const sets = setConfigs(calls);
  const adds = calls.filter((r) => r.query.mode === 'addfile' || r.body?.cat !== undefined);
  const state = await fakeArr.state();
  c.save('fake-sab.json', { categories: state.sabCategories, history: state.nzbs.history.map((h: FakeNzb) => ({ name: h.name, category: h.category, storage: h.storage })) });
  c.check(`one set_config in total (${sets.map((s) => s.query.keyword).join(',')})`, sets.length === 1 && sets[0].query.keyword?.toLowerCase() === 'audiobooks-e2e', 'control');
  c.check(`both adds use cat audiobooks-e2e (${adds.map((a) => a.body?.cat ?? a.query.cat).join(',')})`, adds.length === 2 && adds.every((a) => (a.body?.cat ?? a.query.cat)?.toLowerCase() === 'audiobooks-e2e'), 'control');
  c.check(`phm imported (${first.status}, ${first.libraryFiles.length} files)`, first.libraryFiles.length > 0, 'control');
  c.check(`martian imported (${second.status}, ${second.libraryFiles.length} files)`, second.libraryFiles.length > 0, 'control');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('2 pre-existing category: not re-pathed; cleanup keeps the other app files', async () => {
  test.setTimeout(480_000);
  const c = new CaseRun('usenet-2-existing-cleanup', DIR);
  const rmab = await Rmab.loginAdmin();
  await fakeArr.seedCategory('sab', 'books', 'other-app');
  c.save('indexer-config.json', await setRemoveAfterProcessing(rmab, 2, true));
  const book = (await fakeArr.books()).artemis;
  const jobDir = `/downloads/other-app/${book.title}`;
  const foreign = `${jobDir}/other-app-notes.nfo`;
  asApp(`mkdir -p ${q(jobDir)} && printf 'not ReadMeABook\\n' > ${q(foreign)}`);

  const since = await lastSeq();
  const put = await putCategory(rmab, SAB, 'Books');
  c.save('put.json', put);
  c.check(`stored books (the client's name), not ReadMeABook's own (${put.stored?.category}/${put.stored?.ownedCategory})`, put.status === 200 && put.stored?.category === 'books' && put.stored?.ownedCategory === 'audiobooks-e2e', 'control');

  await loadScenario('artemis', 'usenet', 'artemis-mp3');
  c.save('listing-before.txt', listing('/downloads/other-app'));
  const run = await grabAndImport(c, rmab, 'artemis');
  c.save('listing-after.txt', listing('/downloads/other-app'));
  const calls = await callsSince(since, 'sab');
  c.save('sab-calls.json', calls.map((r) => ({ seq: r.seq, method: r.method, query: { ...r.query, apikey: undefined }, body: r.body })));
  const state = await fakeArr.state();
  const job = state.nzbs.history.find((h: FakeNzb) => h.name === book.title) ?? state.nzbs.queue.find((h: FakeNzb) => h.filename === book.title);
  c.save('fake-sab.json', { categories: state.sabCategories, job });

  c.check(`no set_config (${setConfigs(calls).length})`, setConfigs(calls).length === 0, 'safety');
  c.check(`books still points at other-app (${state.sabCategories.books})`, state.sabCategories.books === 'other-app', 'safety');
  c.check(`imported (${run.status}, ${run.libraryFiles.length} files)`, run.libraryFiles.length > 0, 'control');
  c.check(`the other app's file survives: ${foreign}`, exists(foreign), 'safety');
  c.check(`${jobDir} kept (not empty)`, exists(jobDir), 'safety');
  const leftAudio = listing(jobDir).split('\n').filter((l) => /\.(mp3|m4b)\t/.test(l));
  c.check(`imported audio removed from ${jobDir} (${leftAudio.length} left)`, leftAudio.length === 0, 'control');
  c.check('log: Category already existed in the client: removed', has(run.events, 'Category already existed in the client: removed'), 'log');
  c.check(`log absent: Removed directory: ${jobDir}`, !has(run.events, `Removed directory: ${jobDir}`), 'safety');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('3 restore readmeabook', async () => {
  const c = new CaseRun('usenet-3-restore', DIR);
  const rmab = await Rmab.loginAdmin();
  const put = await putCategory(rmab, SAB, 'readmeabook');
  c.save('put.json', put);
  c.check(`restored (${put.status}, ${put.stored?.category}/${put.stored?.ownedCategory})`, put.status === 200 && put.stored?.category === 'readmeabook', 'control');
  await setRemoveAfterProcessing(rmab, 2, false);
  // The seeded category must not outlive the spec (last test: a reset also drops client sessions)
  await fakeArr.reset();
  const after = await fakeArr.state();
  c.check(`reset removed the seeded books category (${JSON.stringify(after.sabCategories)})`, !('books' in after.sabCategories), 'control');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});
