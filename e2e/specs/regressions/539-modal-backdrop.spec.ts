/**
 * Component: E2E regression #539 (modals dim the page instead of covering it in black)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Tailwind v4 dropped `bg-opacity-*`, so `bg-black bg-opacity-50` drew a solid black backdrop.
 *   1  Shared Modal (Profile > Add Shelf, Hardcover tab) at 1280 px, light: backdrop alpha 0.5
 *   2  Admin Users Edit User Role dialog at 375 px, dark: backdrop alpha 0.5
 * Snapshots are taken before the alpha checks (`expect.soft`), so a run on an older image still
 * leaves its shots. The local user row is written over the exec bridge and removed afterwards.
 */

import { test, expect, type Browser, type Locator } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '539';
const USER = { id: 'e2e-539-user', name: 'e2e-539-reader' };

/** Alpha (0-1) of the element's computed background colour, read back through a 1x1 canvas. */
const backdropAlpha = (backdrop: Locator) =>
  backdrop.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return Math.round((ctx.getImageData(0, 0, 1, 1).data[3] / 255) * 100) / 100;
  });

async function session(browser: Browser, opts: { width: number; height: number; dark: boolean }) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  const page = await ctx.newPage();
  const settle = () =>
    page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
  return { ctx, page, settle };
}

test('539: modal backdrops dim the page behind them', async ({ browser }) => {
  const result: Record<string, number> = {};

  // 1  Shared Modal at desktop, light
  {
    const { ctx, page, settle } = await session(browser, { width: 1280, height: 800, dark: false });
    await page.goto('/profile');
    await page.getByRole('button', { name: /^Add (Your First )?Shelf$/ }).first().click();
    await page.getByRole('button', { name: 'Hardcover', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add Shelf', exact: true })).toBeVisible();
    await settle();
    await snap(page, DIR, 'modal');
    result.sharedModal = await backdropAlpha(page.locator('div.fixed.inset-0.z-50 > div.fixed.inset-0').first());
    await ctx.close();
  }

  // 2  Admin Users Edit User Role dialog at 375 px, dark
  psql(`delete from users where id = ${sqlStr(USER.id)};
insert into users (id, plex_id, plex_username, role, auth_provider, registration_status, created_at, updated_at)
values (${sqlStr(USER.id)}, ${sqlStr(`local-${USER.name}`)}, ${sqlStr(USER.name)}, 'user', 'local', 'approved', now(), now());`);
  try {
    const { ctx, page, settle } = await session(browser, { width: 375, height: 812, dark: true });
    await page.goto('/admin/users');
    await expect(page.getByText(USER.name).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit Role' }).filter({ visible: true }).first().click();
    const heading = page.getByRole('heading', { name: 'Edit User Role' });
    await expect(heading).toBeVisible();
    await settle();
    await snap(page, DIR, 'users-modal-375-dark');
    result.usersModal = await backdropAlpha(page.locator('div.fixed.inset-0.z-50', { has: heading }));
    await ctx.close();
  } finally {
    psql(`delete from users where id = ${sqlStr(USER.id)};`);
  }

  writeEvidence(`${DIR}/result.json`, result);
  expect.soft(result.sharedModal, 'shared Modal backdrop alpha').toBe(0.5);
  expect.soft(result.usersModal, 'admin Users dialog backdrop alpha').toBe(0.5);
});
