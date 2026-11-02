/**
 * Component: E2E regression #522 (a failed indexer search is reported, not shown as "nothing found")
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Fake Prowlarr answers HTTP 400 to every search (all failed), then only to the "title author"
 * query (one failed, "title" answers with the release), then the same with no releases (one failed,
 * the rest found nothing). Automatic search: the request message says
 * every indexer search failed and the job log (System Logs) has one warn line per failed query plus
 * the summary. Interactive search from the admin requests table: the warning replaces the empty
 * state, then sits above the results that came back, then above "No results found". On main the request read "No torrents/nzbs
 * found" and the modal "No results found". Uses martian (smoke uses phm). Exec bridge required.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { ctl, env, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, snap, waitFor, writeEvidence, Rmab, type Book } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const DIR = '522';
const RELEASE = { id: 'good', title: '{{author}} - {{title}} [M4B]', fixture: 'martian-m4b', sizeMB: 300, seeders: 20 };

async function loadScenario(definition: Record<string, unknown>) {
  const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition }) });
  expect(res.ok, await res.clone().text()).toBe(true);
}
const allFail = () => loadScenario({ name: 'search-all-fail-522', book: 'martian', search: { statuses: [400] }, releases: [RELEASE] });
const partialFail = (book: Book, releases = [RELEASE]) =>
  loadScenario({ name: 'search-partial-522', book: 'martian', search: { queryStatuses: [{ contains: book.author, status: 400 }] }, releases });

const requestRow = (id: string) => psql(`select coalesce(status,'') || '|' || coalesce(error_message,'') from requests where id = ${sqlStr(id)}`);
const searchWarnings = () =>
  psql(`select message from job_events where level = 'warn' and context = 'SearchIndexers' and (message like 'Indexer search failed:%' or message like '% indexer searches failed') order by created_at`)
    .split('\n').filter(Boolean);

let book: Book;
let requestId: string;

test('#522: automatic search, every indexer search fails: the request and the job log say so', async () => {
  book = (await fakeArr.books()).martian;
  await allFail();
  const rmab = await Rmab.loginAdmin();
  requestId = (await rmab.requestBook(book)).request.id;

  const row = await waitFor('request searched', async () => (requestRow(requestId).startsWith('awaiting_search|') ? requestRow(requestId) : null), { timeoutMs: 180_000, intervalMs: 2_000 });
  const warnings = searchWarnings();
  writeEvidence(`${DIR}/automatic.json`, { requestId, row, warnings });

  expect(row).toMatch(/^awaiting_search\|All \d+ indexer searches failed \(see System Logs\)\. Will retry automatically\.$/);
  expect(row).not.toContain('No torrents/nzbs found');
  const sent = Number(/All (\d+)/.exec(row)![1]);
  expect(warnings.filter((w) => w.startsWith('Indexer search failed: '))).toHaveLength(sent);
  expect(warnings).toContain(`${sent} of ${sent} indexer searches failed`);
  expect(warnings.join('\n')).toContain('Request failed with status code 400');
  expect(warnings.join('\n')).not.toContain(env('PROWLARR_API_KEY'));
});

async function openInteractiveSearch(page: Page) {
  await page.goto('/admin');
  const row = page.locator('tr', { hasText: book.title }).first();
  await row.getByTitle('Actions').click();
  const response = page.waitForResponse((r) => r.url().endsWith(`/api/requests/${requestId}/interactive-search`), { timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Interactive Search' }).click();
  return (await response).json();
}

async function settledShot(page: Page, name: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await snap(page, DIR, name);
}

for (const view of [
  { label: '1280 light', width: 1280, height: 800, dark: false, suffix: '' },
  { label: '375 dark', width: 375, height: 812, dark: true, suffix: '-375-dark' },
]) {
  test(`#522: interactive search shows failed indexer searches (${view.label})`, async ({ browser }: { browser: Browser }) => {
    test.skip(!requestId, 'needs the request from the automatic-search test');
    const ctx = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL,
      viewport: { width: view.width, height: view.height },
      colorScheme: view.dark ? 'dark' : 'light',
      storageState: evidencePath('storage-state.json'),
    });
    const page = await ctx.newPage();
    try {
      await allFail();
      const all = await openInteractiveSearch(page);
      const notice = page.getByTestId('search-failure-notice');
      await expect(notice).toContainText('indexer searches failed, so no indexer results could be fetched.');
      await expect(notice).toContainText('Error: Request failed with status code 400');
      await expect(page.getByText('No results found')).toHaveCount(0);
      await settledShot(page, `search-all-failed${view.suffix}`);

      await partialFail(book);
      const partialP = page.waitForResponse((r) => r.url().endsWith(`/api/requests/${requestId}/interactive-search`), { timeout: 60_000 });
      await notice.getByRole('button', { name: 'Search Again' }).click();
      const partial = await (await partialP).json();
      await expect(notice).toContainText(`${partial.searchFailures?.failed} of ${partial.searchFailures?.total} indexer searches failed, so results may be incomplete.`);
      await expect(page.getByText(`${book.author} - ${book.title} [M4B]`).first()).toBeVisible();
      await expect(notice.getByRole('button', { name: 'Search Again' })).toHaveCount(0);
      await settledShot(page, `search-partial-failure${view.suffix}`);

      // some failed, the rest found nothing: the notice above "No results found", whose Search Again is the only one
      await partialFail(book, []);
      const emptyP = page.waitForResponse((r) => r.url().endsWith(`/api/requests/${requestId}/interactive-search`), { timeout: 60_000 });
      await page.getByRole('button', { name: 'Refresh' }).click();
      const partialEmpty = await (await emptyP).json();
      await expect(page.getByText('No results found')).toBeVisible();
      await expect(notice).toContainText(`${partialEmpty.searchFailures?.failed} of ${partialEmpty.searchFailures?.total} indexer searches failed, so results may be incomplete.`);
      await expect(page.getByRole('button', { name: 'Search Again' })).toHaveCount(1);
      await expect(notice.getByRole('button', { name: 'Search Again' })).toHaveCount(0);
      const [noticeBox, emptyBox] = [await notice.boundingBox(), await page.getByText('No results found').boundingBox()];
      expect(noticeBox && emptyBox && noticeBox.y + noticeBox.height <= emptyBox.y, `notice above the empty state: ${JSON.stringify([noticeBox, emptyBox])}`).toBe(true);
      await settledShot(page, `search-partial-failure-empty${view.suffix}`);

      writeEvidence(`${DIR}/interactive${view.suffix || '-1280'}.json`, {
        all: { searchFailures: all.searchFailures, results: all.results?.length },
        partial: { searchFailures: partial.searchFailures, results: partial.results?.map((r: { title: string }) => r.title) },
        partialEmpty: { searchFailures: partialEmpty.searchFailures, results: partialEmpty.results?.length },
      });
      expect(all.searchFailures.failed).toBe(all.searchFailures.total);
      expect(all.results).toEqual([]);
      expect(partial.searchFailures.failed).toBeGreaterThan(0);
      expect(partial.searchFailures.failed).toBeLessThan(partial.searchFailures.total);
      expect(partial.results.length).toBeGreaterThan(0);
      expect(partialEmpty.searchFailures.failed).toBeLessThan(partialEmpty.searchFailures.total);
      expect(partialEmpty.results).toEqual([]);
      expect(JSON.stringify([all, partial, partialEmpty])).not.toContain(env('PROWLARR_API_KEY'));
      const box = await notice.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= view.width, `notice inside the ${view.width} px viewport: ${JSON.stringify(box)}`).toBe(true);
    } finally {
      await ctx.close();
    }
  });
}
