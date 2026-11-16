/**
 * Component: E2E regression #231 PR 2 helpers (sinkhole records, RMAB Discord log lines, seeded requests, screenshots)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { expect, type Browser, type Page } from '@playwright/test';
import { evidencePath, fakeArr, snap, stackLogsSync, type Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { newBook } from './library-delete-helpers';

export const DIR = '231-footprint';
export const SETTINGS = '/api/admin/settings/discord';
/** Three dot-separated parts like a real token, but nothing like one (no secret, no scanner match). */
export const FAKE_TOKEN = 'e2efake.e2efake.e2e-fake-token-not-a-real-one';
export const TOKEN_MASK = '••••••••••••';

export const VIEWPORTS = [
  { name: '1280-light', width: 1280, height: 800, dark: false },
  { name: '375-dark', width: 375, height: 812, dark: true },
] as const;

/** Sinkhole records (Discord connection attempts) after `since`. */
export async function sinkholeRecords(since = 0) {
  return (await fakeArr.requests(since)).filter((r) => r.service === 'sinkhole').map((r) => ({ seq: r.seq, host: r.host, client: (r as any).client }));
}

export async function lastSeq() {
  return Math.max(0, ...(await fakeArr.requests()).map((r) => r.seq));
}

/** RMAB log lines from Discord loggers (`[Discord.<x>]`), or naming the bot. */
export function discordLogLines(): string[] {
  return stackLogsSync('rmab')
    .split('\n')
    .filter((l) => /\[Discord\.|Discord bot/.test(l))
    .map((l) => l.replace(/^\S+\s+\|\s?/, '').trim());
}

/** True when `secret` appears anywhere in the RMAB container log (every line, metadata included). */
export function rmabLogContains(secret: string): boolean {
  return stackLogsSync('rmab').includes(secret);
}

/** One API answer reduced to what must match main: code, error, message, the request's new status. */
export async function answer(res: Response) {
  const body: any = await res.json().catch(() => null);
  return { status: res.status, error: body?.error ?? null, message: body?.message ?? null, requestStatus: body?.request?.status ?? null };
}

/** A request row for `userId` in `status`; a release date in the future makes approve wait (no search). */
export function seedRequest(userId: string, label: string, status: string, opts: { futureRelease?: boolean } = {}) {
  const asin = `E2E231${label}`.slice(0, 10).toUpperCase().padEnd(10, 'X');
  const title = `E2E 231 Footprint ${label}`;
  const bookId = newBook(title, 'E2E 231 Author', asin);
  const requestId = psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, release_date, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(userId)}, ${sqlStr(bookId)}, 'audiobook', ${sqlStr(status)}, 0, ${opts.futureRelease ? "'2099-05-05'" : 'null'}, now(), now()) returning id`
  ).split('\n')[0];
  return { title, bookId, requestId };
}

export function dropSeeded(bookIds: string[]) {
  if (!bookIds.length) return;
  const ids = bookIds.map(sqlStr).join(', ');
  psql(`delete from requests where audiobook_id in (${ids}); delete from audiobooks where id in (${ids});`);
}

export async function adminPage(browser: Browser, vp: (typeof VIEWPORTS)[number]) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: vp.width, height: vp.height },
    colorScheme: vp.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  return { ctx, page: await ctx.newPage() };
}

export const settle = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));

const BADGE = /Manual|Global Default|Auto-Approve/;

/** Users page: open `username`'s permissions dialog; returns whether the Discord field is in it. */
export async function openUserDialog(page: Page, username: string, shot: string) {
  await page.goto('/admin/users');
  const holder = page.locator('tr:visible, div:visible', { hasText: username }).filter({ has: page.getByRole('button', { name: BADGE }) }).last();
  await expect(holder).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await snap(page, DIR, `users-${shot}`);
  await holder.getByRole('button', { name: BADGE }).click();
  // The shared Modal has no dialog role: find it by its title
  const dialog = page.locator('div.fixed.inset-0', { has: page.getByRole('heading', { name: 'User Permissions' }) });
  await expect(dialog).toBeVisible();
  await settle(page);
  const field = dialog.getByLabel('Discord user ID');
  const hasField = (await field.count()) > 0;
  if (hasField) await field.scrollIntoViewIfNeeded();
  await snap(page, DIR, `users-dialog-${shot}`);
  return { hasField, dialogText: (await dialog.innerText()).replace(/\s+/g, ' ').trim() };
}

/** Settings → Discord at `vp`; returns the visible status pill text and token field value. */
export async function openDiscordTab(page: Page, shot: string) {
  await page.goto('/admin/settings?tab=discord');
  await expect(page.getByRole('heading', { name: 'Discord Bot' })).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await snap(page, DIR, `discord-tab-${shot}`);
  return {
    enabled: await page.getByRole('switch', { name: 'Enable the Discord bot' }).getAttribute('aria-checked'),
    token: await page.locator('#discord-bot-token').inputValue(),
  };
}

/** Settings → Discord when the settings GET fails (500): the error, Retry, and no Save or Test. */
export async function openDiscordTabLoadError(page: Page, shot: string) {
  await page.route(
    (url) => url.pathname === SETTINGS,
    (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 500, json: { error: 'Failed to read Discord settings' } }) : route.continue())
  );
  await page.goto('/admin/settings?tab=discord');
  await expect(page.getByText(/Could not load the saved Discord settings/)).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await snap(page, DIR, `discord-tab-${shot}`);
  return {
    retry: await page.getByRole('button', { name: 'Retry', exact: true }).count(),
    save: await page.getByRole('button', { name: 'Save', exact: true }).count(),
    test: await page.getByRole('button', { name: 'Test', exact: true }).count(),
  };
}

export async function saveDiscord(admin: Rmab, body: Record<string, unknown>) {
  const res = await admin.raw('PUT', SETTINGS, {
    enabled: false,
    botToken: '',
    guildId: '',
    requestChannelId: '',
    adminRoleId: '',
    adminNotifyChannelId: '',
    ...body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
