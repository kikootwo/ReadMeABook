/**
 * Component: E2E regression #244 (an admin can delete Plex and OIDC users)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Seeds a Plex user with two requests and an OIDC user with one, then deletes each from the
 * admin Users page (`--backend plex`, fake Plex):
 *   1  1280 px, light: the Plex user's row with Delete, the confirmation, the list after
 *   2  375 px, dark:   the same for the OIDC user's card
 * After each delete the row is soft deleted: deleted_at set, plex_id (and oidc_subject) freed with
 * a random part, auth_token and login_token_hash cleared, the requests still on the deleted row.
 * Snapshots come before the checks (`expect.soft`), so a run on an older image still leaves its shots.
 */

import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './library-delete-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '244';
const FREED = /-deleted-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Seeded { id: string; name: string }

function seedUser(name: string, provider: 'plex' | 'oidc', key: string, requests: number): Seeded {
  const oidc = provider === 'oidc';
  const id = psql(
    `insert into users (id, plex_id, plex_username, plex_email, role, auth_provider, oidc_subject, oidc_provider, auth_token, login_token_hash, registration_status, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(key)}, ${sqlStr(name)}, ${sqlStr(`${name}@example.test`)}, 'user', ${sqlStr(provider)},
             ${oidc ? sqlStr(key) : 'null'}, ${oidc ? "'TestIdP'" : 'null'}, 'e2e-encrypted-token', 'e2e-login-token-hash', 'approved', now(), now())
     returning id`
  ).split('\n')[0];
  for (let n = 1; n <= requests; n++) {
    const bookId = psql(
      `insert into audiobooks (id, audible_asin, title, author, narrator, status, created_at, updated_at)
       values (gen_random_uuid(), ${sqlStr(`E2E244${name.slice(-3)}${n}`.toUpperCase())}, ${sqlStr(`E2E 244 ${name} Book ${n}`)}, 'E2E 244 Author', 'E2E Narrator', 'available', now(), now()) returning id`
    ).split('\n')[0];
    psql(
      `insert into requests (id, user_id, audiobook_id, type, status, progress, created_at, updated_at)
       values (gen_random_uuid(), ${sqlStr(id)}, ${sqlStr(bookId)}, 'audiobook', 'available', 100, now(), now())`
    );
  }
  return { id, name };
}

function userRow(id: string) {
  // One column joined with a visible delimiter: psql output is trimmed, so an empty leading tab column would shift
  const [deletedAt, plexId, oidcSubject, authToken, loginTokenHash, requests] = psql(
    `select concat_ws('|', coalesce(deleted_at::text, ''), plex_id, coalesce(oidc_subject, ''), coalesce(auth_token, ''),
            coalesce(login_token_hash, ''), (select count(*) from requests r where r.user_id = u.id)::text)
     from users u where id = ${sqlStr(id)}`
  ).split('\n')[0].split('|');
  return { deletedAt, plexId, oidcSubject, authToken, loginTokenHash, requests: Number(requests) };
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

/** The visible table row (sm and up) or mobile card for a user. */
function userEntry(page: Page, name: string, mobile: boolean): Locator {
  return mobile
    ? page.locator('div.space-y-3.sm\\:hidden > div', { hasText: name })
    : page.locator('tr', { hasText: name });
}

async function deleteFlow(page: Page, user: Seeded, mobile: boolean, tag: string) {
  await page.goto('/admin/users');
  const entry = userEntry(page, user.name, mobile);
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await entry.scrollIntoViewIfNeeded();
  await settle(page);
  await snap(page, DIR, `${tag}-1-row`);

  await entry.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.locator('div.fixed.inset-0.z-50', { has: page.getByRole('heading', { name: 'Delete User' }) });
  await expect(dialog).toBeVisible();
  await settle(page);
  await snap(page, DIR, `${tag}-2-confirm`);
  const confirmText = (await dialog.innerText()).trim();

  await dialog.getByRole('button', { name: 'Delete User' }).click();
  await expect(entry).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  await snap(page, DIR, `${tag}-3-after`);
  return confirmText;
}

test('244: an admin deletes a Plex user and an OIDC user from the Users page', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const plexUser = seedUser(`e2e-pat-${stamp}`, 'plex', `9${Date.now()}`, 2);
  const oidcUser = seedUser(`e2e-olive-${stamp}`, 'oidc', `sub-olive-${stamp}`, 1);
  const result: Record<string, unknown> = {};

  {
    const { ctx, page } = await session(browser, { width: 1280, height: 800, dark: false });
    result.plexConfirm = await deleteFlow(page, plexUser, false, 'plex-1280-light');
    await ctx.close();
  }
  {
    const { ctx, page } = await session(browser, { width: 375, height: 812, dark: true });
    result.oidcConfirm = await deleteFlow(page, oidcUser, true, 'oidc-375-dark');
    await ctx.close();
  }

  const plexRow = userRow(plexUser.id);
  const oidcRow = userRow(oidcUser.id);
  result.plexRow = plexRow;
  result.oidcRow = oidcRow;
  writeEvidence(`${DIR}/result.json`, result);

  expect.soft(result.plexConfirm).toContain(`Delete "${plexUser.name}"? The account is removed and can no longer sign in. Their 2 request(s) are kept.`);
  expect.soft(result.plexConfirm).toContain('If they sign in with Plex again, they get a new account');
  expect.soft(result.oidcConfirm).toContain('Their 1 request(s) are kept.');
  expect.soft(result.oidcConfirm).toContain('If they sign in with single sign-on again, they get a new account');
  for (const row of [plexRow, oidcRow]) {
    expect.soft(row.deletedAt).not.toBe('');
    expect.soft(row.plexId).toMatch(FREED);
    expect.soft(row.authToken).toBe('');
    expect.soft(row.loginTokenHash).toBe('');
  }
  expect.soft(oidcRow.oidcSubject).toMatch(FREED);
  expect.soft(plexRow.requests).toBe(2);
  expect.soft(oidcRow.requests).toBe(1);
});
