/**
 * Component: E2E regression #309 (Audible sub-categories in the home-section picker)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata. RMAB's own Audible calls are CONNECT
 * tunnels the fake metadata proxy refuses with 403, so no real Audible host is reached:
 *   1  GET /api/audible/categories on the real path answers 200 with no categories (catalog refused).
 *   2  Labelled replay (page.route): the picker gets the route's output for the recorded US catalog
 *      answer (309-categories.json = parseCatalogCategories(us-categories-two-levels.json)).
 *      Customize home → Category → "Sub-categories of Literature & Fiction" (aria-expanded) →
 *      Horror → the real PUT saves it; the home page shows a "Horror" section; the real
 *      GET /api/user/home-sections and /api/audiobooks/category/<Horror id> answer for it.
 *   3  Keyboard at 375 px dark: Tab reaches the toggle, Enter expands it, Tab reaches the first sub-category;
 *      the filter shows Horror under its parent. Snapshots of the picker at 1280 light, 375 dark.
 * The browser never leaves the RMAB origin: every other request is aborted.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, snap, stackExecSync, writeEvidence } from '../../lib/harness';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const FAKE_PROXY = 'http://fake-arr:9898';
const LIT = '18574426011';
const HORROR = '18574490011';
/** The route's answer for the recorded US two-level catalog answer (unit-test fixture) */
const REPLAY = JSON.parse(fs.readFileSync(path.join(__dirname, '309-categories.json'), 'utf8'));
const DEFAULT_SECTIONS = [
  { sectionType: 'popular', categoryId: null, categoryName: null, sortOrder: 0 },
  { sectionType: 'new_releases', categoryId: null, categoryName: null, sortOrder: 1 },
];

type Section = { sectionType: string; categoryId: string | null; categoryName: string | null; sortOrder: number };

const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

async function stayLocal(ctx: BrowserContext, blocked: string[]) {
  const base = new URL(process.env.E2E_BASE_URL!).host;
  await ctx.route((url) => url.host !== base, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
}

async function viewSession(browser: Browser, opts: { width: number; height: number; dark: boolean }, blocked: string[]) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  await stayLocal(ctx, blocked);
  const page = await ctx.newPage();
  // Labelled replay: the catalog can't be reached here, so the picker gets the route's recorded output.
  await page.route('**/api/audible/categories', (route) => route.fulfill({ json: REPLAY }));
  return { ctx, page };
}

async function shot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
  await snap(page, '309', name);
}

/** Scroll the picker so the parent row (with its toggle) sits at the top of the list */
async function scrollGroupToTop(toggle: Locator) {
  await toggle.evaluate((btn) => {
    const row = btn.closest('li')!;
    const list = row.closest('ul')!;
    list.scrollTop = row.offsetTop - list.offsetTop;
  });
}

async function openPicker(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize home page' }).click();
  await page.getByRole('button', { name: 'Category', exact: true }).click();
  const picker = page.getByRole('list', { name: 'Audible categories' });
  await expect(picker).toBeVisible();
  return picker;
}

test('#309: a sub-category (Horror) is picked under its parent, saved, and shown on the home page', async ({ browser }) => {
  test.setTimeout(180_000);
  const obs: Record<string, unknown> = {};

  // 0. Guard: RMAB goes through the fake metadata proxy (never the real Audible).
  expect(printenv('rmab', 'HTTPS_PROXY'), 'rmab must run with --overrides abs-fake-metadata').toBe(FAKE_PROXY);
  const rmab = await Rmab.loginAdmin();
  const put = (sections: Section[]) => rmab.raw('PUT', '/api/user/home-sections', { sections });
  expect((await put(DEFAULT_SECTIONS)).status).toBe(200);

  // 1. The real route, catalog refused: 200, no categories, no crash.
  const live = await rmab.raw('GET', '/api/audible/categories');
  obs.liveRoute = { status: live.status, body: await live.json() };
  expect(live.status).toBe(200);

  const blocked: string[] = [];
  try {
    // 2. Pick Horror under Literature & Fiction at 1280 px light.
    {
      const { ctx, page } = await viewSession(browser, { width: 1280, height: 800, dark: false }, blocked);
      try {
        const picker = await openPicker(page);
        const toggle = picker.getByRole('button', { name: 'Sub-categories of Literature & Fiction' });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(picker.getByRole('button', { name: 'Horror', exact: true })).toHaveCount(0);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const group = page.getByRole('list', { name: 'Literature & Fiction sub-categories' });
        await expect(group.getByRole('button')).toHaveCount(18);
        await scrollGroupToTop(toggle);
        await shot(page, 'picker-1280-light');

        const filter = page.getByRole('searchbox', { name: 'Filter categories' });
        await filter.fill('horror');
        await expect(group.getByRole('button')).toHaveCount(1);
        await shot(page, 'picker-filter-1280-light');
        await filter.fill('');
        await expect(group.getByRole('button')).toHaveCount(18);

        const saved = page.waitForResponse((r) => r.url().endsWith('/api/user/home-sections') && r.request().method() === 'PUT');
        await group.getByRole('button', { name: 'Horror', exact: true }).click();
        const res = await saved;
        obs.putStatus = res.status();
        obs.putBody = JSON.parse(res.request().postData() || '{}');
        expect(res.status()).toBe(200);
        await expect(page.getByRole('button', { name: 'Remove Horror' })).toBeVisible();
        await shot(page, 'added-1280-light');

        await page.getByRole('button', { name: 'Close' }).click();
        await expect(page.getByRole('heading', { name: 'Horror', exact: true })).toBeVisible();
        await page.getByRole('heading', { name: 'Horror', exact: true }).scrollIntoViewIfNeeded();
        await shot(page, 'home-section-1280-light');
      } finally {
        await ctx.close();
      }
    }

    const sections = await rmab.get<{ sections: Section[] }>('/api/user/home-sections');
    obs.savedSections = sections.sections;
    expect(sections.sections.map(({ sectionType, categoryId, categoryName }) => ({ sectionType, categoryId, categoryName }))).toEqual([
      { sectionType: 'popular', categoryId: null, categoryName: null },
      { sectionType: 'new_releases', categoryId: null, categoryName: null },
      { sectionType: 'category', categoryId: HORROR, categoryName: 'Horror' },
    ]);
    const books = await rmab.raw('GET', `/api/audiobooks/category/${HORROR}?page=1&limit=20`);
    obs.categoryBooks = { status: books.status, body: await books.json() };
    expect(books.status).toBe(200);

    // 3. Keyboard and filter at 375 px dark.
    {
      const { ctx, page } = await viewSession(browser, { width: 375, height: 812, dark: true }, blocked);
      try {
        const picker = await openPicker(page);
        const toggle = picker.getByRole('button', { name: 'Sub-categories of Literature & Fiction' });
        await picker.getByRole('button', { name: 'Literature & Fiction', exact: true }).focus();
        await page.keyboard.press('Tab');
        await expect(toggle).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const group = page.getByRole('list', { name: 'Literature & Fiction sub-categories' });
        await page.keyboard.press('Tab');
        await expect(group.getByRole('button').first()).toBeFocused();
        // Horror is already a section: listed, disabled, "Added".
        await expect(group.getByRole('button', { name: /^Horror/ })).toBeDisabled();
        await scrollGroupToTop(toggle);
        await shot(page, 'picker-375-dark');

        await page.getByRole('searchbox', { name: 'Filter categories' }).fill('horr');
        await expect(group.getByRole('button')).toHaveCount(1);
        await expect(picker.getByRole('button', { name: 'Comedy & Humor', exact: true })).toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        obs.horizontalOverflow375 = overflow;
        expect(overflow).toBeLessThanOrEqual(0);
        await shot(page, 'picker-filter-375-dark');
      } finally {
        await ctx.close();
      }
    }
  } finally {
    obs.blocked = blocked;
    writeEvidence('309/result.json', obs);
    await put(DEFAULT_SECTIONS);
  }
});
