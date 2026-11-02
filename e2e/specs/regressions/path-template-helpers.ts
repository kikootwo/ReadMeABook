/**
 * Component: E2E helpers for the path template specs (#273 {primaryAuthor}, #250 {seriesPart:00})
 * Documentation: documentation/testing/e2e-harness.md
 *
 * - setTemplateInUi: Admin Settings > Paths, types the audiobook template with the keyboard, reads the
 *   live preview, Test Paths, Save Settings (real PUT /api/admin/settings/paths).
 * - pathsTabShots: the template field, its preview and the Available Variables panel at 1280 light,
 *   1280 dark and 375 (light), plus tap-target sizes at 375.
 * - deliver: one torrent release through fake Prowlarr + fake qBittorrent to `downloaded`.
 * - absItemAt: the real Audiobookshelf scan, then the item whose relPath is the given folder.
 */

import { expect, type Browser, type Page } from '@playwright/test';
import { Abs, authState, ctl, evidencePath, fakeArr, Rmab, urls, waitFor, writeEvidence } from '../../lib/harness';
import { markJobs, psql, sqlStr, waitOrganized } from './242-helpers';

export const audiobookTemplateInput = (page: Page) =>
  // The audiobook template comes first in the DOM; the ebook template shares its placeholder.
  page.locator('input[placeholder="{author}/{title} {asin}"]').first();

const audiobookSection = (page: Page) => page.locator('div', { has: page.getByText('Audiobook Organization Template', { exact: true }) }).last();
const previewBox = (page: Page) => audiobookSection(page).locator('div', { has: page.getByRole('heading', { name: 'Preview Examples' }) }).last();
const pathsTabButton = (page: Page) => page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: /Paths/ });
const variablesPanel = (page: Page) => page.locator('div', { has: page.getByRole('heading', { name: 'Available Variables' }) }).last();

export async function openPathsTab(page: Page) {
  await page.goto('/admin/settings');
  await pathsTabButton(page).click();
  await expect(page.getByText('Audiobook Organization Template', { exact: true })).toBeVisible();
}

/** Select-all + Backspace, then type the template key by key. Returns the preview lines. */
export async function typeTemplate(page: Page, template: string): Promise<string[]> {
  const input = audiobookTemplateInput(page);
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await input.pressSequentially(template, { delay: 15 });
  await expect(input).toHaveValue(template);
  const preview = previewBox(page);
  await expect(preview).toBeVisible();
  return (await preview.locator('div.text-xs').allInnerTexts()).map((s) => s.trim());
}

/** Type, Test Paths, Save Settings. Returns preview lines and the stored config value. */
export async function setTemplateInUi(page: Page, template: string) {
  await openPathsTab(page);
  const before = await audiobookTemplateInput(page).inputValue();
  const preview = await typeTemplate(page, template);
  await page.getByRole('button', { name: 'Test Paths' }).click();
  await expect(page.getByText('All paths are valid and writable')).toBeVisible({ timeout: 30_000 });
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/admin/settings/paths') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  const res = await saved;
  const stored = psql(`select value from configuration where key = 'audiobook_path_template'`);
  return { before, preview, putStatus: res.status(), stored };
}

/** Clip from the template label to the bottom of the Available Variables panel. */
async function templateRegion(page: Page) {
  const label = await page.getByText('Audiobook Organization Template', { exact: true }).boundingBox();
  const panel = await variablesPanel(page).boundingBox();
  if (!label || !panel) throw new Error('template label or variables panel not on the page');
  const scrollY = await page.evaluate(() => window.scrollY);
  const width = page.viewportSize()!.width;
  const y = Math.max(0, label.y + scrollY - 12);
  return { x: 0, y, width, height: Math.ceil(panel.y + scrollY + panel.height + 12 - y) };
}

type View = { name: string; width: number; height: number; dark?: boolean; scale?: number };
export const VIEWS: View[] = [
  { name: '1280-light', width: 1280, height: 900 },
  { name: '1280-dark', width: 1280, height: 900, dark: true },
  { name: '375', width: 375, height: 812, scale: 2 },
];

/** Screenshots of the Paths tab with `template` typed (not saved), named `<prefix>-paths-<view>.jpg`. */
export async function pathsTabShots(browser: Browser, dir: string, prefix: string, template: string) {
  const metrics: Record<string, unknown> = {};
  for (const v of VIEWS) {
    const ctx = await browser.newContext({
      baseURL: urls.rmab(),
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.scale ?? 1,
      colorScheme: v.dark ? 'dark' : 'light',
      storageState: evidencePath('storage-state.json'),
    });
    const page = await ctx.newPage();
    try {
      await openPathsTab(page);
      const preview = await typeTemplate(page, template);
      await variablesPanel(page).scrollIntoViewIfNeeded();
      const clip = await templateRegion(page);
      await page.screenshot({ path: evidencePath(dir, `${prefix}-paths-${v.name}.jpg`), type: 'jpeg', quality: 82, fullPage: true, clip });
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const box = async (loc: ReturnType<Page['locator']>) => {
        const b = await loc.boundingBox();
        return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null;
      };
      const varCells = await variablesPanel(page).locator('div.grid > div').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { text: (e.textContent || '').trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        }));
      const cut = await variablesPanel(page).locator('div.grid > div').evaluateAll((els) =>
        els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent || '').trim()));
      metrics[v.name] = {
        preview,
        overflowX,
        templateInput: await box(audiobookTemplateInput(page)),
        testPathsButton: await box(page.getByRole('button', { name: 'Test Paths' })),
        saveButton: await box(page.getByRole('button', { name: 'Save Settings' })),
        pathsTab: await box(pathsTabButton(page)),
        variableCells: varCells,
        cellsWithHorizontalOverflow: cut,
      };
    } finally {
      await ctx.close();
    }
  }
  writeEvidence(`${dir}/${prefix}-paths-metrics.json`, metrics);
  return metrics;
}

/** One torrent release for `bookKey` (fixture `fixture`); the request (with `author`) runs to `downloaded`. */
export async function deliver(rmab: Rmab, opts: { bookKey: string; fixture: string; author: string; releaseTitle: string; scenario: string }) {
  const def = {
    name: opts.scenario,
    description: `One multi-file mp3 torrent for book ${opts.bookKey} (generated tones).`,
    book: opts.bookKey,
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [{ id: 'good', title: opts.releaseTitle, sizeMB: 420, seeders: 60, fixture: opts.fixture }],
  };
  const loaded = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  expect(loaded.status).toBe(200);
  const idx = await rmab.get<{ indexers: unknown[]; flagConfigs: unknown[] }>('/api/admin/settings/prowlarr/indexers');
  expect((await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers: idx.indexers, flagConfigs: idx.flagConfigs })).ok).toBe(true);

  const book = (await fakeArr.books())[opts.bookKey];
  const since = markJobs();
  const created = await rmab.requestBook({ ...book, author: opts.author });
  const requestId = created.request.id;
  const status = await waitFor('request delivered', async () => {
    const s = psql(`select status from requests where id = ${sqlStr(requestId)}`);
    return ['downloaded', 'available', 'failed', 'awaiting_search'].includes(s) ? s : null;
  }, { timeoutMs: 420_000, intervalMs: 3_000 });
  if (status === 'downloaded' || status === 'available') await waitOrganized(since, requestId);
  const [filePath, author, series, seriesPart] = psql(
    `select concat_ws('|', coalesce(a.file_path,''), a.author, coalesce(a.series,''), coalesce(a.series_part,'')) from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(requestId)}`
  ).split('|');
  return { book, requestId, status: psql(`select status from requests where id = ${sqlStr(requestId)}`), filePath, author, series, seriesPart };
}

/** Real ABS library scan, then the item at `rel` (relative to the library folder). */
export async function absItemAt(rel: string) {
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  const scan = await fetch(`${urls.abs()}/api/libraries/${libraryId}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${abs.token}` } });
  expect(scan.ok, 'ABS library scan').toBe(true);
  const items = await waitFor('ABS item at the folder', async () => {
    const all = await abs.libraryItems(libraryId);
    return all.some((i) => String(i.relPath || '').replace(/\/+$/, '') === rel) ? all : null;
  }, { timeoutMs: 180_000, intervalMs: 2_000 }).catch(async () => abs.libraryItems(libraryId));
  const item = items.find((i) => String(i.relPath || '').replace(/\/+$/, '') === rel);
  const full = item ? await abs.req('GET', `/api/items/${item.id}`) : null;
  return {
    found: Boolean(item),
    allRelPaths: items.map((i) => i.relPath),
    id: item?.id ?? null,
    relPath: item?.relPath ?? null,
    path: item?.path ?? null,
    title: full?.media?.metadata?.title ?? null,
    authorName: full?.media?.metadata?.authorName ?? null,
    authors: (full?.media?.metadata?.authors || []).map((a: { name: string }) => a.name),
    series: (full?.media?.metadata?.series || []).map((s: { name: string; sequence: string | null }) => ({ name: s.name, sequence: s.sequence })),
    audioFiles: (full?.media?.audioFiles || []).map((f: { metadata?: { filename?: string } }) => f.metadata?.filename),
  };
}
