/**
 * Component: E2E regression #556 (approving an unreleased book waits for its release date)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Seeds requests awaiting approval for a book released on 2099-05-05, then approves each from the
 * admin dashboard's approval card (1280 px light, 375 px dark). With "Skip unreleased books in
 * automatic searches" at its default (on), the toast names the release date, the Recent Requests
 * row shows "Awaiting Release", the row is `awaiting_release` in the database, and fake Prowlarr
 * sees no search. On main the approve set `pending` and queued a search at once.
 * Snapshots come before the checks (`expect.soft`), so a run on an older image still leaves its shots.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, snap, writeEvidence } from '../../lib/harness';
import { psql, sqlStr, adminUserId } from './library-delete-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '556';
const RELEASE_DAY = '2099-05-05';
const TOAST_TEXT = 'Request approved; it will be searched on its release date (May 5, 2099)';

function seedAwaitingApproval(n: number): { title: string; bookId: string; requestId: string } {
  const title = `E2E 556 Future Book ${n}`;
  const bookId = psql(
    `insert into audiobooks (id, audible_asin, title, author, narrator, status, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(`E2E556${n}X`)}, ${sqlStr(title)}, 'E2E 556 Author', 'E2E Narrator', 'requested', now(), now()) returning id`
  ).split('\n')[0];
  const requestId = psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, release_date, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(bookId)}, 'audiobook', 'awaiting_approval', 0, ${sqlStr(RELEASE_DAY)}, now(), now()) returning id`
  ).split('\n')[0];
  return { title, bookId, requestId };
}

async function session(browser: Browser, opts: { width: number; height: number; dark: boolean }) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  return { ctx, page: await ctx.newPage() };
}

const settle = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

/** Approve from the dashboard card; snap the toast, then the Recent Requests row. */
async function approveFromCard(page: Page, title: string, shot: string) {
  await page.goto('/admin');
  const card = page.locator('div.relative', { has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Approve' }).click();
  const toast = page.locator('div.fixed.top-4.right-4 > div').first();
  await expect(toast).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const toastText = (await toast.innerText()).trim();
  await snap(page, DIR, `toast-${shot}`);

  const row = page.locator('tr', { hasText: title });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText(/Awaiting Release|Pending|Searching|Awaiting Search/, { timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
  await settle(page);
  const rowText = (await row.innerText()).replace(/\s+/g, ' ').trim();
  await snap(page, DIR, `row-${shot}`);
  return { toastText, rowText };
}

test('#556: approving an unreleased book waits for its release date instead of searching', async ({ browser }) => {
  const books = [1, 2].map(seedAwaitingApproval);
  const since = Math.max(0, ...(await fakeArr.requests()).map((r) => r.seq));
  const result: Record<string, unknown> = {};
  try {
    {
      const { ctx, page } = await session(browser, { width: 1280, height: 800, dark: false });
      result.light1280 = await approveFromCard(page, books[0].title, '1280-light');
      await ctx.close();
    }
    {
      const { ctx, page } = await session(browser, { width: 375, height: 812, dark: true });
      result.dark375 = await approveFromCard(page, books[1].title, '375-dark');
      await ctx.close();
    }
    // Give a wrongly queued search time to reach fake Prowlarr before counting
    await new Promise((r) => setTimeout(r, 8_000));
    const ids = books.map((b) => sqlStr(b.requestId)).join(', ');
    result.statuses = psql(`select status from requests where id in (${ids}) order by status`).split('\n');
    result.prowlarrSearches = (await fakeArr.requests(since))
      .filter((r) => r.service === 'prowlarr' && r.path === '/api/v1/search')
      .map((r) => r.query);
  } finally {
    writeEvidence(`${DIR}/result.json`, result);
    const bookIds = books.map((b) => sqlStr(b.bookId)).join(', ');
    psql(`delete from requests where audiobook_id in (${bookIds}); delete from audiobooks where id in (${bookIds});`);
  }

  for (const key of ['light1280', 'dark375']) {
    const r = result[key] as { toastText: string; rowText: string } | undefined;
    expect.soft(r?.toastText ?? '', `${key} toast`).toContain(TOAST_TEXT);
    expect.soft(r?.rowText ?? '', `${key} row badge`).toContain('Awaiting Release');
  }
  expect.soft(result.statuses, 'both requests wait for release').toEqual(['awaiting_release', 'awaiting_release']);
  expect.soft(result.prowlarrSearches, 'fake Prowlarr saw no search').toEqual([]);
});
