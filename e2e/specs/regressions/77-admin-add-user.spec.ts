/**
 * Component: E2E regression #77 (an admin adds a local user from the Users page)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Audiobookshelf mode, self-registration OFF and admin approval ON for the spec (put back after):
 *   1  1280 px, light: page with Add User, empty dialog, taken-name error (the admin's own name in
 *      upper case), list after adding
 *   2  375 px, dark: the same with a password mismatch as the inline error
 * Each added user is local, role user, approved, never signed in; the first one then signs in on /login.
 * Snapshots come before the checks (`expect.soft`), so a run on an older image still leaves its shots.
 */

import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { env, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, snap, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(process.env.E2E_BACKEND === 'plex', 'local users are an Audiobookshelf-mode feature');

const DIR = '77';

interface Registration { enabled: boolean; requireAdminApproval: boolean }

/** The registration settings as saved (missing keys read as off, the way the settings page reads them). */
function registrationSettings(): Registration {
  const out = psql(`select key, value from configuration where key in ('auth.registration_enabled', 'auth.require_admin_approval')`);
  const saved = new Map(out.split('\n').filter(Boolean).map((line) => line.split('\t') as [string, string]));
  return {
    enabled: saved.get('auth.registration_enabled') === 'true',
    requireAdminApproval: saved.get('auth.require_admin_approval') === 'true',
  };
}

function userRow(username: string) {
  const [authProvider, role, status, isSetupAdmin, plexId, lastLoginAt] = psql(
    `select concat_ws('|', auth_provider, role, coalesce(registration_status, ''), is_setup_admin::text, plex_id, coalesce(last_login_at::text, 'never'))
     from users where plex_username = ${sqlStr(username)} and deleted_at is null`
  ).split('\n')[0].split('|');
  return { authProvider, role, status, isSetupAdmin, plexId, lastLoginAt };
}

async function session(browser: Browser, opts: { width: number; height: number; dark: boolean; signedIn: boolean }) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    ...(opts.signedIn && { storageState: evidencePath('storage-state.json') }),
  });
  return { ctx, page: await ctx.newPage() };
}

const settle = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

function userEntry(page: Page, name: string, mobile: boolean): Locator {
  return mobile
    ? page.locator('div.space-y-3.sm\\:hidden > div', { hasText: name })
    : page.locator('tr', { hasText: name });
}

async function fill(dialog: Locator, username: string, password: string, confirm: string) {
  await dialog.getByLabel('Username').fill(username);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByLabel('Confirm password').fill(confirm);
}

interface FlowResult { headerButton: boolean; error: string; toast: string; listed: boolean }

async function addFlow(page: Page, tag: string, mobile: boolean, username: string, password: string, bad: { username: string; confirm: string }): Promise<FlowResult> {
  await page.goto('/admin/users');
  const button = page.getByRole('button', { name: 'Add User' });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await snap(page, DIR, `${tag}-1-page`);

  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Add User' });
  await expect(dialog).toBeVisible();
  await settle(page);
  await snap(page, DIR, `${tag}-2-dialog`);

  await fill(dialog, bad.username, password, bad.confirm);
  await dialog.getByRole('button', { name: 'Add User' }).click();
  const errorText = dialog.locator('p.text-red-600');
  await expect(errorText).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await snap(page, DIR, `${tag}-3-error`);
  const error = (await errorText.innerText()).trim();

  await fill(dialog, username, password, password);
  await dialog.getByRole('button', { name: 'Add User' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  const toast = page.getByText(`User "${username.toLowerCase()}" added`);
  await expect(toast).toBeVisible({ timeout: 15_000 });
  const entry = userEntry(page, username.toLowerCase(), mobile);
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await entry.scrollIntoViewIfNeeded();
  await settle(page);
  await snap(page, DIR, `${tag}-4-after`);

  return { headerButton: true, error, toast: (await toast.innerText()).trim(), listed: await entry.isVisible() };
}

test('77: an admin adds local users from the Users page and the new user signs in', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await Rmab.loginAdmin();
  const before = registrationSettings();
  const off = await admin.raw('PUT', '/api/admin/settings/registration', { enabled: false, requireAdminApproval: true });
  if (!off.ok) throw new Error(`registration off: HTTP ${off.status} ${await off.text()}`);

  const stamp = Date.now().toString(36);
  const first = { username: `E2E-Reader-${stamp}`, password: `e2e-77-${stamp}-first` };
  const second = { username: `e2e-mobile-${stamp}`, password: `e2e-77-${stamp}-second` };
  const result: Record<string, unknown> = { before };

  try {
    {
      const { ctx, page } = await session(browser, { width: 1280, height: 800, dark: false, signedIn: true });
      result.desktop = await addFlow(page, '1280-light', false, first.username, first.password, {
        username: env('E2E_ADMIN_USER').toUpperCase(),
        confirm: first.password,
      });
      await ctx.close();
    }
    {
      const { ctx, page } = await session(browser, { width: 375, height: 812, dark: true, signedIn: true });
      result.mobile = await addFlow(page, '375-dark', true, second.username, second.password, {
        username: second.username,
        confirm: `${second.password}-typo`,
      });
      await ctx.close();
    }
    result.registrationDuringAdd = registrationSettings();
    result.firstRow = userRow(first.username.toLowerCase());
    result.secondRow = userRow(second.username.toLowerCase());

    // The first added user signs in on /login (registration is still off)
    {
      const { ctx, page } = await session(browser, { width: 1280, height: 800, dark: false, signedIn: false });
      await page.goto('/login');
      await page.locator('#admin-username').fill(first.username);
      await page.locator('#admin-password').fill(first.password);
      await page.getByRole('button', { name: /^Login$/ }).click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
      await settle(page);
      await snap(page, DIR, '1280-light-5-signed-in');
      const me = await page.evaluate(async () => {
        const token = localStorage.getItem('accessToken');
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        return { status: res.status, body: await res.json() };
      });
      result.signIn = { path: new URL(page.url()).pathname, me: { status: me.status, username: me.body?.user?.username, role: me.body?.user?.role } };
      await ctx.close();
    }
  } finally {
    const restore = await admin.raw('PUT', '/api/admin/settings/registration', before);
    result.restored = restore.ok ? registrationSettings() : `HTTP ${restore.status}`;
    writeEvidence(`${DIR}/result.json`, result);
  }

  const desktop = result.desktop as FlowResult;
  const mobile = result.mobile as FlowResult;
  expect.soft(result.registrationDuringAdd).toEqual({ enabled: false, requireAdminApproval: true });
  expect.soft(desktop.error).toBe('That username is already taken');
  expect.soft(mobile.error).toBe('Passwords do not match');
  expect.soft(desktop.toast).toBe(`User "${first.username.toLowerCase()}" added`);
  expect.soft(desktop.listed && mobile.listed).toBe(true);
  for (const [row, name] of [[result.firstRow, first.username], [result.secondRow, second.username]] as const) {
    expect.soft(row).toEqual({
      authProvider: 'local',
      role: 'user',
      status: 'approved',
      isSetupAdmin: 'false',
      plexId: `local-${name.toLowerCase()}`,
      lastLoginAt: 'never',
    });
  }
  expect.soft(result.signIn).toEqual({
    path: expect.not.stringMatching(/^\/login/),
    me: { status: 200, username: first.username.toLowerCase(), role: 'user' },
  });
  expect.soft(result.restored).toEqual(before);
});
