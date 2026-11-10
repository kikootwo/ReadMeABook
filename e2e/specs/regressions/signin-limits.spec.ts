/**
 * Component: E2E sign-in attempt limits through the real /login page
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run alone on its own stack (`--specs signin-limits --isolate-specs`): it leaves the admin
 * account at its limit for unknown browsers. Works in both backend modes (Audiobookshelf mode
 * signs in through /api/auth/local/login, Plex mode through /api/auth/admin/login).
 *   1  browser A signs in on /login and holds the known-browser cookie (httpOnly, Strict, /api/auth, not Secure over http)
 *   2  10 wrong passwords from a plain client (no cookie) get 401; the 11th gets 429
 *   3  fresh browsers B (1280 light) and C (375 dark) with the right password see the limit message and stay on /login
 *   4  browser A, signed out (storage cleared, cookie kept), signs in with the right password
 *   5  browser A with a wrong password sees the ordinary invalid-password message, not the limit message
 * Values are read first and checked with `expect.soft`, so a run on an older image still leaves its shots.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { env, snap, urls, writeEvidence } from '../../lib/harness';

const DIR = 'signin-limits';
const COOKIE = 'rmab_known_browser';
const ACCOUNT_LIMIT_TEXT = 'Too many sign-in attempts for this account.';

const plexMode = () => env('E2E_BACKEND') === 'plex';
const signInPath = () => (plexMode() ? '/api/auth/admin/login' : '/api/auth/local/login');

async function browserAt(browser: Browser, width: number, height: number, dark: boolean) {
  const ctx = await browser.newContext({
    baseURL: urls.rmab(),
    viewport: { width, height },
    colorScheme: dark ? 'dark' : 'light',
  });
  return { ctx, page: await ctx.newPage() };
}

/** Fill and submit the /login admin form; returns once the page has answered. */
async function submitLogin(page: Page, password: string): Promise<{ path: string; error: string | null }> {
  await page.goto('/login');
  if (plexMode()) await page.getByRole('button', { name: /Admin Login/ }).click();
  await page.locator('#admin-username').fill(env('E2E_ADMIN_USER'));
  await page.locator('#admin-password').fill(password);
  const answered = page.waitForResponse((r) => r.url().endsWith(signInPath()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: /^Login( as Admin)?$/ }).click();
  const response = await answered;
  const errorBox = page.locator('p.text-red-400');
  if (response.ok()) {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
    return { path: new URL(page.url()).pathname, error: null };
  }
  await expect(errorBox).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  return { path: new URL(page.url()).pathname, error: (await errorBox.innerText()).trim() };
}

async function signOut(page: Page) {
  await page.evaluate(() => localStorage.clear());
}

test('sign-in limits: an unknown browser is refused at the limit; a browser that signed in before still signs in', async ({ browser }) => {
  test.setTimeout(180_000);
  const result: Record<string, unknown> = { backend: env('E2E_BACKEND'), route: signInPath() };

  try {
    // 1  Browser A signs in and is given the cookie
    const a = await browserAt(browser, 1280, 800, false);
    result.firstSignIn = await submitLogin(a.page, env('E2E_ADMIN_PASSWORD'));
    const cookie = (await a.ctx.cookies()).find((c) => c.name === COOKIE);
    result.cookie = cookie && { httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, path: cookie.path, secure: cookie.secure };

    // 2  A plain client (no cookie) uses up the account's attempts
    const statuses: number[] = [];
    let refusedBody: unknown = null;
    for (let i = 0; i < 11; i += 1) {
      const res = await fetch(`${urls.rmab()}${signInPath()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: env('E2E_ADMIN_USER'), password: `not-the-password-${i}` }),
      });
      statuses.push(res.status);
      if (res.status === 429) refusedBody = { body: await res.json(), retryAfter: res.headers.get('retry-after') };
      else await res.text();
    }
    result.wrongAttempts = statuses;
    result.refused = refusedBody;

    // 3  Fresh browsers with the right password see the limit message
    const b = await browserAt(browser, 1280, 800, false);
    result.unknownDesktop = await submitLogin(b.page, env('E2E_ADMIN_PASSWORD'));
    await snap(b.page, DIR, 'refused-unknown-1280-light');
    await b.ctx.close();

    const c = await browserAt(browser, 375, 812, true);
    result.unknownMobile = await submitLogin(c.page, env('E2E_ADMIN_PASSWORD'));
    await snap(c.page, DIR, 'refused-unknown-375-dark');
    result.mobileOverflow = await c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await c.ctx.close();

    // 4  Browser A, signed out, still signs in
    await signOut(a.page);
    result.knownSignIn = await submitLogin(a.page, env('E2E_ADMIN_PASSWORD'));
    await a.page.waitForLoadState('networkidle').catch(() => undefined);
    await snap(a.page, DIR, 'known-signs-in-1280-light');

    // 5  Browser A with a wrong password gets the ordinary answer
    await signOut(a.page);
    result.knownWrong = await submitLogin(a.page, 'still-not-the-password');
    await snap(a.page, DIR, 'known-wrong-password-1280-light');
    await a.ctx.close();
  } finally {
    writeEvidence(`${DIR}/result-${env('E2E_BACKEND')}.json`, result);
  }

  expect.soft(result.firstSignIn).toMatchObject({ error: null });
  expect.soft(result.cookie).toEqual({ httpOnly: true, sameSite: 'Strict', path: '/api/auth', secure: false });
  expect.soft(result.wrongAttempts).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429]);
  expect.soft(result.refused).toMatchObject({ body: { error: expect.stringContaining(ACCOUNT_LIMIT_TEXT) } });
  for (const key of ['unknownDesktop', 'unknownMobile']) {
    expect.soft(result[key], key).toMatchObject({ path: '/login', error: expect.stringContaining(ACCOUNT_LIMIT_TEXT) });
  }
  expect.soft(result.mobileOverflow, 'page width at 375 px').toBeLessThanOrEqual(0);
  expect.soft(result.knownSignIn).toMatchObject({ path: expect.not.stringMatching(/^\/login/), error: null });
  expect.soft(result.knownWrong).toMatchObject({ path: '/login', error: expect.not.stringContaining('Too many') });
  expect.soft((result.knownWrong as { error?: string } | undefined)?.error).toBeTruthy();
});
