/**
 * Component: E2E regression #259 (admin language filter for Audible results)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata. RMAB's Audible calls are CONNECT
 * tunnels the fake metadata proxy refuses, so no real Audible host is reached.
 *   1  Settings, real path: the Library tab shows "Only show books in English", the label follows
 *      the region select (German for audible.de), Test Connection + Save sends
 *      PUT /api/admin/settings/audible {region, languageFilter: true}; after a reload the box is
 *      checked and GET /api/admin/settings says true. A non-boolean is refused with 400, and the
 *      setting is turned off again through the API. Snapshots of the control at 1280 light/dark, 375.
 *   2  Labelled replay (page.route) of /api/audiobooks/search: a page with kept results and
 *      "47 in other languages hidden"; then a query whose every page is hidden: the page loads 4
 *      more pages by itself and stops on "No results in English so far" with the Load more bar;
 *      with "Hide Available" on and page 1 all owned: "All results so far are already available"
 *      with the Load more bar, and a click loads page 2.
 *   3  Labelled replay of /api/series/search: series kept with "6 in other languages hidden", and
 *      the empty state `No series in English for "q"`.
 * The browser never leaves the RMAB origin (covers answered with a local SVG, the rest aborted).
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, snap, stackExecSync, writeEvidence } from '../../lib/harness';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const FAKE_PROXY = 'http://fake-arr:9898';
const COVER_HOST = 'm.media-amazon.com';
const VIEWS = [
  { name: '1280-light', width: 1280, height: 800, dark: false },
  { name: '1280-dark', width: 1280, height: 800, dark: true },
  { name: '375-light', width: 375, height: 812, dark: false },
];
/** The series route's answer for the recorded US "expeditionary force" catalog page (#450 fixture) */
const SERIES = JSON.parse(fs.readFileSync(path.join(__dirname, '450-series-results.json'), 'utf8')) as { asin: string; title: string }[];
const BOOKS = [
  { asin: 'B0E2E25901', title: 'The Way of Kings', author: 'Brandon Sanderson', narrator: 'Michael Kramer, Kate Reading' },
  { asin: 'B0E2E25902', title: 'Words of Radiance', author: 'Brandon Sanderson', narrator: 'Michael Kramer, Kate Reading' },
  { asin: 'B0E2E25903', title: 'Oathbringer', author: 'Brandon Sanderson', narrator: 'Michael Kramer, Kate Reading' },
].map((b) => ({ ...b, coverArtUrl: `https://${COVER_HOST}/images/I/${b.asin}._SL500_.jpg`, durationMinutes: 2700, language: 'english' }));

const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

function coverSvg(url: string) {
  let h = 0;
  for (const c of url) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="hsl(${h},45%,42%)"/></svg>`;
}

async function stayLocal(ctx: BrowserContext, blocked: string[]) {
  const base = new URL(process.env.E2E_BASE_URL!).host;
  await ctx.route((url) => url.host !== base, (route) => {
    const url = route.request().url();
    if (new URL(url).host === COVER_HOST) return route.fulfill({ contentType: 'image/svg+xml', body: coverSvg(url) });
    blocked.push(url);
    return route.abort();
  });
}

async function viewSession(browser: Browser, view: { width: number; height: number; dark?: boolean }, blocked: string[]) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: view.width, height: view.height },
    colorScheme: view.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  await stayLocal(ctx, blocked);
  return { ctx, page: await ctx.newPage() };
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
  await snap(page, '259', name);
}

const filterBox = (page: Page) => page.getByRole('checkbox', { name: /^Only show books in / });

test('#259: the language filter setting saves through the Library tab and reads back', async ({ browser }) => {
  test.setTimeout(180_000);
  expect(printenv('rmab', 'HTTPS_PROXY'), 'rmab must run with --overrides abs-fake-metadata').toBe(FAKE_PROXY);

  const rmab = await Rmab.loginAdmin();
  const before = (await rmab.get<{ audibleLanguageFilter: boolean; audibleRegion: string }>('/api/admin/settings'));
  const blocked: string[] = [];
  const { ctx, page } = await viewSession(browser, VIEWS[0], blocked);
  try {
    await page.goto('/admin/settings');
    const box = filterBox(page);
    await expect(box).toBeVisible({ timeout: 30_000 });
    const labelBefore = await page.getByText(/^Only show books in /).textContent();
    const checkedBefore = await box.isChecked();

    // The label follows the region select (not saved)
    await page.getByLabel('Audible Region').selectOption('de');
    const labelGerman = await page.getByText(/^Only show books in /).textContent();
    await page.getByLabel('Audible Region').selectOption(before.audibleRegion || 'us');

    // Test Connection, tick, Save
    await page.getByRole('button', { name: 'Test Connection' }).click();
    await expect(page.getByText(/Connected to Audiobookshelf/).first()).toBeVisible({ timeout: 30_000 });
    await box.check();
    const putP = page.waitForRequest((r) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/admin/settings/audible');
    const putResP = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/admin/settings/audible');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    const putBody = (await putP).postDataJSON();
    const putStatus = (await putResP).status();

    await page.reload();
    await expect(filterBox(page)).toBeVisible({ timeout: 30_000 });
    const checkedAfterReload = await filterBox(page).isChecked();
    const after = await rmab.get<{ audibleLanguageFilter: boolean }>('/api/admin/settings');

    // A non-boolean is refused; then off again through the route
    const bad = await rmab.raw('PUT', '/api/admin/settings/audible', { region: before.audibleRegion || 'us', languageFilter: 'true' });
    const badBody = await bad.json();
    const afterBad = await rmab.get<{ audibleLanguageFilter: boolean }>('/api/admin/settings');
    const off = await rmab.raw('PUT', '/api/admin/settings/audible', { region: before.audibleRegion || 'us', languageFilter: false });
    const afterOff = await rmab.get<{ audibleLanguageFilter: boolean }>('/api/admin/settings');

    writeEvidence('259/settings-result.json', {
      before: before.audibleLanguageFilter, labelBefore, checkedBefore, labelGerman, putBody, putStatus, checkedAfterReload,
      after: after.audibleLanguageFilter, badStatus: bad.status, badBody, afterBad: afterBad.audibleLanguageFilter,
      offStatus: off.status, afterOff: afterOff.audibleLanguageFilter, browserBlocked: blocked,
    });

    expect.soft(before.audibleLanguageFilter, 'off by default').toBe(false);
    expect.soft(checkedBefore, 'box unchecked by default').toBe(false);
    expect.soft(labelBefore).toBe('Only show books in English');
    expect.soft(labelGerman, 'label follows the region').toBe('Only show books in German');
    expect.soft(putBody, 'saved with the region').toEqual({ region: before.audibleRegion || 'us', languageFilter: true });
    expect.soft(putStatus).toBe(200);
    expect.soft(checkedAfterReload, 'checked after a reload').toBe(true);
    expect.soft(after.audibleLanguageFilter, 'GET after save').toBe(true);
    expect.soft(bad.status, 'string value refused').toBe(400);
    expect.soft(badBody).toEqual({ success: false, error: 'languageFilter must be true or false' });
    expect.soft(afterBad.audibleLanguageFilter, 'nothing written on a 400').toBe(true);
    expect.soft(off.status).toBe(200);
    expect.soft(afterOff.audibleLanguageFilter, 'off again').toBe(false);
  } finally {
    await ctx.close();
  }
});

for (const view of VIEWS) {
  test(`#259: settings control at ${view.name}`, async ({ browser }) => {
    const blocked: string[] = [];
    const { ctx, page } = await viewSession(browser, view, blocked);
    try {
      await page.goto('/admin/settings');
      const box = filterBox(page);
      await expect(box).toBeVisible({ timeout: 30_000 });
      await box.check();
      await page.getByLabel('Audible Region').scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -80));
      await shot(page, `1-settings-control-${view.name}`);
    } finally {
      await ctx.close();
    }
  });
}

/**
 * Replays /api/audiobooks/search; records every page asked for. Answers send only what the
 * real route can: its totalResults is the page's own result count.
 */
async function replaySearch(page: Page, answer: (q: string, pageNo: number) => object, asked: string[]) {
  await page.route((url) => url.pathname === '/api/audiobooks/search', (route) => {
    const url = new URL(route.request().url());
    asked.push(`${url.searchParams.get('q')}#${url.searchParams.get('page')}`);
    return route.fulfill({ json: answer(url.searchParams.get('q') ?? '', Number(url.searchParams.get('page'))) });
  });
}

async function typeSearch(page: Page, query: string) {
  await page.goto('/search');
  await page.getByPlaceholder('Search by title, author, or narrator...').fill(query);
}

for (const view of VIEWS) {
  test(`#259: REPLAY (page.route) search with hidden results at ${view.name}`, async ({ browser }) => {
    const blocked: string[] = [];
    const asked: string[] = [];
    const { ctx, page } = await viewSession(browser, view, blocked);
    try {
      // Replay, not the live route: the harness can't answer RMAB's catalog call.
      await replaySearch(page, () => ({
        success: true, results: BOOKS, totalResults: BOOKS.length, page: 1, hasMore: true, hiddenCount: 47, filterLanguage: 'English',
      }), asked);
      await typeSearch(page, 'stormlight archive');
      await expect(page.getByText('47 in other languages hidden')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(BOOKS[0].title).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
      await shot(page, `2-search-hidden-${view.name}`);
    } finally {
      await ctx.close();
    }
  });
}

test('#259: REPLAY (page.route) search where every page is hidden stops after 4 automatic loads', async ({ browser }) => {
  const blocked: string[] = [];
  const asked: string[] = [];
  const { ctx, page } = await viewSession(browser, VIEWS[0], blocked);
  try {
    await replaySearch(page, (_q, pageNo) => ({
      success: true, results: [], totalResults: 0, page: pageNo, hasMore: true, hiddenCount: 50, filterLanguage: 'English',
    }), asked);
    await typeSearch(page, 'english title');
    await expect(page.getByText('No results in English so far')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('250 in other languages hidden')).toBeVisible();
    await page.waitForTimeout(2_000);
    const automatic = [...asked];
    await shot(page, '2-search-all-hidden-1280-light');

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText('500 in other languages hidden')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    const afterClick = [...asked];
    writeEvidence('259/search-all-hidden.json', { automatic, afterClick, browserBlocked: blocked });

    expect.soft([...new Set(automatic)], 'page 1 plus 4 automatic loads').toEqual([1, 2, 3, 4, 5].map((n) => `english title#${n}`));
    expect.soft([...new Set(afterClick)].length, 'a click allows 4 more after its own').toBe(10);
    await expect(page.getByText(/No results found/)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('#259: REPLAY (page.route) search with hide-available emptying page 1 keeps the Load more bar', async ({ browser }) => {
  const blocked: string[] = [];
  const asked: string[] = [];
  const { ctx, page } = await viewSession(browser, VIEWS[0], blocked);
  try {
    // The user's own "Hide Available" preference (PreferencesContext reads it from localStorage)
    await ctx.addInitScript(() => localStorage.setItem('preferences', JSON.stringify({ hideAvailable: true })));
    const owned = BOOKS.map((b) => ({ ...b, isAvailable: true }));
    const fresh = { ...BOOKS[0], asin: 'B0E2E25904', title: 'Rhythm of War' };
    await replaySearch(page, (_q, pageNo) => pageNo === 1
      ? { success: true, results: owned, totalResults: owned.length, page: 1, hasMore: true, hiddenCount: 47, filterLanguage: 'English' }
      : { success: true, results: [fresh], totalResults: 1, page: pageNo, hasMore: false, hiddenCount: 12, filterLanguage: 'English' }, asked);
    await typeSearch(page, 'stormlight archive');
    await expect(page.getByText('All results so far are already available')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('47 in other languages hidden')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
    await expect(page.getByText(/No results found/)).toHaveCount(0);
    await page.waitForTimeout(1_000);
    const beforeClick = [...asked];
    await shot(page, '2-search-hide-available-more-1280-light');

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText('Rhythm of War').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('59 in other languages hidden')).toBeVisible();
    writeEvidence('259/search-hide-available-more.json', { beforeClick, afterClick: [...asked], browserBlocked: blocked });

    expect.soft([...new Set(beforeClick)], 'no automatic load while page 1 holds results').toEqual(['stormlight archive#1']);
    expect.soft([...new Set(asked)], 'the click loads page 2').toEqual(['stormlight archive#1', 'stormlight archive#2']);
  } finally {
    await ctx.close();
  }
});

for (const view of VIEWS) {
  test(`#259: REPLAY (page.route) series search hidden state at ${view.name}`, async ({ browser }) => {
    const blocked: string[] = [];
    const { ctx, page } = await viewSession(browser, view, blocked);
    try {
      await page.route((url) => url.pathname === '/api/series/search', (route) =>
        route.fulfill({ json: { success: true, series: SERIES.slice(0, 6), query: 'expeditionary force', hiddenCount: 6, filterLanguage: 'English' } })
      );
      await page.goto('/series?q=expeditionary%20force');
      await expect(page.getByText('6 in other languages hidden')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(SERIES[0].title, { exact: true }).first()).toBeVisible();
      await shot(page, `3-series-hidden-${view.name}`);
    } finally {
      await ctx.close();
    }
  });
}

test('#259: REPLAY (page.route) series search with every series hidden', async ({ browser }) => {
  const blocked: string[] = [];
  const { ctx, page } = await viewSession(browser, VIEWS[0], blocked);
  try {
    await page.route((url) => url.pathname === '/api/series/search', (route) =>
      route.fulfill({ json: { success: true, series: [], query: 'cosmere', hiddenCount: 7, filterLanguage: 'English' } })
    );
    await page.goto('/series?q=cosmere');
    await expect(page.getByText('No series in English for "cosmere"')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('7 in other languages hidden')).toBeVisible();
    await expect(page.getByText(/No series found/)).toHaveCount(0);
    await shot(page, '3-series-all-hidden-1280-light');
  } finally {
    await ctx.close();
  }
});
