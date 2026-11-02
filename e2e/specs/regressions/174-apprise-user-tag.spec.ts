/**
 * Component: E2E regression #174 (Apprise Tag help text for {user})
 * Documentation: documentation/testing/e2e-harness.md
 *
 * No flags needed. Admin session from bootstrap's storage state:
 *   1  Settings > Notifications > Apprise opens the add form; the Tag field shows the {user} help
 *      text and the e.g. placeholder; Config Key "family" and Tag "admin, user-{user}" typed
 *   2  snapshots with the Tag field in view: 1280 px light, 375 px dark (`174/`)
 */

import { test, expect, type Browser } from '@playwright/test';
import { evidencePath, writeEvidence } from '../../lib/harness';

const DIR = '174';
const HELP = 'Config Key only. {user} = the user who made the request';

const VIEWS = [
  { name: 'apprise-tag-help', width: 1280, height: 800, dark: false },
  { name: 'apprise-tag-help-375-dark', width: 375, height: 812, dark: true },
];

async function openAppriseForm(browser: Browser, view: (typeof VIEWS)[number]) {
  const ctx = await browser.newContext({
    storageState: evidencePath('storage-state.json'),
    viewport: { width: view.width, height: view.height },
    colorScheme: view.dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  await page.goto('/admin/settings?tab=notifications');
  await page.getByRole('button', { name: /Apprise/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Add Apprise Notification' })).toBeVisible();
  return { ctx, page };
}

test('#174: the Apprise Tag field explains {user}', async ({ browser }) => {
  const result: Record<string, unknown> = {};

  for (const view of VIEWS) {
    const { ctx, page } = await openAppriseForm(browser, view);
    const tagInput = page.getByPlaceholder('e.g. admin, user-{user}');
    await expect(tagInput).toBeVisible();
    await page.getByPlaceholder('Persistent configuration key').fill('family');
    await tagInput.fill('admin, user-{user}');

    const help = page.getByText(HELP);
    await expect(help).toBeVisible();
    result[view.name] = { help: await help.textContent(), tag: await tagInput.inputValue() };

    await help.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: evidencePath(DIR, `${view.name}.jpg`), type: 'jpeg', quality: 80 });
    await ctx.close();
  }

  writeEvidence(`${DIR}/result.json`, result);
});
