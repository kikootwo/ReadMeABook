/**
 * Component: E2E #177 Library page (/library on the built image, three viewers)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Default flags; exec bridge. Seeds ten books over psql (every status group, a delivered book merged
 * with its library row, four scan-only books, three authors with several books each) owned by a
 * requester, another user and the admin (the users are added by the admin, not signed up, so a
 * rerun on a kept stack stays under the sign-up limit). Through the real page: the admin's grid
 * (1280 light/dark, 768, 375 dark), one colour per status group, status line contrast, author
 * groups, a typed search costing one list call, the Problem and On the way filters, the filter
 * sheet at 375, the live overlay flipping a card within 10 s, a book leaving live settling with one
 * list call, the empty state (the real response emptied in the browser: the stack's library is
 * never empty), the detail with actions and Path, Search again with its toast over the open detail
 * (its search job then runs for real, so the action's reload count is left to the unit tests). The
 * requester sees their own error and history and opens Interactive search over the detail (the
 * page behind stays locked); it is gone once their access is off. The other
 * user sees public fields only and the page never calls the request detail route. The header for an
 * admin with a 16 character name, BookDate shown and an update available fits at 768, 1024, 1100
 * and 1280, with the update dot at 1024-1279 (option B, not shipped, drawn by CSS for comparison).
 * Evidence: `177p/*.jpg`, `177p/header.json`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { test, expect, type Page } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, loginAdminUi, Rmab, snap, waitFor, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import {
  blurFocus, card, cleanupPageSeeds, contextFor, DELIVERED_PATH, FAILED_ERROR, headerFigures, HEADER_OPTION_B_CSS, lowestStatusLineContrast,
  recordListCalls, seedBooks, TITLES, viewer, type Viewer,
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
  // One colour per status group: pending and searching cards carry the amber "On the way" dot
  for (const title of [TITLES.pending, TITLES.searching]) {
    await expect(card(page, title).locator('.bg-amber-400'), title).toHaveCount(1);
    await expect(card(page, title).locator('.bg-blue-400'), title).toHaveCount(0);
  }
  const contrast = await lowestStatusLineContrast(page);
  expect(contrast.ratio, `lowest status line contrast in light mode: ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'grid-1280-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // A downloading card: status pill and progress bar
  await card(page, TITLES.downloading).scrollIntoViewIfNeeded();
  await shot(page, 'card-downloading');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Live overlay: a status change reaches the card without a list reload (processing is written
  // with progress 100, as the app does; the card then says what it is doing, #216)
  psql(`update requests set status = 'processing', progress = 100, updated_at = now() where id = ${sqlStr(requestIds.downloading)}`);
  await expect(card(page, TITLES.downloading)).toHaveAttribute('aria-label', /Organizing files/, { timeout: 10_000 });

  // The book leaves live (now available): one settle, so exactly one list call
  const listCalls = recordListCalls(page);
  psql(`update requests set status = 'available', completed_at = now(), updated_at = now() where id = ${sqlStr(requestIds.downloading)}`);
  await expect(card(page, TITLES.downloading)).toHaveAttribute('aria-label', /In your library/, { timeout: 15_000 });
  await page.waitForTimeout(2500); // past a second settle's window
  expect(listCalls, 'list calls after the book left live').toHaveLength(1);

  // Group by author: one header per author
  await page.getByRole('group', { name: 'Group by' }).getByRole('button', { name: 'Author' }).click();
  await expect(page).toHaveURL(/group=author/);
  await expect(page.getByRole('heading', { name: /Mara Quill/ })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /Odette Marsh/ })).toHaveCount(1);
  await shot(page, 'grouped-by-author');
  await page.getByRole('group', { name: 'Group by' }).getByRole('button', { name: 'None' }).click();

  // Search with no results, then cleared
  listCalls.length = 0;
  await page.getByRole('searchbox', { name: 'Search the library' }).pressSequentially('zzqx nothing here', { delay: 40 });
  await expect(page.getByText('No books match')).toBeVisible();
  expect(listCalls.filter((c) => c.includes('q=')), 'one list call for the typed search (300 ms debounce)').toHaveLength(1);
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
  // The On the way tile, rail entry and cards share one colour
  await rail.getByRole('checkbox', { name: /^On the way/ }).check();
  await expect(card(page, TITLES.failed)).toHaveCount(0);
  await expect(card(page, TITLES.pending)).toBeVisible();
  await shot(page, 'colours-on-the-way');
  await page.getByLabel('Active filters').getByRole('button', { name: 'Clear all' }).click();
  await expect(card(page, TITLES.failed)).toBeVisible();

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
  await expect(page.getByRole('group', { name: 'Group by' }).getByText('Group', { exact: true })).toBeVisible();
  await blurFocus(page);
  await shot(page, 'grid-375-dark');
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('checkbox', { name: /^Problem/ })).toBeVisible();
  await page.waitForTimeout(400); // the sheet's slide-in
  await blurFocus(page);
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
  await expect(page.getByRole('searchbox')).toHaveCount(0); // nothing to search, sort or filter
  await expect(page.getByRole('complementary', { name: 'Filters' })).toHaveCount(0);
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

    // Interactive search over the detail: on top, the page behind stays locked, the detail stays open
    const overflow = () => page.evaluate(() => document.body.style.overflow);
    await detail.getByRole('button', { name: 'Interactive search' }).click();
    const close = page.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeVisible();
    await page.waitForTimeout(300);
    expect(await overflow(), 'body locked while Interactive search is open').toBe('hidden');
    const onTop = await close.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el || el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(onTop, 'the Interactive search close button is the top element at its centre').toBe(true);
    await shot(page, 'interactive-over-detail');
    await close.click();
    await expect(close).toBeHidden();
    await expect(detail).toBeVisible();
    expect(await overflow(), 'body locked again once Interactive search closes').toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    expect(await overflow(), 'body unlocked once the detail closes').toBe('');

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

test('#177 page: the admin header fits at 768, 1024, 1100 and 1280 (16 character name, BookDate, an update)', async ({ browser, baseURL }) => {
  const ctx = await contextFor(browser, baseURL!, longAdmin);
  const page = await ctx.newPage();
  await page.route('**/api/bookdate/config', (route) => route.fulfill({ json: { config: { isVerified: true, isEnabled: true } } }));
  // An update is available (the image's e2e version reads as 0, so any release is newer)
  await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ json: { version: '99.0.0' } }));
  const updateDot = page.locator('header a[data-update-available="true"]');
  const figures: Record<string, any> = {};
  try {
    for (const width of [1024, 1100, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await openLibrary(page);
      if (width >= 1024) await expect(page.locator('header nav').getByRole('link', { name: 'BookDate' })).toBeVisible();
      await expect(updateDot, `${width}: the update notice is in the header`).toBeVisible();
      figures[`w${width}`] = await headerFigures(page);
      if (width === 1100) await shot(page, 'header-1100-update');
      else if (width !== 1280) {
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

    for (const key of ['w768', 'w1024', 'w1100', 'w1280']) {
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

  // The delivered book has a path; the failed one has none, so no Path row
  await card(page, TITLES.delivered).click();
  const delivered = page.getByRole('dialog', { name: TITLES.delivered });
  await expect(delivered.getByText(DELIVERED_PATH)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(delivered).toBeHidden();

  // At 375 the detail is a bottom sheet (dark)
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await card(page, TITLES.failed).click();
  await expect(page.getByRole('dialog', { name: TITLES.failed }).getByText('Request history')).toBeVisible();
  await page.waitForTimeout(400); // the sheet's slide-in
  await blurFocus(page);
  await shot(page, 'detail-375');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });

  await card(page, TITLES.failed).click();
  const detail = page.getByRole('dialog', { name: TITLES.failed });
  await expect(detail).toBeVisible();
  await expect(detail.getByText(FAILED_ERROR)).toBeVisible();
  await expect(detail.getByText('Path', { exact: true })).toHaveCount(0);
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
  // The book left "failed"; the detail stays open and never shows the old error under a new badge
  await expect(detail).toBeVisible();
  await expect(detail.getByText(FAILED_ERROR)).toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
});
