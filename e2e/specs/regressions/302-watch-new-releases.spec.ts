/**
 * Component: E2E regression #302 (watch an author or series for new releases only)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * UI and persistence only: RMAB's own Audible calls can't be faked here, so the release filter
 * itself is proven by unit tests (tests/services/watched-lists-*.test.ts).
 *   1  Author page Watch dialog: Entire catalog preselected and focused; keyboard (arrow, Space)
 *      picks New releases only; Watch sends newReleasesOnly:true; the row's new_releases_since is set.
 *   2  Profile: the author card reads "New releases since <date>", a series watched over the API
 *      reads "Entire catalog". Change → Save disabled until changed; Entire catalog shows the
 *      backlog note; Save clears the cutoff (API + database).
 *   3  Snapshots of the dialog and both cards at 1280 px, 375 px and in dark mode.
 * The author is made up (no real catalog author can match it); its detail and book list are
 * answered in the browser (page.route).
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, writeEvidence, Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });
test.use({ storageState: evidencePath('storage-state.json') });

const AUTHOR = { asin: 'B0E2E302AU', name: 'Quillon Varrowmere' };
/** Never watched: only used to open the Watch dialog for the 375 px / dark snapshots */
const VIEW_AUTHOR = { asin: 'B0E2E302AV', name: 'Ottoline Brackwater' };
const SERIES = { asin: 'B0E2E302SE', title: 'The Glass Orchard Cycle (E2E)' };
const obs: Record<string, unknown> = {};

async function stubAuthor(page: Page, author = AUTHOR) {
  await page.route(`**/api/authors/${author.asin}`, (route) =>
    route.fulfill({ json: { success: true, author: { asin: author.asin, name: author.name, description: 'Made-up author for the #302 harness spec.', genres: [], similar: [] } } })
  );
  await page.route(`**/api/authors/${author.asin}/books**`, (route) =>
    route.fulfill({ json: { success: true, books: [], authorName: author.name, authorAsin: author.asin, totalBooks: 0, hasMore: false, page: 1 } })
  );
}

async function clearWatches(rmab: Rmab) {
  const authors = await rmab.get<{ authors: { id: string; authorAsin: string }[] }>('/api/user/watched-authors');
  for (const a of authors.authors.filter((x) => x.authorAsin === AUTHOR.asin)) await rmab.raw('DELETE', `/api/user/watched-authors/${a.id}`);
  const series = await rmab.get<{ series: { id: string; seriesAsin: string }[] }>('/api/user/watched-series');
  for (const s of series.series.filter((x) => x.seriesAsin === SERIES.asin)) await rmab.raw('DELETE', `/api/user/watched-series/${s.id}`);
}

const dbSince = (table: string, column: string, asin: string) =>
  psql(`select coalesce(to_char(new_releases_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), 'NULL') from ${table} where ${column} = ${sqlStr(asin)}`);

async function openWatchDialog(page: Page, author = AUTHOR) {
  await stubAuthor(page, author);
  await page.goto(`/authors/${author.asin}`);
  await page.getByRole('button', { name: 'Watch Author' }).click();
  await expect(page.getByRole('group', { name: 'What should be requested?' })).toBeVisible();
}

/** Snapshot once the option cards' border/background transitions have finished */
async function shot(page: Page, name: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
  await snap(page, '302', name);
}

const authorCard = (page: Page) => page.locator('div.rounded-xl.p-4', { hasText: AUTHOR.name }).first();
const seriesCard = (page: Page) => page.locator('div.rounded-xl.p-4', { hasText: SERIES.title }).first();

async function viewSession(browser: Browser, opts: { width: number; height: number; dark?: boolean }) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  return { ctx, page: await ctx.newPage() };
}

test('302: watch dialog choice, keyboard selection, and the cutoff it stores', async ({ page }) => {
  const rmab = await Rmab.loginAdmin();
  await clearWatches(rmab);
  await page.setViewportSize({ width: 1280, height: 800 });

  await openWatchDialog(page);
  const entire = page.getByRole('radio', { name: /Entire catalog/ });
  const fresh = page.getByRole('radio', { name: /New releases only/ });
  await expect(entire).toBeChecked();
  await expect(entire).toBeFocused();
  await expect(page.getByText("Request only books released from today on. Older books aren't requested.")).toBeVisible();
  await shot(page, '1-watch-dialog-default');

  // Keyboard only: arrow to the second radio, Space keeps it selected
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(fresh).toBeChecked();
  await expect(fresh).toBeFocused();
  await shot(page, '1-watch-dialog-new-only-keyboard');

  const reqP = page.waitForRequest((r) => r.url().endsWith('/api/user/watched-authors') && r.method() === 'POST');
  const resP = page.waitForResponse((r) => r.url().endsWith('/api/user/watched-authors') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  const [req, res] = await Promise.all([reqP, resP]);
  obs.watchSent = req.postDataJSON();
  obs.watchResponse = { status: res.status(), body: await res.json() };
  expect(obs.watchSent).toMatchObject({ authorAsin: AUTHOR.asin, authorName: AUTHOR.name, newReleasesOnly: true });
  expect(res.status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Watching' })).toBeVisible();

  obs.dbAfterWatch = dbSince('watched_authors', 'author_asin', AUTHOR.asin);
  expect(obs.dbAfterWatch, 'new_releases_since set for the new-only watch').toMatch(/^\d{4}-\d{2}-\d{2}T/);

  // A series watched with the default (entire catalog) over the API
  const series = await rmab.post<{ series: { newReleasesOnly: boolean } }>('/api/user/watched-series', { seriesAsin: SERIES.asin, seriesTitle: SERIES.title });
  obs.seriesWatch = series.series;
  expect(series.series.newReleasesOnly).toBe(false);
  obs.dbSeries = dbSince('watched_series', 'series_asin', SERIES.asin);
  expect(obs.dbSeries).toBe('NULL');
  writeEvidence('302/1-watch.json', obs);
});

test('302: profile cards show the mode; Change back to the entire catalog warns and clears the cutoff', async ({ page }) => {
  const rmab = await Rmab.loginAdmin();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/profile');

  await expect(authorCard(page).getByText(/^New releases since /)).toBeVisible();
  await expect(seriesCard(page).getByText('Entire catalog', { exact: true })).toBeVisible();
  await authorCard(page).scrollIntoViewIfNeeded();
  await shot(page, '2-watched-list-new-only');

  await authorCard(page).getByRole('button', { name: /Change what is requested/ }).click();
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await page.getByRole('radio', { name: /Entire catalog/ }).check();
  const warning = page.getByText(/The next watched-list check requests every book by "Quillon Varrowmere" that isn't in your library/);
  await expect(warning).toBeVisible();
  await expect(save).toBeEnabled();
  await shot(page, '2-change-dialog-backlog-warning');

  const resP = page.waitForResponse((r) => r.url().includes('/api/user/watched-authors/') && r.request().method() === 'PATCH');
  await save.click();
  const res = await resP;
  const patch = { status: res.status(), body: await res.json() };
  expect(patch.status).toBe(200);
  expect(patch.body.author).toMatchObject({ newReleasesOnly: false, newReleasesSince: null });
  await expect(authorCard(page).getByText('Entire catalog', { exact: true })).toBeVisible();
  await shot(page, '2-watched-list-entire');

  const listed = await rmab.get<{ authors: { authorAsin: string; newReleasesOnly: boolean }[] }>('/api/user/watched-authors');
  const db = dbSince('watched_authors', 'author_asin', AUTHOR.asin);
  writeEvidence('302/2-change.json', { patch, listed: listed.authors.find((a) => a.authorAsin === AUTHOR.asin), db });
  expect(listed.authors.find((a) => a.authorAsin === AUTHOR.asin)?.newReleasesOnly).toBe(false);
  expect(db).toBe('NULL');

  // Back to new-only for the snapshots below
  await rmab.raw('PATCH', `/api/user/watched-authors/${patch.body.author.id}`, { newReleasesOnly: true });
});

for (const view of [
  { name: '375', width: 375, height: 812 },
  { name: 'dark', width: 1280, height: 800, dark: true },
  { name: '375-dark', width: 375, height: 812, dark: true },
]) {
  test(`302: dialog and cards at ${view.name}`, async ({ browser }) => {
    const { ctx, page } = await viewSession(browser, view);
    try {
      await openWatchDialog(page, VIEW_AUTHOR);
      await shot(page, `3-${view.name}-watch-dialog`);
      await page.getByRole('button', { name: 'Cancel' }).click();

      await page.goto('/profile');
      await expect(authorCard(page)).toBeVisible();
      await authorCard(page).scrollIntoViewIfNeeded();
      await shot(page, `3-${view.name}-cards`);

      await authorCard(page).getByRole('button', { name: /Change what is requested/ }).click();
      await page.getByRole('radio', { name: /Entire catalog/ }).check();
      await expect(page.getByText(/The next watched-list check requests every book/)).toBeVisible();
      await shot(page, `3-${view.name}-change-dialog`);
      await page.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      await ctx.close();
    }
  });
}

test('302: cleanup', async () => {
  await clearWatches(await Rmab.loginAdmin());
});
