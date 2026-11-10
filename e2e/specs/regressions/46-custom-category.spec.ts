/**
 * Component: E2E regression #46 (download client category: qBittorrent, the card, the modal, the wizard)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Default flags; exec bridge (psql, library listing). One stack for all three books:
 *   1  default unchanged (phm): bootstrap's `readmeabook`; create/edit only `readmeabook`, add autoTMM=true,
 *      no savepath; the card has no Category line (shot)
 *   2  custom new via the modal (martian): `audiobooks-e2e`, no note; stored with ownedCategory; the grab
 *      creates it at RMAB's path and the torrent carries it; imported (card shot)
 *   3  pre-existing `Books` at /other (artemis): suggested after Test; typing `books` shows the note (shots
 *      1280 light, 375 dark); stored `Books`, no ownedCategory; card suffix (shots); the grab sends no
 *      create/edit for it, adds category=Books autoTMM=false savepath=/downloads; `Books` still /other
 *   4  long not-owned name `audiobooks-readarr` on the card at 375 dark (no download)
 *   5  restore `readmeabook`; then the setup wizard's Download Client step with a custom category (shot)
 */

import { test, expect } from '@playwright/test';
import { fakeArr, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, evidencePath, env } from '../../lib/harness';
import { psql, CaseRun } from './242-helpers';
import { QBIT, VIEWS, loadScenario, callsSince, lastSeq, grabAndImport, adminPage, clientCard, openDownloadSettings, editAndTest, datalistValues, putCategory, storedClient, type FakeTorrent } from './46-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });

const DIR = '46';
const shot = (name: string) => ({ path: evidencePath(DIR, `${name}.jpg`), type: 'jpeg' as const, quality: 80 });
const CARD = 'qBittorrent (fake)';

test('1 default category unchanged', async ({ browser }) => {
  test.setTimeout(420_000);
  const c = new CaseRun('1-default', DIR);
  const rmab = await Rmab.loginAdmin();
  c.save('stored-client-before.json', storedClient(QBIT));
  await loadScenario('phm', 'torrent', 'phm-mp3');
  const since = await lastSeq();
  const run = await grabAndImport(c, rmab, 'phm');
  const calls = await callsSince(since, 'qbit');
  c.save('qbit-calls.json', calls.map((r) => ({ seq: r.seq, path: r.path, body: r.body })));
  const catCalls = calls.filter((r) => /\/torrents\/(create|edit)Category$/.test(r.path));
  const add = calls.find((r) => r.path.endsWith('/torrents/add'));

  c.check('stored client has no ownedCategory', storedClient(QBIT)?.ownedCategory === undefined, 'control');
  c.check(`category calls only for readmeabook (${catCalls.map((r) => r.body?.category).join(',')})`, catCalls.every((r) => r.body?.category === 'readmeabook'), 'control');
  c.check(`add: category=readmeabook autoTMM=true no savepath (${JSON.stringify(add?.body)})`, add?.body?.category === 'readmeabook' && add.body.autoTMM === 'true' && !add.body.savepath, 'control');
  c.check(`imported (${run.status}, ${run.libraryFiles.length} files)`, run.libraryFiles.length > 0, 'control');

  const { page, close } = await adminPage(browser, VIEWS.light);
  await openDownloadSettings(page);
  const lines = await clientCard(page, CARD).getByText(/^Category:/).count();
  c.check(`card has no Category line (${lines})`, lines === 0, 'control');
  await page.screenshot(shot('card-default-1280-light'));
  await close();
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('2 custom new category through the modal', async ({ browser }) => {
  test.setTimeout(420_000);
  const c = new CaseRun('2-custom-new', DIR);
  const rmab = await Rmab.loginAdmin();
  const { page, close } = await adminPage(browser, VIEWS.light);
  await openDownloadSettings(page);
  const input = await editAndTest(page, CARD, 'readmeabook');
  await input.fill('audiobooks-e2e');
  const notes = await page.getByText(/^Already in qBittorrent/).count();
  c.check(`no note for a new name (${notes})`, notes === 0, 'control');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(clientCard(page, CARD).getByText('Category: audiobooks-e2e')).toBeVisible({ timeout: 15_000 });
  const suffix = await clientCard(page, CARD).getByText('(existing, left as is)').count();
  c.check(`card: custom name, no suffix (${suffix})`, suffix === 0, 'control');
  await page.screenshot(shot('card-custom-owned-1280-light'));
  await close();

  const stored = storedClient(QBIT);
  c.save('stored-client.json', stored);
  c.check(`stored category and ownedCategory audiobooks-e2e (${stored?.category}/${stored?.ownedCategory})`, stored?.category === 'audiobooks-e2e' && stored?.ownedCategory === 'audiobooks-e2e', 'control');

  await loadScenario('martian', 'torrent', 'martian-mp3');
  const since = await lastSeq();
  const run = await grabAndImport(c, rmab, 'martian');
  const calls = await callsSince(since, 'qbit');
  c.save('qbit-calls.json', calls.map((r) => ({ seq: r.seq, path: r.path, body: r.body })));
  const create = calls.find((r) => r.path.endsWith('/torrents/createCategory') && r.body?.category === 'audiobooks-e2e');
  const add = calls.find((r) => r.path.endsWith('/torrents/add'));
  const state = await fakeArr.state();
  c.save('fake-qbit.json', { categories: state.qbitCategories, torrents: state.torrents.map((t: FakeTorrent) => ({ name: t.name, category: t.category, save_path: t.save_path })) });
  c.check(`createCategory audiobooks-e2e at /downloads (${JSON.stringify(create?.body)})`, create?.body?.savePath === '/downloads', 'control');
  c.check(`add: category=audiobooks-e2e autoTMM=true (${JSON.stringify(add?.body)})`, add?.body?.category === 'audiobooks-e2e' && add.body.autoTMM === 'true', 'control');
  c.check(`imported (${run.status}, ${run.libraryFiles.length} files)`, run.libraryFiles.length > 0, 'control');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('3 pre-existing category is used, not re-pathed, and the note shows', async ({ browser }) => {
  test.setTimeout(480_000);
  const c = new CaseRun('3-existing', DIR);
  const rmab = await Rmab.loginAdmin();
  await fakeArr.seedCategory('qbit', 'Books', '/other');
  await fakeArr.seedCategory('qbit', 'audiobooks-readarr', '/readarr');

  for (const view of [VIEWS.light, VIEWS.dark]) {
    const { page, close } = await adminPage(browser, view);
    await openDownloadSettings(page);
    const input = await editAndTest(page, CARD, 'Books');
    c.save(`suggestions-${view.tag}.json`, await datalistValues(page));
    await input.fill('books');
    const note = page.getByText(/^Already in qBittorrent\. ReadMeABook won't change it; files still go to /);
    await expect(note).toBeVisible();
    c.check(`${view.tag}: note "${await note.textContent()}"`, true, 'control');
    await note.scrollIntoViewIfNeeded();
    await page.screenshot(shot(`modal-existing-note-${view.tag}`));
    if (view === VIEWS.light) {
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(clientCard(page, CARD).getByText('Category: Books')).toBeVisible({ timeout: 15_000 });
    }
    await close();
  }
  const stored = storedClient(QBIT);
  c.save('stored-client.json', stored);
  c.check(`stored the client's spelling Books, no ownedCategory (${stored?.category}/${stored?.ownedCategory})`, stored?.category === 'Books' && stored?.ownedCategory === undefined, 'control');

  for (const view of [VIEWS.light, VIEWS.dark]) {
    const { page, close } = await adminPage(browser, view);
    await openDownloadSettings(page);
    const suffix = clientCard(page, CARD).getByText('(existing, left as is)');
    await expect(suffix).toBeVisible();
    await page.screenshot(shot(`card-existing-${view.tag}`));
    await close();
  }

  await loadScenario('artemis', 'torrent', 'artemis-mp3');
  const since = await lastSeq();
  const run = await grabAndImport(c, rmab, 'artemis');
  const calls = await callsSince(since, 'qbit');
  c.save('qbit-calls.json', calls.map((r) => ({ seq: r.seq, path: r.path, body: r.body })));
  const touched = calls.filter((r) => /\/torrents\/(create|edit)Category$/.test(r.path) && r.body?.category?.toLowerCase() === 'books');
  const add = calls.find((r) => r.path.endsWith('/torrents/add'));
  const state = await fakeArr.state();
  c.save('fake-qbit.json', { categories: state.qbitCategories, torrents: state.torrents.map((t: FakeTorrent) => ({ name: t.name, category: t.category, save_path: t.save_path })) });
  c.check(`no create/edit for Books (${touched.length})`, touched.length === 0, 'safety');
  c.check(`add: category=Books autoTMM=false savepath=/downloads (${JSON.stringify(add?.body)})`, add?.body?.category === 'Books' && add.body.autoTMM === 'false' && add.body.savepath === '/downloads', 'control');
  c.check(`Books still at /other (${state.qbitCategories.Books?.savePath})`, state.qbitCategories.Books?.savePath === '/other', 'safety');
  const t = state.torrents.find((x: FakeTorrent) => x.category === 'Books');
  c.check(`torrent saved under /downloads (${t?.save_path})`, t?.save_path === '/downloads', 'control');
  c.check(`imported (${run.status}, ${run.libraryFiles.length} files)`, run.libraryFiles.length > 0, 'control');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('4 a long existing name keeps its suffix on a phone', async ({ browser }) => {
  const c = new CaseRun('4-long-name', DIR);
  const rmab = await Rmab.loginAdmin();
  const put = await putCategory(rmab, QBIT, 'audiobooks-readarr');
  c.save('put.json', put);
  c.check(`PUT 200, stored without ownedCategory (${put.status})`, put.status === 200 && put.stored?.ownedCategory === undefined, 'control');
  const { page, close } = await adminPage(browser, VIEWS.dark);
  await openDownloadSettings(page);
  const suffix = clientCard(page, CARD).getByText('(existing, left as is)');
  await expect(suffix).toBeVisible();
  const box = await suffix.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const card = el.closest('div.rounded-lg')!.getBoundingClientRect();
    const name = el.previousElementSibling as HTMLElement;
    return { right: r.right, cardRight: card.right, clipped: el.scrollWidth > el.clientWidth, nameClipped: name.scrollWidth > name.clientWidth };
  });
  c.save('suffix-box.json', box);
  c.check(`suffix inside the card and not clipped (${JSON.stringify(box)})`, box.right <= box.cardRight && !box.clipped, 'safety');
  c.check('the name audiobooks-readarr is shown whole (the suffix wraps instead)', !box.nameClipped, 'control');
  await page.screenshot(shot('card-existing-long-375-dark'));
  await close();
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('5 restore, then the setup wizard step with a custom category', async ({ browser }) => {
  const c = new CaseRun('5-wizard', DIR);
  const rmab = await Rmab.loginAdmin();
  const put = await putCategory(rmab, QBIT, 'readmeabook');
  c.check(`restored readmeabook (${put.status}, ${put.stored?.category}/${put.stored?.ownedCategory})`, put.status === 200 && put.stored?.category === 'readmeabook' && put.stored?.ownedCategory === undefined, 'control');

  // The wizard only renders while setup is incomplete; the earlier steps need live services, so the
  // page's own step state is set to the Download Client step. Restored in finally.
  psql(`update configuration set value = 'false' where key = 'setup_completed'`);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/setup');
    await page.getByRole('heading').first().waitFor();
    /* eslint-disable @typescript-eslint/no-explicit-any -- React fiber internals are untyped */
    const found = await page.evaluate(() => {
      const el = document.querySelector('h1, h2') as any;
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
      for (let f = el[key]; f; f = f.return) {
        for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
          const s = h.memoizedState;
          if (s && typeof s === 'object' && 'currentStep' in s && h.queue?.dispatch) {
            (window as any).__setStep = (n: number) => h.queue.dispatch((p: any) => ({ ...p, backendMode: 'audiobookshelf', downloadDir: '/downloads', currentStep: n }));
            return true;
          }
        }
      }
      return false;
    });
    expect(found).toBe(true);
    const heading = page.getByRole('heading', { name: 'Configure Download Clients' });
    for (let n = 2; n < 15 && !(await heading.isVisible()); n++) {
      await page.evaluate((step) => (window as any).__setStep(step), n);
      await page.waitForTimeout(150);
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    await expect(heading).toBeVisible();
    await page.getByRole('button', { name: 'Add qBittorrent' }).click();
    await page.getByPlaceholder('My qBittorrent').fill('qBittorrent');
    await page.getByPlaceholder('http://localhost:8080').fill('http://fake-arr:8081');
    await page.getByPlaceholder('admin').fill(env('QBIT_USER'));
    await page.getByPlaceholder('Password').fill(env('QBIT_PASS'));
    await page.getByRole('button', { name: 'Test Connection' }).click();
    await page.locator('datalist option[value="Books"]').waitFor({ state: 'attached', timeout: 30_000 });
    await page.getByLabel('Category', { exact: true }).fill('audiobooks-new');
    await page.screenshot(shot('wizard-modal-1280-light'));
    await page.getByRole('button', { name: 'Add Client' }).click();
    await expect(page.getByText('Category: audiobooks-new')).toBeVisible();
    await page.screenshot(shot('wizard-download-step-1280-light'));
    c.check('wizard card shows the custom category', true, 'control');
    await ctx.close();
  } finally {
    psql(`update configuration set value = 'true' where key = 'setup_completed'`);
  }
  c.check('setup_completed restored', psql(`select value from configuration where key = 'setup_completed'`) === 'true', 'safety');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});
