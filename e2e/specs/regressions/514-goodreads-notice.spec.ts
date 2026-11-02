/**
 * Component: E2E regression #514 (Goodreads shelf RSS feeds are gone)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * UI only: a saved Goodreads shelf on the profile page carries the feeds-ended notice.
 * The shelf row is written straight to the database with a feed URL that is not a Goodreads
 * one, so no sync (scheduled or not) ever contacts Goodreads: the sync refuses such a URL
 * before any request. The add-shelf message and the one-warning-per-run sync log are proven by
 * unit tests (tests/api/goodreads-shelves.routes.test.ts, tests/services/goodreads-fetch.test.ts).
 */

import { test, expect } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.use({ storageState: evidencePath('storage-state.json') });

const SHELF = { id: 'e2e-514-shelf', name: 'Read (E2E #514)', rssUrl: 'https://e2e.invalid/review/list_rss/514?shelf=read' };
const NOTICE = 'Goodreads no longer serves shelf RSS feeds, so this shelf has stopped syncing. Hardcover lists still work.';

test('514: a saved Goodreads shelf says its feed no longer works', async ({ page }) => {
  const rmab = await Rmab.loginAdmin();
  const me = await rmab.get<{ user: { id: string } }>('/api/auth/me');

  psql(`delete from goodreads_shelves where id = ${sqlStr(SHELF.id)};
insert into goodreads_shelves (id, user_id, name, rss_url, last_sync_at, book_count, auto_request, created_at, updated_at)
values (${sqlStr(SHELF.id)}, ${sqlStr(me.user.id)}, ${sqlStr(SHELF.name)}, ${sqlStr(SHELF.rssUrl)},
        now() - interval '9 days', 42, true, now() - interval '30 days', now());`);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/profile');

  const card = page.locator('div.group', { has: page.getByRole('heading', { name: new RegExp(`^${SHELF.name.replace(/[()#]/g, '\\$&')}`) }) });
  await expect(card.getByRole('note')).toHaveText(NOTICE);
  await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
  await snap(page, '514', 'goodreads-shelf-notice');

  psql(`delete from goodreads_shelves where id = ${sqlStr(SHELF.id)};`);
});
