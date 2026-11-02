/**
 * Component: E2E regression #546 (toasts are solid in dark mode, so the page doesn't show through)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Deletes seeded failed requests from the admin Recent Requests table:
 *   1  375 px, dark: the DELETE reply is fulfilled with a filesKeptReason, so the table raises its
 *      real two-line warning toast over the admin page header
 *   2  1280 px, dark: plain delete, real success toast
 *   3  1280 px, light: plain delete, real success toast (light colours unchanged)
 * Each shot records the toast's computed background alpha and the text/background contrast (the
 * contrast treats the background as opaque, so it only means something once the alpha is 1).
 * Snapshots come before the checks (`expect.soft`), so a run on an older image still leaves its shots.
 */

import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, writeEvidence } from '../../lib/harness';
import { psql, sqlStr, adminUserId } from './library-delete-helpers';
import { ALREADY_THERE_REASON } from './497-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '546';

function seedFailedRequest(n: number): { title: string; bookId: string } {
  const title = `E2E 546 Toast Book ${n}`;
  const bookId = psql(
    `insert into audiobooks (id, audible_asin, title, author, narrator, status, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(`E2E546${n}X`)}, ${sqlStr(title)}, 'E2E 546 Author', 'E2E Narrator', 'requested', now(), now()) returning id`
  ).split('\n')[0];
  psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(bookId)}, 'audiobook', 'failed', 0, 'e2e fixture: nothing downloaded', now(), now())`
  );
  return { title, bookId };
}

/** Computed background alpha and WCAG contrast of the toast's text on its own background (sRGB via canvas). */
const toastColours = (toast: Locator) =>
  toast.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const lum = ([r, g, b]: number[]) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    const style = getComputedStyle(el);
    const bg = rgba(style.backgroundColor);
    const fg = rgba(style.color);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return {
      background: style.backgroundColor,
      color: style.color,
      backgroundAlpha: Math.round((bg[3] / 255) * 100) / 100,
      contrast: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
    };
  });

async function session(browser: Browser, opts: { width: number; height: number; dark: boolean }) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  return { ctx, page: await ctx.newPage() };
}

async function deleteFromTable(page: Page, title: string): Promise<Locator> {
  await page.goto('/admin');
  const row = page.locator('tr', { hasText: title });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('button[title="Actions"]').click();
  await page.getByRole('menuitem', { name: 'Delete Request' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const toast = page.locator('div.fixed.top-4.right-4 > div').first();
  await expect(toast).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  return toast;
}

test('546: toasts are solid in dark mode', async ({ browser }) => {
  const books = [1, 2, 3].map(seedFailedRequest);
  const result: Record<string, unknown> = {};
  try {
    // 1  Warning toast at 375 px, dark, over the page header
    {
      const { ctx, page } = await session(browser, { width: 375, height: 812, dark: true });
      await page.route(/\/api\/admin\/requests\/[^/?]+(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({ response: res, json: { ...body, details: { ...body.details, filesKeptReason: ALREADY_THERE_REASON } } });
      });
      const toast = await deleteFromTable(page, books[0].title);
      await expect(toast).toContainText('Request deleted; files kept');
      await snap(page, DIR, 'toast-375-dark');
      result.warning375dark = await toastColours(toast);
      await ctx.close();
    }

    // 2  Success toast at 1280 px, dark
    {
      const { ctx, page } = await session(browser, { width: 1280, height: 800, dark: true });
      const toast = await deleteFromTable(page, books[1].title);
      await expect(toast).toContainText('Request deleted successfully');
      await snap(page, DIR, 'toast-1280-dark');
      result.success1280dark = await toastColours(toast);
      await ctx.close();
    }

    // 3  Success toast at 1280 px, light
    {
      const { ctx, page } = await session(browser, { width: 1280, height: 800, dark: false });
      const toast = await deleteFromTable(page, books[2].title);
      await expect(toast).toContainText('Request deleted successfully');
      await snap(page, DIR, 'toast-1280-light');
      result.success1280light = await toastColours(toast);
      await ctx.close();
    }
  } finally {
    writeEvidence(`${DIR}/result.json`, result);
    const ids = books.map((b) => sqlStr(b.bookId)).join(', ');
    psql(`delete from requests where audiobook_id in (${ids}); delete from audiobooks where id in (${ids});`);
  }

  for (const key of ['warning375dark', 'success1280dark', 'success1280light']) {
    const c = result[key] as { backgroundAlpha: number; contrast: number } | undefined;
    expect.soft(c?.backgroundAlpha, `${key} background alpha`).toBe(1);
    expect.soft(c?.contrast ?? 0, `${key} contrast`).toBeGreaterThanOrEqual(4.5);
  }
});
