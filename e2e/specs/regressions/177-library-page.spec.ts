/**
 * Component: E2E #177 Library page (/library on the built image, three viewers)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Default flags; exec bridge. Seeds ten books over psql (every status group, a delivered book merged
 * with its library row, four scan-only books, three authors with several books each) owned by a
 * requester, another user and the admin. Through the real page: the admin's grid (1280 light/dark,
 * 768, 375 dark), author groups, a search with no results, the Problem filter, the filter sheet at
 * 375, the detail with actions, Search again with its toast drawn over the open detail, the live
 * overlay flipping a card within 10 s, and the empty state (the real response emptied in the
 * browser: the stack's library is never empty). The requester sees their own error and history,
 * Interactive search (gone once their interactive search access is off) and no admin actions; the
 * other user sees public fields only and the page never calls the request detail route. The header
 * for an admin with a 16 character name and BookDate shown fits at 768 and 1024 (option B, not
 * shipped, is drawn by CSS for comparison). Evidence: `177p/*.jpg`, `177p/header.json`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { test, expect, type Page } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, loginAdminUi, Rmab, snap, waitFor, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import {
  card, cleanupPageSeeds, contextFor, FAILED_ERROR, headerFigures, HEADER_OPTION_B_CSS, seedBooks, TITLES, viewer, type Viewer,
} from './177-library-page-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });

const DIR = '177p';
let requester: Viewer;
let other: Viewer;
let longAdmin: Viewer;
let requestIds: Record<string, string>;

test.beforeAll(async () => {
  cleanupPageSeeds();
  const admin = await Rmab.loginAdmin();
  requester = await viewer(admin, 'lib177preq');
  other = await viewer(admin, 'lib177pother');
  longAdmin = await viewer(admin, 'lib177padminname', { admin: true }); // 16 characters
  const adminId = psql(`select id from users where role = 'admin' order by created_at limit 1`);
  requestIds = seedBooks({ requester: requester.id, other: other.id, admin: adminId });
  // Row changes are rebuilt in the background: wait until the list carries every scan-only row
  await waitFor('the seeded library rows in the list', async () => {
    const body = await admin.get(`/api/library?limit=120&source=scan`);
    return TITLES.scan.every((t) => body.items.some((i: any) => i.title === t));
  }, { timeoutMs: 60_000, intervalMs: 1_000 });
});

test.afterAll(() => {
  if (execBridgeAvailable()) cleanupPageSeeds();
});

/**
 * Waits for every finite CSS transition and animation (a theme switch fades `transition-colors`
 * text for 150 ms; a toast slides in from the right). The Live pill's endless pulse is skipped.
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const finite = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => null)));
  });
}

/** Evidence shot with the pointer parked in the left gutter (no hover state in the picture), settled. */
async function shot(page: Page, name: string) {
  await page.mouse.move(1, 400);
  await settle(page);
  await snap(page, DIR, name);
}

async function openLibrary(page: Page) {
  await page.goto('/library');
  await expect(card(page, TITLES.failed)).toBeVisible({ timeout: 30_000 });
}

test('#177 page: the admin grid, groups, search, filters, sheet, live overlay and empty state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await loginAdminUi(page);
  await openLibrary(page);
  for (const title of [...Object.values(TITLES).flat()]) await expect(card(page, title), title).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  // Covers line up along a row even beside a two-line title (each cover starts at its card's top)
  const coverDrift = await page.locator('[data-library-card]').evaluateAll((cards) =>
    Math.max(...cards.map((c) => c.firstElementChild!.getBoundingClientRect().top - c.getBoundingClientRect().top))
  );
  expect(coverDrift, 'cover offset inside its card (px)').toBeLessThanOrEqual(1);
  await shot(page, 'grid-1280-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'grid-1280-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // A downloading card: status pill and progress bar
  await card(page, TITLES.downloading).scrollIntoViewIfNeeded();
  await shot(page, 'card-downloading');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Live overlay: a status change reaches the card without a list reload
  psql(`update requests set status = 'processing', updated_at = now() where id = ${sqlStr(requestIds.downloading)}`);
  await expect(card(page, TITLES.downloading)).toHaveAttribute('aria-label', /Processing/, { timeout: 10_000 });

  // Group by author: one header per author
  await page.getByRole('group', { name: 'Group by' }).getByRole('button', { name: 'Author' }).click();
  await expect(page).toHaveURL(/group=author/);
  await expect(page.getByRole('heading', { name: /Mara Quill/ })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /Odette Marsh/ })).toHaveCount(1);
  await shot(page, 'grouped-by-author');
  await page.getByRole('group', { name: 'Group by' }).getByRole('button', { name: 'None' }).click();

  // Search with no results, then cleared
  await page.getByRole('searchbox', { name: 'Search the library' }).fill('zzqx nothing here');
  await expect(page.getByText('No books match')).toBeVisible();
  await expect(page).toHaveURL(/q=zzqx/);
  await shot(page, 'search-no-results');
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(card(page, TITLES.failed)).toBeVisible();

  // The Problem filter from the rail
  const rail = page.getByRole('complementary', { name: 'Filters' });
  const railFit = await rail.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(railFit, 'the rail has no horizontal overflow (every count inside it)').toBeLessThanOrEqual(0);
  await rail.getByRole('checkbox', { name: /^Problem/ }).check();
  await expect(page).toHaveURL(/status=problem/);
  await expect(card(page, TITLES.failed)).toBeVisible();
  await expect(card(page, TITLES.pending)).toHaveCount(0);
  await page.getByLabel('Active filters').getByRole('button', { name: 'Clear all' }).click();
  await expect(card(page, TITLES.pending)).toBeVisible();

  await page.setViewportSize({ width: 768, height: 1024 });
  await shot(page, 'grid-768');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
  await shot(page, 'filter-sheet-768');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeHidden();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByRole('complementary', { name: 'Filters' })).toBeHidden();
  await shot(page, 'grid-375-dark');
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('checkbox', { name: /^Problem/ })).toBeVisible();
  await page.waitForTimeout(400); // the sheet's slide-in
  await shot(page, 'filter-sheet-375');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Empty state: the real responses with every book taken out (an empty library has nothing live)
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  const LIST = /\/api\/library\?/;
  await page.route(LIST, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (route.request().url().includes('live=1')) return route.fulfill({ response: res, json: { ...body, items: [], refreshMs: 0 } });
    const zero = (o: Record<string, number>) => Object.fromEntries(Object.keys(o).map((k) => [k, 0]));
    await route.fulfill({
      response: res,
      json: { ...body, items: [], nextCursor: null, matched: 0, stats: zero(body.stats), groups: body.groups ? [] : null,
        facets: { status: zero(body.facets.status), source: zero(body.facets.source), requestedBy: [] } },
    });
  });
  await page.goto('/library');
  await expect(page.getByText('Nothing here yet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Scan library now' })).toBeVisible();
  await shot(page, 'empty-state');
  await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
  await page.unroute(LIST);
});

test('#177 page: a requester sees their own request, Interactive search until it is turned off', async ({ browser, baseURL }) => {
  const ctx = await contextFor(browser, baseURL!, requester);
  const page = await ctx.newPage();
  try {
    await openLibrary(page);
    await card(page, TITLES.failed).click();
    const detail = page.getByRole('dialog', { name: TITLES.failed });
    await expect(detail.getByText(FAILED_ERROR)).toBeVisible();
    await expect(detail.getByText('You', { exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Interactive search' })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Search again' })).toHaveCount(0);
    await expect(detail.getByRole('link', { name: 'View request' })).toHaveAttribute('href', '/requests');
    await expect(detail.getByText('Path', { exact: true })).toHaveCount(0);
    await shot(page, 'detail-requester');

    psql(`update users set interactive_search_access = false where id = ${sqlStr(requester.id)}`);
    await page.reload();
    await card(page, TITLES.failed).click();
    await expect(page.getByRole('dialog', { name: TITLES.failed }).getByText(FAILED_ERROR)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Interactive search' })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('#177 page: another user sees public fields only and no request detail call', async ({ browser, baseURL }) => {
  const ctx = await contextFor(browser, baseURL!, other);
  const page = await ctx.newPage();
  const detailCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/requests\/[^/?]+/.test(new URL(r.url()).pathname)) detailCalls.push(r.url());
  });
  try {
    await openLibrary(page);
    await card(page, TITLES.failed).click();
    const detail = page.getByRole('dialog', { name: TITLES.failed });
    await expect(detail.getByText('Mara Quill').first()).toBeVisible();
    await expect(detail.getByText('lib177preq').first()).toBeVisible();
    for (const hidden of [FAILED_ERROR, 'Request history', 'Actions', 'Files']) await expect(detail.getByText(hidden, { exact: true }), hidden).toHaveCount(0);
    await shot(page, 'detail-other-user');
    await page.waitForTimeout(1500);
    expect(detailCalls, 'no request detail call for a book the viewer may not see').toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('#177 page: the admin header fits at 768 and 1024 (16 character name, BookDate shown)', async ({ browser, baseURL }) => {
  const ctx = await contextFor(browser, baseURL!, longAdmin);
  const page = await ctx.newPage();
  await page.route('**/api/bookdate/config', (route) => route.fulfill({ json: { config: { isVerified: true, isEnabled: true } } }));
  const figures: Record<string, any> = {};
  try {
    for (const width of [1024, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await openLibrary(page);
      if (width >= 1024) await expect(page.locator('header nav').getByRole('link', { name: 'BookDate' })).toBeVisible();
      figures[`w${width}`] = await headerFigures(page);
      if (width !== 1280) {
        await shot(page, `header-${width}`);
        if (width === 768) await shot(page, 'header-768-option-a');
      }
    }
    const style = await page.addStyleTag({ content: HEADER_OPTION_B_CSS });
    await page.setViewportSize({ width: 768, height: 800 });
    figures.optionB768 = await headerFigures(page);
    await shot(page, 'header-768-option-b');
    await style.evaluate((el) => (el as Element).remove());
    writeEvidence(`${DIR}/header.json`, figures);

    for (const key of ['w768', 'w1024', 'w1280']) {
      const f = figures[key];
      expect.soft(f.pageOverflow, `${key}: page overflow`).toBeLessThanOrEqual(0);
      expect.soft(f.rowOverflow, `${key}: header row overflow`).toBeLessThanOrEqual(0);
      expect.soft(f.navOverflow, `${key}: nav overflow`).toBeLessThanOrEqual(0);
      expect.soft(f.overlap, `${key}: header items overlap`).toBeLessThanOrEqual(0);
      expect.soft(f.logoTruncated, `${key}: logo text truncated`).toBe(false);
    }
    expect.soft(figures.w768.navShown, '768: menu button, not the inline nav').toBe(false);
    expect.soft(figures.w1024.navShown, '1024: inline nav').toBe(true);
  } finally {
    await ctx.close();
  }
});

test('#177 page: the admin detail, Search again and its toast over the open detail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await loginAdminUi(page);
  await openLibrary(page);
  await card(page, TITLES.failed).click();
  const detail = page.getByRole('dialog', { name: TITLES.failed });
  await expect(detail).toBeVisible();
  await expect(detail.getByText(FAILED_ERROR)).toBeVisible();
  await expect(detail.getByText('Request history')).toBeVisible();
  await expect(detail.getByRole('link', { name: 'View request' })).toHaveAttribute('href', `/admin?search=${encodeURIComponent(TITLES.failed)}&type=audiobook`);
  await expect(detail.getByText('lib177preq').first()).toBeVisible();
  await shot(page, 'detail-admin');

  await detail.getByRole('button', { name: 'Search again' }).click();
  const toast = page.getByText(`Searching again for ${TITLES.failed}`);
  await expect(toast).toBeVisible();
  await settle(page); // the toast slides in from beyond the right edge
  // At the toast's centre the toast is the top element and the detail's layer lies under it
  const order = await toast.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const dialog = document.querySelector('[role="dialog"]')!;
    return { toast: stack.findIndex((n) => n === el || el.contains(n) || n.contains(el)), dialog: stack.findIndex((n) => dialog.contains(n) || n === dialog.parentElement) };
  });
  expect(order.toast, `toast is hit at its own centre: ${JSON.stringify(order)}`).toBe(0);
  expect(order.dialog, `the detail layer is under the toast: ${JSON.stringify(order)}`).toBeGreaterThan(0);
  await shot(page, 'toast-over-detail');
  // The book left "failed"; the detail keeps its snapshot and stays open
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
});
