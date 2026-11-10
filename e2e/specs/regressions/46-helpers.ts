/**
 * Component: E2E regression #46 helpers (download client categories: scenarios, grabs, UI contexts)
 * Documentation: documentation/testing/e2e-harness.md
 */

import type { Browser, Page } from '@playwright/test';
import { ctl, evidencePath, fakeArr, waitFor, type Recorded, type Rmab } from '../../lib/harness';
import { MEDIA, q, sh, psql, sqlStr, markJobs, waitOrganized, eventsSince, fmtEvents, requestState, type CaseRun } from './242-helpers';

export const QBIT = 'e2e-qbit';
export const SAB = 'e2e-sab';

export const VIEWS = {
  light: { width: 1280, height: 800, dark: false, tag: '1280-light' },
  dark: { width: 375, height: 812, dark: true, tag: '375-dark' },
};
export type View = (typeof VIEWS)[keyof typeof VIEWS];

/** One release for one book on the torrent (indexer 1) or usenet (indexer 2) indexer. */
export async function loadScenario(book: string, protocol: 'torrent' | 'usenet', fixture: string) {
  const indexer = protocol === 'torrent' ? { id: 1, name: 'E2E Torrents', protocol, priority: 25 } : { id: 2, name: 'E2E Usenet', protocol, priority: 25 };
  const def = {
    name: `cat46-${protocol}-${book}`,
    book,
    indexers: [indexer],
    releases: [{ id: `${protocol}-${book}`, protocol, indexerId: indexer.id, title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]', sizeMB: 300, seeders: 50, fixture }],
  };
  const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  if (!res.ok) throw new Error(`load scenario ${def.name}: HTTP ${res.status} ${await res.text()}`);
  return def;
}

/** Fake-client calls recorded after `since` for one service. */
export async function callsSince(since: number, service: 'qbit' | 'sab'): Promise<Recorded[]> {
  return (await fakeArr.requests(since)).filter((r) => r.service === service);
}

export const lastSeq = async () => (await fakeArr.requests()).reduce((m, r) => Math.max(m, r.seq), 0);

/** Request a fixture book, wait until it is downloaded and organized; save the events and request state. */
export async function grabAndImport(c: CaseRun, rmab: Rmab, bookKey: string) {
  const book = (await fakeArr.books())[bookKey];
  const mark = markJobs();
  const created = await rmab.requestBook(book);
  const requestId = created.request.id;
  await waitFor(
    `${bookKey} downloaded/available`,
    async () => ['downloaded', 'available'].includes(psql(`select status from requests where id = ${sqlStr(requestId)}`)) || null,
    { timeoutMs: 300_000, intervalMs: 3_000 }
  );
  await waitOrganized(mark, requestId);
  await new Promise((r) => setTimeout(r, 2_000));
  const events = eventsSince(mark);
  c.save(`events-${bookKey}.log`, `${fmtEvents(events)}\n`);
  c.save(`request-state-${bookKey}.tsv`, `${requestState(requestId)}\n`);
  const status = psql(`select status from requests where id = ${sqlStr(requestId)}`);
  const libraryFiles = sh(`find ${q(MEDIA)} -type f \\( -name '*.mp3' -o -name '*.m4b' \\) -size +0 -path ${q(`*${book.title}*`)} | sort`).split('\n').filter(Boolean);
  return { book, requestId, events, status, libraryFiles };
}

/** Admin page (bootstrap's session) at a size and color scheme. */
export async function adminPage(browser: Browser, view: View): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    storageState: evidencePath('storage-state.json'),
    viewport: { width: view.width, height: view.height },
    colorScheme: view.dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  return { page, close: () => ctx.close() };
}

/** The settings card of one client (innermost element holding its name heading). */
export function clientCard(page: Page, name: string) {
  return page.locator('div.rounded-lg').filter({ has: page.getByRole('heading', { name, exact: true }) }).last();
}

export async function openDownloadSettings(page: Page) {
  await page.goto('/admin/settings?tab=download');
  const card = clientCard(page, 'qBittorrent (fake)');
  await card.waitFor({ timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
}

/** Open the Edit modal of a client, run Test Connection, wait for the category suggestions. */
export async function editAndTest(page: Page, cardName: string, expectSuggestion: string) {
  await clientCard(page, cardName).getByTitle('Edit client').click();
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await page.locator(`datalist option[value="${expectSuggestion}"]`).waitFor({ state: 'attached', timeout: 30_000 });
  return page.getByLabel('Category', { exact: true });
}

export async function datalistValues(page: Page): Promise<string[]> {
  return page.locator('datalist option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
}

/** PUT a category for a client through the real route; returns the HTTP status and the stored client. */
export async function putCategory(rmab: Rmab, id: string, category: string) {
  const res = await rmab.raw('PUT', `/api/admin/settings/download-clients/${id}`, { category });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, stored: storedClient(id) };
}

/** The client entry exactly as stored in `configuration.download_clients`. */
export function storedClient(id: string): Record<string, unknown> | undefined {
  const raw = psql(`select value from configuration where key = 'download_clients'`);
  return (JSON.parse(raw || '[]') as Record<string, unknown>[]).find((c) => c.id === id);
}

/** Fake-client entries as GET /__control/state returns them (fields the #46 specs read). */
export interface FakeTorrent { name: string; category: string; save_path: string }
export interface FakeNzb { name?: string; filename?: string; category?: string; cat?: string; storage?: string }

export const has = (events: { message: string }[], text: string) => events.some((e) => e.message.includes(text));
