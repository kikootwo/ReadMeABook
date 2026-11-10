/**
 * Component: E2E regression #557 (System / Light / Dark theme switch in the user menu)
 * Documentation: documentation/frontend/components.md
 *
 * No flags needed. Admin session from bootstrap's storage state; device setting via Chromium's
 * prefers-color-scheme emulation:
 *   1  dark device + Light chosen: light at once, after a reload (data-theme already set when <body>
 *      is parsed, no dark frame), after a client-side navigation, and on /login (no menu)
 *   2  light device + Dark chosen: the same, the other way round
 *   3  System (default, and picked again) follows the device, including a live change, no reload
 *   4  evidence: the open menu with each choice (1280 light device, 375 dark device) and the
 *      main pages under Light-on-dark and Dark-on-light at 1280
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { Rmab, evidencePath, fakeArr, snap, writeEvidence } from '../../lib/harness';

test.use({ storageState: evidencePath('storage-state.json'), viewport: { width: 1280, height: 800 } });

const DIR = '557';
type Device = 'light' | 'dark';
type Choice = 'System' | 'Light' | 'Dark';

/** Records <html data-theme> when <body> is first parsed and the theme of every frame until then (+1). */
const FIRST_PAINT_PROBE = () => {
  const lum = (c: string) => {
    const ok = c.match(/^oklch\(([\d.]+)(%?)/);
    if (ok) return ok[2] ? Number(ok[1]) / 100 : Number(ok[1]);
    const n = (c.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
    return (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / 255;
  };
  const probe: { atBody?: string | null; frames: { body: boolean; scheme: string; bodyDark: boolean | null }[] } = { frames: [] };
  (window as unknown as { __themeProbe: typeof probe }).__themeProbe = probe;
  const observer = new MutationObserver(() => {
    if (document.body) {
      probe.atBody = document.documentElement.getAttribute('data-theme');
      observer.disconnect();
    }
  });
  observer.observe(document, { childList: true, subtree: true });
  const frame = () => {
    const body = Boolean(document.body);
    probe.frames.push({
      body,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      bodyDark: body ? lum(getComputedStyle(document.body).backgroundColor) < 0.5 : null,
    });
    if (!body || probe.frames.filter((f) => f.body).length < 2) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

async function themeState(page: Page) {
  return page.evaluate(() => {
    const lum = (c: string) => {
      const ok = c.match(/^oklch\(([\d.]+)(%?)/);
      if (ok) return ok[2] ? Number(ok[1]) / 100 : Number(ok[1]);
      const n = (c.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
      return (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / 255;
    };
    const root = document.documentElement;
    return {
      attr: root.getAttribute('data-theme'),
      scheme: getComputedStyle(root).colorScheme,
      bodyDark: lum(getComputedStyle(document.body).backgroundColor) < 0.5,
      stored: localStorage.getItem('theme'),
    };
  });
}

const expectResolved = async (page: Page, dark: boolean) => {
  await expect.poll(async () => (await themeState(page)).bodyDark).toBe(dark);
  expect((await themeState(page)).scheme).toBe(dark ? 'dark' : 'light');
};

const openUserMenu = async (page: Page) => {
  await page.locator('header button:has(.rounded-full)').click();
  await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
};

const pick = async (page: Page, choice: Choice) => {
  await page.getByRole('radio', { name: choice }).click();
  await expect(page.getByRole('radio', { name: choice })).toHaveAttribute('aria-checked', 'true');
};

const markDocument = (page: Page) => page.evaluate(() => ((window as unknown as { __sameDoc: boolean }).__sameDoc = true));
const sameDocument = (page: Page) => page.evaluate(() => Boolean((window as unknown as { __sameDoc?: boolean }).__sameDoc));

/** Reload with the first-paint probe; returns what it saw. */
async function reloadAndProbe(page: Page) {
  await page.addInitScript(FIRST_PAINT_PROBE);
  await page.reload();
  await page.waitForFunction(() => {
    const p = (window as unknown as { __themeProbe?: { frames: { body: boolean }[] } }).__themeProbe;
    return Boolean(p && p.frames.filter((f) => f.body).length >= 2);
  });
  return page.evaluate(() => (window as unknown as { __themeProbe: unknown }).__themeProbe) as Promise<{
    atBody: string | null;
    frames: { body: boolean; scheme: string; bodyDark: boolean | null }[];
  }>;
}

/** /login in a signed-out context whose stored choice is `stored`. */
async function loginPage(browser: Browser, baseURL: string, device: Device, stored: string) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 800 },
    colorScheme: device,
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: 'theme', value: stored }] }] },
  });
  const page = await context.newPage();
  await page.addInitScript(FIRST_PAINT_PROBE);
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /login/i }).first()).toBeVisible();
  const probe = await page.evaluate(() => (window as unknown as { __themeProbe: { atBody: string | null } }).__themeProbe);
  return { context, page, probe };
}

/** Screenshots of the main pages in the current mode (item 6 of the visual pass). */
async function snapPages(page: Page, tag: string, result: Record<string, unknown>) {
  const pages: [string, string][] = [
    ['home', '/'],
    ['search', '/search?q=martian'],
    ['my-requests', '/requests'],
    ['bookdate', '/bookdate'],
    ['admin-dashboard', '/admin'],
    ['admin-settings', '/admin/settings'],
  ];
  for (const [name, url] of pages) {
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(800);
    await snap(page, DIR, `${name}-${tag}-1280`);
    if (name === 'my-requests') {
      const cover = page.locator('div[role="button"][tabindex="0"]').first();
      if (await cover.isVisible().catch(() => false)) {
        await cover.click();
        await page.waitForTimeout(1200);
        await snap(page, DIR, `request-details-${tag}-1280`);
        await page.keyboard.press('Escape');
      } else {
        result[`requestDetails-${tag}`] = 'no request card with a cover button';
      }
    }
  }
}

test.beforeAll(async () => {
  // A request so My Requests and the details window have something to show (smoke uses phm).
  const rmab = await Rmab.loginAdmin();
  const { martian } = await fakeArr.books();
  if (!(await rmab.findRequest(martian.asin))) await rmab.requestBook(martian);
});

test('#557: dark device + Light chosen stays light (reload, first parse, client navigation, login)', async ({ page, browser, baseURL }) => {
  const result: Record<string, unknown> = {};
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  result.initial = await themeState(page);
  expect(result.initial).toMatchObject({ attr: null, stored: null });
  await expectResolved(page, true);

  await openUserMenu(page);
  await expect(page.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  await pick(page, 'Light');
  await expectResolved(page, false);
  expect(await themeState(page)).toMatchObject({ attr: 'light', stored: 'light' });

  const probe = await reloadAndProbe(page);
  result.reloadProbe = probe;
  expect(probe.atBody).toBe('light');
  expect(probe.frames.length).toBeGreaterThan(0);
  for (const f of probe.frames) {
    expect(f.scheme).toBe('light');
    if (f.body) expect(f.bodyDark).toBe(false);
  }
  await expectResolved(page, false);

  await markDocument(page);
  await page.locator('header nav').getByRole('link', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/search$/);
  expect(await sameDocument(page)).toBe(true);
  await expectResolved(page, false);
  expect((await themeState(page)).attr).toBe('light');

  await snapPages(page, 'light-on-dark-device', result);

  const login = await loginPage(browser, baseURL!, 'dark', 'light');
  result.loginProbe = login.probe;
  expect(login.probe.atBody).toBe('light');
  await expectResolved(login.page, false);
  await snap(login.page, DIR, 'login-light-on-dark-device-1280');
  await login.context.close();

  writeEvidence(`${DIR}/light-on-dark.json`, result);
});

test('#557: light device + Dark chosen stays dark (reload, first parse, login)', async ({ page, browser, baseURL }) => {
  const result: Record<string, unknown> = {};
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expectResolved(page, false);

  await openUserMenu(page);
  await pick(page, 'Dark');
  await expectResolved(page, true);
  expect(await themeState(page)).toMatchObject({ attr: 'dark', stored: 'dark' });

  const probe = await reloadAndProbe(page);
  result.reloadProbe = probe;
  expect(probe.atBody).toBe('dark');
  for (const f of probe.frames) {
    expect(f.scheme).toBe('dark');
    if (f.body) expect(f.bodyDark).toBe(true);
  }

  await snapPages(page, 'dark-on-light-device', result);

  const login = await loginPage(browser, baseURL!, 'light', 'dark');
  result.loginProbe = login.probe;
  expect(login.probe.atBody).toBe('dark');
  await expectResolved(login.page, true);
  await snap(login.page, DIR, 'login-dark-on-light-device-1280');
  await login.context.close();

  writeEvidence(`${DIR}/dark-on-light.json`, result);
});

test('#557: System follows the device, including a live change without a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expectResolved(page, false);
  await markDocument(page);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectResolved(page, true);
  await page.emulateMedia({ colorScheme: 'light' });
  await expectResolved(page, false);
  expect(await sameDocument(page)).toBe(true);

  // Picking Light and then System again clears the choice and follows the device once more.
  await openUserMenu(page);
  await pick(page, 'Light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectResolved(page, false);
  await pick(page, 'System');
  expect(await themeState(page)).toMatchObject({ attr: null, stored: null });
  await expectResolved(page, true);
  await page.emulateMedia({ colorScheme: 'light' });
  await expectResolved(page, false);
  expect(await sameDocument(page)).toBe(true);
});

test('#557: the open menu with each choice (1280 light device, 375 dark device)', async ({ page }) => {
  const runs: { device: Device; width: number; height: number }[] = [
    { device: 'light', width: 1280, height: 800 },
    { device: 'dark', width: 375, height: 812 },
  ];
  for (const { device, width, height } of runs) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: device });
    await page.goto('/');
    await openUserMenu(page);
    for (const choice of ['System', 'Light', 'Dark'] as Choice[]) {
      await pick(page, choice);
      await page.waitForTimeout(300);
      await snap(page, DIR, `menu-${choice.toLowerCase()}-${device}-device-${width}`);
    }
    await pick(page, 'System');
  }
});
