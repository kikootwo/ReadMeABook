/**
 * Component: E2E regression #517 (Settings keeps its tab in ?tab=)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * No flags needed (default Audiobookshelf mode). Admin session from bootstrap's storage state:
 *   1  /admin/settings?tab=paths opens Paths; a reload keeps it
 *   2  clicking Download Client puts ?tab=download in the address with no server round trip
 *      (no RSC request), back returns to Paths, forward to Download Client
 *   3  an unknown tab shows the first tab (Audiobookshelf) and the address is left as it was
 *   4  snapshots of two tabs opened from the address (Paths, Download Client) at 1280 px
 */

import { test, expect, type Page } from '@playwright/test';
import { evidencePath, snap, writeEvidence } from '../../lib/harness';

test.use({ storageState: evidencePath('storage-state.json'), viewport: { width: 1280, height: 800 } });

const DIR = '517';
const PATHS_HEADING = 'Directory Paths';
const DOWNLOAD_HEADING = 'Download Clients';
const FIRST_TAB_HEADING = 'Audiobookshelf Server';

const tabButton = (page: Page, name: RegExp) => page.locator('nav[aria-label="Tabs"]').getByRole('button', { name });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const search = (page: Page) => new URL(page.url()).search;

test('#517: the Settings tab lives in ?tab= (deep link, reload, click, back/forward)', async ({ page }) => {
  const result: Record<string, unknown> = {};

  await page.goto('/admin/settings?tab=paths');
  await expect(heading(page, PATHS_HEADING)).toBeVisible();
  await expect(heading(page, FIRST_TAB_HEADING)).toHaveCount(0);
  await snap(page, DIR, 'tab-paths');

  await page.reload();
  await expect(heading(page, PATHS_HEADING)).toBeVisible();
  result.afterReload = search(page);
  expect(search(page)).toBe('?tab=paths');

  // A tab click is a client-side history push: no RSC fetch, no document load
  const serverRequests: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/admin/settings') && (url.searchParams.has('_rsc') || req.headers()['rsc'] === '1' || req.resourceType() === 'document')) {
      serverRequests.push(`${req.resourceType()} ${url.pathname}${url.search}`);
    }
  });
  await tabButton(page, /Download Client/).click();
  await expect(heading(page, DOWNLOAD_HEADING)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/settings\?tab=download$/);
  await page.waitForTimeout(500);
  result.serverRequestsOnClick = [...serverRequests];
  expect(serverRequests).toEqual([]);

  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/settings\?tab=paths$/);
  await expect(heading(page, PATHS_HEADING)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/settings\?tab=download$/);
  await expect(heading(page, DOWNLOAD_HEADING)).toBeVisible();

  await page.goto('/admin/settings?tab=nope');
  await expect(heading(page, FIRST_TAB_HEADING)).toBeVisible();
  await page.waitForTimeout(500);
  result.unknownTabSearch = search(page);
  expect(search(page)).toBe('?tab=nope');

  await page.goto('/admin/settings?tab=download');
  await expect(heading(page, DOWNLOAD_HEADING)).toBeVisible();
  await snap(page, DIR, 'tab-download');

  writeEvidence(`${DIR}/result.json`, result);
});
