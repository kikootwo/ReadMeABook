/**
 * Component: E2E first leg of the #542 spec: the Explicit mark setting (off by default, then on)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * On the fresh stack the setting is off: no key stored, the settings and providers responses say false;
 * a request sent with explicit: true is stored unmarked; a direct PUT is refused (403 FeatureDisabled) for
 * the requester and the admin; the details modal, My Requests and the admin table (row and actions menu)
 * show no Explicit control and not the word. Then the admin turns it on in Settings (switch shots at
 * 1280 light, off and on, and 375 dark), and the request made here is deleted so later legs see the
 * stack as before.
 */

import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { Rmab, urls, type Book } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { waitSettled } from './232-tag-helpers';
import { browse, putExplicit, type UserSession } from './542-helpers';

export const EXPLICIT_KEY = 'audiobookshelf.explicit_mark_enabled';
const SWITCH = { name: 'Explicit mark on requests' };

const storedKey = () => psql(`select coalesce((select value from configuration where key = ${sqlStr(EXPLICIT_KEY)}), '<absent>')`);
const settingFlag = async (admin: Rmab) => (await admin.get<{ audiobookshelf: Record<string, unknown> }>('/api/admin/settings')).audiobookshelf.explicitMarkEnabled;
const providersFlag = async () => (await (await fetch(`${urls.rmab()}/api/auth/providers`)).json()).explicitMarkEnabled;
/** The page's own providers answer (started before navigation), so a check runs after the flag is known. */
const pageFlag = (page: Page) => page.waitForResponse((res) => new URL(res.url()).pathname === '/api/auth/providers', { timeout: 60_000 })
  .then((res) => res.json()).then((b: { explicitMarkEnabled?: unknown }) => b.explicitMarkEnabled);
/** Explicit controls and the word anywhere on the page (checkboxes, pills, menu items, text), once the flag arrived. */
const explicitOnPage = async (page: Page, flag: Promise<unknown>) => ({
  pageFlag: await flag,
  boxes: await page.getByRole('checkbox', { name: /Explicit/ }).count(),
  menuItems: await page.getByRole('menuitem', { name: /explicit/i }).count(),
  word: /explicit/i.test((await page.locator('body').innerText()) ?? ''),
});

/** The settings switch and its label in view, below the sticky header. */
async function showSwitch(page: Page): Promise<Locator> {
  const toggle = page.getByRole('switch', SWITCH);
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await toggle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  return toggle;
}

/** Saved through the API as the settings page sends it (the other ABS settings kept). */
export async function setExplicitMark(admin: Rmab, on: boolean) {
  const s = (await admin.get<{ audiobookshelf: Record<string, unknown> }>('/api/admin/settings')).audiobookshelf;
  const res = await admin.raw('PUT', '/api/admin/settings/audiobookshelf', {
    serverUrl: s.serverUrl, apiToken: s.apiToken, libraryId: s.libraryId, triggerScanAfterImport: s.triggerScanAfterImport, explicitMarkEnabled: on,
  });
  expect(res.status, `explicit mark ${on ? 'on' : 'off'}`).toBe(200);
}

export async function settingLeg(opts: {
  browser: Browser;
  admin: Rmab;
  adminStorage: string;
  eve: UserSession;
  book: Book;
  dir: string;
  openDetails: (page: Page) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const { browser, admin, adminStorage, eve, book, dir, openDetails } = opts;
  const r: Record<string, unknown> = { storedBefore: storedKey(), settingBefore: await settingFlag(admin), providersBefore: await providersFlag() };

  // The API while off: explicit on create ignored, the mark route refused
  const post = await eve.rmab.raw('POST', '/api/requests', { audiobook: { asin: book.asin, title: book.title, author: book.author, narrator: book.narrator }, explicit: true });
  const zReq = (await post.json()).request?.id as string;
  r.postStatus = post.status;
  r.storedMark = psql(`select "explicit"::text from requests where id = ${sqlStr(zReq)}`);
  r.requesterPut = await putExplicit(eve.rmab, zReq, true);
  r.adminPut = await putExplicit(admin, zReq, false);
  r.zSettled = await waitSettled(zReq);

  // The details modal (eve): Request is there, no Explicit row
  {
    const { ctx, page } = await browse(browser, eve.storage, 1280, 900, false);
    const flag = pageFlag(page);
    await openDetails(page);
    await expect(page.getByRole('button', { name: /Request Audiobook|Interactive Search/ }).first()).toBeVisible({ timeout: 30_000 });
    r.modal = await explicitOnPage(page, flag);
    await ctx.close();
  }
  // My Requests (eve) 1280 light: the card, no box
  {
    const { ctx, page, shot } = await browse(browser, eve.storage, 1280, 900, false);
    const flag = pageFlag(page);
    await page.goto('/requests');
    await expect(page.getByText(book.title).first()).toBeVisible({ timeout: 30_000 });
    r.myRequests = await explicitOnPage(page, flag);
    await shot(dir, 'my-requests-setting-off-1280-light');
    await ctx.close();
  }
  // Admin table 1280 light: the row and its open actions menu, no pill, no menu item
  {
    const { ctx, page, shot } = await browse(browser, adminStorage, 1280, 900, false);
    const flag = pageFlag(page);
    await page.goto('/admin');
    const row = page.locator('tr', { has: page.getByText(book.title) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByTitle('Actions').click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    r.adminTable = { ...(await explicitOnPage(page, flag)), menuItemsShown: await page.getByRole('menuitem').count() };
    await shot(dir, 'admin-table-setting-off-1280-light');
    await ctx.close();
  }

  // Settings 1280 light: off, then on through the switch, saved
  {
    const { ctx, page, shot } = await browse(browser, adminStorage, 1280, 900, false);
    await page.goto('/admin/settings');
    const toggle = await showSwitch(page);
    r.switchBefore = await toggle.getAttribute('aria-checked');
    await shot(dir, 'setting-explicit-off-1280-light');
    await page.getByRole('button', { name: 'Test Connection' }).click();
    await expect(page.getByText(/Connected to Audiobookshelf/).first()).toBeVisible({ timeout: 30_000 });
    await toggle.click();
    r.switchAfterClick = await toggle.getAttribute('aria-checked');
    await toggle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot(dir, 'setting-explicit-on-1280-light');
    const putP = page.waitForRequest((q) => q.method() === 'PUT' && new URL(q.url()).pathname === '/api/admin/settings/audiobookshelf');
    const resP = page.waitForResponse((q) => q.request().method() === 'PUT' && new URL(q.url()).pathname === '/api/admin/settings/audiobookshelf');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    r.putBody = (await putP).postDataJSON().explicitMarkEnabled;
    r.putStatus = (await resP).status();
    await ctx.close();
  }
  // Settings 375 dark, saved on
  {
    const { ctx, page, shot, overflowX } = await browse(browser, adminStorage, 375, 812, true);
    await page.goto('/admin/settings');
    const toggle = await showSwitch(page);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await shot(dir, 'setting-explicit-375-dark');
    r.settingOverflow375 = await overflowX();
    await ctx.close();
  }
  r.storedAfter = storedKey();
  r.settingAfter = await settingFlag(admin);
  r.providersAfter = await providersFlag();

  // Later legs see the stack as before this leg
  r.zDeleteStatus = (await admin.raw('DELETE', `/api/admin/requests/${zReq}`)).status;
  return r;
}

/** The leg's checks (soft). */
export function expectSettingLeg(r: Record<string, unknown>) {
  const none = { pageFlag: false, boxes: 0, menuItems: 0, word: false };
  // No key on a stack this spec opens; 'false' when an earlier spec saved the settings page (it sends the field)
  expect.soft(['<absent>', 'false'], 'leg 0: off at the start (no key stored, or saved off)').toContain(r.storedBefore);
  expect.soft([r.settingBefore, r.providersBefore], 'leg 0: the settings and providers responses say off').toEqual([false, false]);
  expect.soft([r.postStatus, r.storedMark], 'leg 0: explicit on create ignored while off').toEqual([201, 'false']);
  expect.soft(r.requesterPut, 'leg 0: the requester PUT is refused').toEqual({ status: 403, body: { error: 'FeatureDisabled', message: 'The Explicit mark is turned off in Settings' } });
  expect.soft((r.adminPut as { status: number }).status, 'leg 0: the admin PUT is refused').toBe(403);
  expect.soft(r.modal, 'leg 0: no Explicit control in the details modal').toEqual(none);
  expect.soft(r.myRequests, 'leg 0: none on My Requests').toEqual(none);
  expect.soft({ ...(r.adminTable as Record<string, unknown>), menuItemsShown: undefined }, 'leg 0: no pill and no menu item in the admin table').toEqual({ ...none, menuItemsShown: undefined });
  expect.soft(Number((r.adminTable as { menuItemsShown: number }).menuItemsShown), 'leg 0: the menu was open').toBeGreaterThan(0);
  expect.soft([r.switchBefore, r.switchAfterClick, r.putBody, r.putStatus], 'leg 0: the switch turns it on and the save sends it').toEqual(['false', 'true', true, 200]);
  expect.soft([r.storedAfter, r.settingAfter, r.providersAfter], 'leg 0: on after the save').toEqual(['true', true, true]);
  expect.soft(r.settingOverflow375, 'leg 0: no horizontal overflow at 375').toBe(0);
  expect.soft(r.zDeleteStatus, 'leg 0: its request deleted').toBe(200);
}
