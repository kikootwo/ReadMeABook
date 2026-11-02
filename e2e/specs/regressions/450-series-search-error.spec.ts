/**
 * Component: E2E regression #450 (series search shows a failure instead of "No series found")
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata. RMAB's Audible calls are CONNECT
 * tunnels the fake metadata proxy refuses with 403, so no real Audible host is reached and the
 * series search's catalog call fails on the real input path:
 *   1  /series?q=expeditionary force → GET /api/series/search answers 502 within 10 s; the page shows
 *      "Couldn't get results from Audible" (not "No series found"), no skeleton comes back, no
 *      automatic retry. Try again → a second request → the panel again, focus on Try again.
 *      In this spec's own window the fake recorded rmab CONNECT api.audible.com → 403, and every
 *      metadata-proxy host was a faked one.
 *   2  Snapshots of the failure at 1280 and 375 px, light and dark.
 *   3  Labelled replay (page.route): the normal results state, from the route's output for the
 *      recorded US catalog page (450-series-results.json); covers drawn locally.
 * The browser never leaves the RMAB origin: every other request is aborted (cover URLs answered
 * with a local SVG), so the snapshots make no outbound call either.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, snap, stackExecSync, writeEvidence } from '../../lib/harness';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const QUERY = 'expeditionary force';
const SEARCH_PATH = `/series?q=${encodeURIComponent(QUERY)}`;
const AUDIBLE_HEADING = "Couldn't get results from Audible";
const AUDIBLE_LINE = "Audible didn't return series results. Try again in a moment.";
const FAKE_PROXY = 'http://fake-arr:9898';
/** Hosts the fake metadata proxy stands in for (mirrors e2e/fake-arr/src/metadata.js). */
const FAKED_HOST = /^(api\.audible\.(com|ca|co\.uk|com\.au|fr|de|co\.jp|it|in|es)|(www\.)?audible\.(com|ca|co\.uk|com\.au|fr|de|co\.jp|it|in|es)|api\.audnex\.us)$/;
const COVER_HOST = 'm.media-amazon.com';
/** role="alert" elements other than Next.js's (empty) route announcer */
const PANEL = '[role="alert"]:not(#__next-route-announcer__)';
/** The route's answer for the recorded US "expeditionary force" catalog page (unit-test fixtures) */
const RESULTS = JSON.parse(fs.readFileSync(path.join(__dirname, '450-series-results.json'), 'utf8')) as { asin: string; title: string }[];

type MetaRecord = { seq: number; service: string; host: string; path: string; status?: number; client?: string; method: string };

const VIEWS = [
  { name: '1280-light', width: 1280, height: 800, dark: false },
  { name: '1280-dark', width: 1280, height: 800, dark: true },
  { name: '375-light', width: 375, height: 812, dark: false },
  { name: '375-dark', width: 375, height: 812, dark: true },
];
const REPLAY_VIEWS = [VIEWS[0], VIEWS[3]];

const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

const isSearch = (url: string) => new URL(url).pathname === '/api/series/search';

/** Flat-colour stand-in cover, keyed on the image URL */
function coverSvg(url: string) {
  let h = 0;
  for (const c of url) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="hsl(${h},45%,42%)"/></svg>`;
}

/** Keep the browser on the RMAB origin: covers get a local SVG, anything else is aborted (and recorded). */
async function stayLocal(ctx: BrowserContext, blocked: string[]) {
  const base = new URL(process.env.E2E_BASE_URL!).host;
  await ctx.route((url) => url.host !== base, (route) => {
    const url = route.request().url();
    if (new URL(url).host === COVER_HOST) return route.fulfill({ contentType: 'image/svg+xml', body: coverSvg(url) });
    blocked.push(url);
    return route.abort();
  });
}

async function viewSession(browser: Browser, opts: { width: number; height: number; dark?: boolean }, blocked: string[]) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  await stayLocal(ctx, blocked);
  return { ctx, page: await ctx.newPage() };
}

/** Snapshot once running CSS transitions (button hover/focus colours) have finished */
async function shot(page: Page, name: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
  await snap(page, '450', name);
}

/** Open the search and wait for its failed answer */
async function searchAndFail(page: Page) {
  const started = Date.now();
  const resP = page.waitForResponse((r) => isSearch(r.url()), { timeout: 15_000 });
  await page.goto(SEARCH_PATH);
  const res = await resP;
  return { status: res.status(), body: await res.json().catch(() => null), ms: Date.now() - started };
}

test('#450: a failed series search shows the Audible error, Try again reruns it once', async ({ browser }) => {
  test.setTimeout(180_000);

  // 0. Guards: RMAB goes through the fake metadata proxy (never the real Audible).
  expect(printenv('rmab', 'HTTPS_PROXY'), 'rmab must run with --overrides abs-fake-metadata').toBe(FAKE_PROXY);
  const seq0 = Math.max(0, ...(await fakeArr.requests()).map((r) => r.seq));

  const blocked: string[] = [];
  const { ctx, page } = await viewSession(browser, VIEWS[0], blocked);
  const searches: string[] = [];
  page.on('request', (r) => {
    if (isSearch(r.url())) searches.push(r.url());
  });

  try {
    // 1. The first search fails on the real path.
    const first = await searchAndFail(page);
    const alert = page.locator(PANEL);
    await expect(alert).toContainText(AUDIBLE_HEADING);
    await expect(alert).toContainText(AUDIBLE_LINE);
    await expect(page.getByText(/No series found/)).toHaveCount(0);

    // No skeleton and no automatic retry afterwards
    await page.waitForTimeout(3_000);
    const skeletonsAfter = await page.locator('.animate-pulse').count();
    const searchesBeforeRetry = searches.length;
    await shot(page, '1-error-1280-light');

    // 2. Try again: exactly one more request, the panel again, focus back on the button.
    const retryP = page.waitForResponse((r) => isSearch(r.url()), { timeout: 15_000 });
    await page.getByRole('button', { name: 'Try again' }).click();
    const retry = await retryP;
    const retryStatus = retry.status();
    await expect(alert).toContainText(AUDIBLE_HEADING);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
    await page.waitForTimeout(1_000);
    await shot(page, '1-error-after-retry-1280-light');

    // 3. What the fake recorded in this spec's window.
    const meta = ((await fakeArr.requests(seq0)) as unknown as MetaRecord[]).filter((r) => r.service === 'metadata');
    const lines = meta.map((r) => `${r.client} ${r.method} ${r.host}${r.path} ${r.status}`);
    const catalogRefused = meta.filter((r) => r.client === 'rmab' && r.method === 'CONNECT' && r.host === 'api.audible.com' && r.status === 403);
    const unfakedHosts = meta.filter((r) => !FAKED_HOST.test(String(r.host || '').toLowerCase())).map((r) => `${r.client} ${r.method} ${r.host}`);

    writeEvidence('450/result.json', {
      first, retryStatus, searches, searchesBeforeRetry, skeletonsAfter,
      rmabCatalogConnects403: catalogRefused.length, unfakedHosts, metadataCalls: lines, browserBlocked: blocked,
    });

    expect.soft(first.status, 'route answer').toBe(502);
    expect.soft(first.body?.error, 'route error code').toBe('AudibleUnavailable');
    expect.soft(first.ms, 'failed within the search budget').toBeLessThan(10_000);
    expect.soft(skeletonsAfter, 'no skeleton after the failure').toBe(0);
    expect.soft(searchesBeforeRetry, 'no automatic retry').toBe(1);
    expect.soft(retryStatus, 'Try again answer').toBe(502);
    expect.soft(searches.length, 'Try again sent exactly one request').toBe(2);
    expect.soft(catalogRefused.length, 'rmab CONNECT api.audible.com refused with 403').toBeGreaterThanOrEqual(1);
    expect.soft(unfakedHosts, 'every metadata proxy call in this window targeted a faked host').toEqual([]);
  } finally {
    await ctx.close();
  }
});

for (const view of VIEWS) {
  test(`#450: failure panel at ${view.name}`, async ({ browser }) => {
    const blocked: string[] = [];
    const { ctx, page } = await viewSession(browser, view, blocked);
    try {
      const { status } = await searchAndFail(page);
      expect(status).toBe(502);
      const alert = page.locator(PANEL);
      await expect(alert).toContainText(AUDIBLE_HEADING);
      const box = await page.getByRole('button', { name: 'Try again' }).boundingBox();
      expect(box?.height ?? 0, 'Try again target height').toBeGreaterThanOrEqual(44);
      await alert.scrollIntoViewIfNeeded();
      await shot(page, `2-error-${view.name}`);
    } finally {
      await ctx.close();
    }
  });
}

for (const view of REPLAY_VIEWS) {
  test(`#450: REPLAY (page.route) normal results at ${view.name}`, async ({ browser }) => {
    const blocked: string[] = [];
    const { ctx, page } = await viewSession(browser, view, blocked);
    try {
      // Replay, not the live route: the harness can't answer RMAB's catalog call.
      await page.route((url) => url.pathname === '/api/series/search', (route) =>
        route.fulfill({ json: { success: true, series: RESULTS, query: QUERY } })
      );
      await page.goto(SEARCH_PATH);
      await expect(page.getByText(RESULTS[0].title, { exact: true }).first()).toBeVisible();
      await expect(page.locator(PANEL)).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));
      await shot(page, `3-replay-results-${view.name}`);
    } finally {
      await ctx.close();
    }
  });
}
