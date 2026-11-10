/**
 * Component: E2E regression #576 (a wrong admin password shows the readable message on /login)
 * Documentation: documentation/frontend/pages/login.md
 *
 * Either backend mode (Plex mode: Admin Login toggle, POST /api/auth/admin/login; Audiobookshelf
 * mode: the local form, POST /api/auth/local/login). A fresh browser (1280 light) submits the
 * admin username with a wrong password and stays on /login; the error box shows
 * "Invalid username or password", never the code name "AuthenticationError". One wrong attempt
 * only (one of the account's 10 per 15 minutes).
 * Values are read first and checked with `expect.soft`, so a run on an older image still leaves its shot.
 */

import { test, expect } from '@playwright/test';
import { env, snap, urls, writeEvidence } from '../../lib/harness';

const DIR = '576';
const READABLE = 'Invalid username or password';

const plexMode = () => env('E2E_BACKEND') === 'plex';
const signInPath = () => (plexMode() ? '/api/auth/admin/login' : '/api/auth/local/login');

test('a wrong admin password shows the readable message, not the code name', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ baseURL: urls.rmab(), viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const result: Record<string, unknown> = { backend: env('E2E_BACKEND'), route: signInPath() };

  try {
    await page.goto('/login');
    if (plexMode()) await page.getByRole('button', { name: /Admin Login/ }).click();
    await page.locator('#admin-username').fill(env('E2E_ADMIN_USER'));
    await page.locator('#admin-password').fill(`${env('E2E_ADMIN_PASSWORD')}-wrong`);
    const answered = page.waitForResponse((r) => r.url().endsWith(signInPath()) && r.request().method() === 'POST');
    await page.getByRole('button', { name: /^Login( as Admin)?$/ }).click();
    const response = await answered;
    result.status = response.status();
    result.body = await response.json().catch(() => null);

    const errorBox = page.locator('p.text-red-400');
    await expect(errorBox).toBeVisible({ timeout: 15_000 });
    // The login background floats forever; wait only for animations that end (the error box fade)
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)
    );
    result.shown = (await errorBox.innerText()).trim();
    result.path = new URL(page.url()).pathname;
    await snap(page, DIR, 'wrong-password-1280-light');

    expect.soft(result.status).toBe(401);
    expect.soft(result.shown).toBe(READABLE);
    expect.soft(String(result.shown)).not.toContain('AuthenticationError');
    expect.soft(result.path).toBe('/login');
  } finally {
    writeEvidence(`${DIR}/result-${env('E2E_BACKEND')}.json`, result);
    await ctx.close();
  }
});
