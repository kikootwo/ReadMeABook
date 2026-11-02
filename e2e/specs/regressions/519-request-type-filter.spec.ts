/**
 * Component: E2E regression #519 (Type filter in admin Request Management)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with the default flags (trusted, exec bridge; no overrides). Seeds two fake-ASIN books, one
 * with a failed ebook request and one with an available audiobook request (admin-owned, rows
 * only, so no job picks them up). On /admin, Request Management: the Type select lists All Types,
 * Audiobooks and Ebooks; Ebooks sends `type=ebook`, the answer holds only ebook requests (ours
 * listed, the audiobook one not), the page URL gets `?type=ebook` and keeps it on reload;
 * Audiobooks is the converse; Clear returns to All Types (no `type` in the URL, both rows back).
 * The API ignores an unknown type. Evidence (519/): `type-dropdown-open.jpg` (the select expanded
 * with `size=3` for the capture, as headless Chromium never paints a native select popup),
 * `type-ebooks.jpg`, and `519/result.json`.
 */

import { test, expect, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, snap, writeEvidence } from '../../lib/harness';
import { adminUserId, psql, sqlStr } from './library-delete-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });
test.use({ storageState: evidencePath('storage-state.json') });

const BOOKS = {
  audiobook: { asin: 'B0E2E51901', title: 'E2E 519 Audiobook Request', status: 'available' },
  ebook: { asin: 'B0E2E51902', title: 'E2E 519 Ebook Request', status: 'failed' },
} as const;
const ASINS = Object.values(BOOKS).map((b) => sqlStr(b.asin)).join(', ');

type Row = { title: string; type: string };

/** By attribute, not role: with `size` set for the capture the select is a listbox, not a combobox. */
const TYPE_SELECT = 'select[aria-label="Filter by type"]';

function cleanup() {
  psql(
    `begin;
     delete from requests where audiobook_id in (select id from audiobooks where audible_asin in (${ASINS}));
     delete from audiobooks where audible_asin in (${ASINS});
     commit;`
  );
}

function seed() {
  cleanup();
  const user = adminUserId();
  for (const [type, book] of Object.entries(BOOKS)) {
    const bookId = psql(
      `insert into audiobooks (id, audible_asin, title, author, status, created_at, updated_at)
       values (gen_random_uuid(), ${sqlStr(book.asin)}, ${sqlStr(book.title)}, 'E2E Fixture Author', 'requested', now(), now()) returning id`
    ).split('\n')[0];
    psql(
      `insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, completed_at, created_at, updated_at)
       values (gen_random_uuid(), ${sqlStr(user)}, ${sqlStr(bookId)}, ${sqlStr(type)}, ${sqlStr(book.status)},
               ${book.status === 'available' ? 100 : 0}, ${book.status === 'failed' ? `'e2e fixture: no ebook found'` : 'null'},
               ${book.status === 'available' ? 'now()' : 'null'}, now(), now())`
    );
  }
}

/** Pick a type and return the table API answer it caused. */
async function pickType(page: Page, value: string): Promise<{ url: string; rows: Row[] }> {
  const answer = page.waitForResponse(
    (r) => r.url().includes('/api/admin/requests?') && new URL(r.url()).searchParams.get('type') === value
  );
  await page.locator(TYPE_SELECT).selectOption(value);
  const res = await answer;
  const body = (await res.json()) as { requests: Row[] };
  return { url: res.url(), rows: body.requests.map((r) => ({ title: r.title, type: r.type })) };
}

const titlesOf = (rows: Row[]) => rows.map((r) => r.title);

test.afterAll(() => cleanup());

test('519: the Type filter lists only audiobook or only ebook requests, follows the URL, and clears', async ({ page }) => {
  const obs: Record<string, unknown> = { image: process.env.E2E_RMAB_IMAGE || '' };
  seed();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin');
  await expect(page.getByRole('combobox', { name: 'Filter by type' })).toHaveValue('all');
  const select = page.locator(TYPE_SELECT);
  const table = page.locator('table', { hasText: BOOKS.ebook.title });
  await expect(table.getByText(BOOKS.audiobook.title)).toBeVisible();
  await expect(table.getByText(BOOKS.ebook.title)).toBeVisible();

  obs.options = await select.locator('option').evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent]));
  expect(obs.options).toEqual([
    ['all', 'All Types'],
    ['audiobook', 'Audiobooks'],
    ['ebook', 'Ebooks'],
  ]);

  // The select expanded in place for the capture, then put back
  await select.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await select.focus();
  await select.evaluate((el) => ((el as HTMLSelectElement).size = 3));
  await snap(page, '519', 'type-dropdown-open');
  await select.evaluate((el) => (el as HTMLSelectElement).removeAttribute('size'));
  await expect(page.getByRole('combobox', { name: 'Filter by type' })).toHaveValue('all');

  // Ebooks
  const ebooks = await pickType(page, 'ebook');
  obs.ebooks = { url: ebooks.url, pageUrl: page.url(), titles: titlesOf(ebooks.rows) };
  expect(new URL(ebooks.url).searchParams.get('page')).toBe('1');
  expect(ebooks.rows.every((r) => r.type === 'ebook'), 'only ebook requests').toBe(true);
  expect(titlesOf(ebooks.rows)).toContain(BOOKS.ebook.title);
  expect(titlesOf(ebooks.rows)).not.toContain(BOOKS.audiobook.title);
  expect(new URL(page.url()).search).toBe('?type=ebook');
  await expect(table.getByText(BOOKS.ebook.title)).toBeVisible();
  await expect(table.getByText(BOOKS.audiobook.title)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
  await snap(page, '519', 'type-ebooks');

  // The URL is the state: a reload keeps Ebooks
  await page.reload();
  await expect(select).toHaveValue('ebook');
  await expect(table.getByText(BOOKS.ebook.title)).toBeVisible();
  await expect(table.getByText(BOOKS.audiobook.title)).toHaveCount(0);

  // Audiobooks
  const audiobooks = await pickType(page, 'audiobook');
  obs.audiobooks = { url: audiobooks.url, pageUrl: page.url(), titles: titlesOf(audiobooks.rows) };
  expect(audiobooks.rows.every((r) => r.type === 'audiobook'), 'only audiobook requests').toBe(true);
  expect(titlesOf(audiobooks.rows)).toContain(BOOKS.audiobook.title);
  expect(titlesOf(audiobooks.rows)).not.toContain(BOOKS.ebook.title);
  expect(new URL(page.url()).search).toBe('?type=audiobook');
  const audiobookTable = page.locator('table', { hasText: BOOKS.audiobook.title });
  await expect(audiobookTable.getByText(BOOKS.audiobook.title)).toBeVisible();
  await expect(audiobookTable.getByText(BOOKS.ebook.title)).toHaveCount(0);

  // Clear: All Types, no type in the page URL, both rows back
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(select).toHaveValue('all');
  await expect(audiobookTable.getByText(BOOKS.ebook.title)).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  // The API ignores an unknown type
  const rmab = await Rmab.loginAdmin();
  const unknown = await rmab.get<{ requests: Row[] }>('/api/admin/requests?type=podcast&pageSize=100');
  obs.unknownTypeTitles = titlesOf(unknown.requests);
  expect(titlesOf(unknown.requests)).toEqual(expect.arrayContaining([BOOKS.audiobook.title, BOOKS.ebook.title]));

  writeEvidence('519/result.json', obs);
});
