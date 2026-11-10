/**
 * Component: E2E helpers for #68 (File placement: hard links, metadata.opf)
 * Documentation: documentation/features/library-placement.md
 */

import { expect, type Browser, type Page } from '@playwright/test';
import { Abs, authState, ctl, env, evidencePath, fakeArr, Rmab, urls, waitFor, type Book } from '../../lib/harness';
import { asApp, markJobs, psql, q, sh, sqlStr, waitOrganized } from './242-helpers';

export const SHOTS = '68';
export const SHARED_DOWNLOADS = '/media/downloads';
export const STOCK_DOWNLOADS = '/downloads';

/** One file's identity and content as the app user sees it (stat inside the rmab container). */
export interface FileId { path: string; dev: string; ino: string; nlink: number; sha: string }

export function fileId(p: string): FileId {
  const [stat, sum] = sh(`stat -c '%d %i %h' '${p}' && sha256sum '${p}' | cut -d' ' -f1`).trim().split('\n');
  const [dev, ino, nlink] = stat.split(' ');
  return { path: p, dev, ino, nlink: Number(nlink), sha: sum };
}

export const devOf = (dir: string) => sh(`stat -c '%d' '${dir}'`).trim();

/** Files below `dir` (regular files only), sorted. */
export const filesUnder = (dir: string): string[] =>
  sh(`[ -d '${dir}' ] && find '${dir}' -type f | sort || true`).trim().split('\n').filter(Boolean);

/** Read the stored paths settings and save them with `patch` through the real admin PUT. */
export async function savePaths(rmab: Rmab, patch: Record<string, unknown>) {
  const { paths } = await rmab.get<{ paths: Record<string, unknown> }>('/api/admin/settings');
  const current: Record<string, unknown> = { ...paths };
  delete current.linkFallbackLast; // read-only status, not a setting
  const res = await rmab.raw('PUT', '/api/admin/settings/paths', { ...current, ...patch });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function loadRelease(name: string, bookKey: string, fixture: string, releaseTitle: string) {
  const definition = {
    name,
    description: `#68: one torrent for book ${bookKey} (generated audio).`,
    book: bookKey,
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [{ id: 'good', title: releaseTitle, sizeMB: 420, seeders: 60, fixture }],
  };
  const loaded = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition }) });
  expect(loaded.status, `load scenario ${name}`).toBe(200);
}

/** Seed the book row (two authors, series, year) so the OPF has something to say offline. */
export function seedBook(book: Book, authors: string, series: string, year: number) {
  psql(`insert into audiobooks (id, audible_asin, title, author, narrator, series, series_part, year, status, created_at, updated_at)
        values (gen_random_uuid()::text, ${sqlStr(book.asin)}, ${sqlStr(book.title)}, ${sqlStr(authors)}, ${sqlStr(book.narrator)},
                ${sqlStr(series)}, '1', ${year}, 'requested', now(), now())`);
}

export const requestStatus = (id: string) => psql(`select status from requests where id = ${sqlStr(id)}`);
export const requestMessage = (id: string) => psql(`select coalesce(error_message, '') from requests where id = ${sqlStr(id)}`);
export const bookFolder = (id: string) =>
  psql(`select coalesce(a.file_path, '') from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(id)}`);
export const blocklistRows = (requestId: string) => psql(`select count(*) from blocked_releases where request_id = ${sqlStr(requestId)}`);

/** Request `book` (author override) and wait until the organize job settled on one of `until`. */
export async function requestAndWait(rmab: Rmab, book: Book, author: string, until: string[]) {
  const since = markJobs();
  const requestId = (await rmab.requestBook({ ...book, author })).request.id;
  const status = await waitFor(`request reaches ${until.join('/')}`, async () => {
    const s = requestStatus(requestId);
    return [...until, 'failed', 'awaiting_search'].includes(s) ? s : null;
  }, { timeoutMs: 420_000, intervalMs: 3_000 });
  if (status === 'downloaded' || status === 'available') await waitOrganized(since, requestId);
  return { requestId, status, since };
}

/** The torrent the fake client holds for this request (hash from download_history). */
export async function torrentOf(requestId: string) {
  const hash = psql(`select coalesce(torrent_hash, download_client_id, '') from download_history where request_id = ${sqlStr(requestId)} order by created_at desc limit 1`);
  type Listed = { hash: string; save_path?: string; content_path?: string; state?: string };
  const torrents: Listed[] = (await fakeArr.state()).torrents ?? [];
  const t = torrents.find((x) => String(x.hash).toLowerCase() === hash.toLowerCase());
  return { hash, listed: Boolean(t), savePath: t?.save_path ?? null, contentPath: t?.content_path ?? null, state: t?.state ?? null };
}

/** Real ABS scan, then the item whose path is `folder` (absolute, under the library). */
export async function absItemFor(folder: string) {
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  await abs.req('POST', `/api/libraries/${libraryId}/scan`).catch(() => undefined);
  const item = await waitFor('ABS item for the book folder', async () => {
    const all = await abs.libraryItems(libraryId);
    return all.find((i) => String(i.path || '').replace(/\/+$/, '') === folder) || null;
  }, { timeoutMs: 180_000, intervalMs: 3_000 });
  const full = await abs.req('GET', `/api/items/${item.id}?expanded=1`);
  const m = full.media?.metadata ?? {};
  return {
    id: item.id as string,
    title: m.title ?? null,
    authors: (m.authors || []).map((a: { name: string }) => a.name),
    narrators: m.narrators ?? [],
    series: (m.series || []).map((s: { name: string; sequence: string | null }) => ({ name: s.name, sequence: s.sequence })),
    asin: m.asin ?? null,
    publishedYear: m.publishedYear ?? null,
    audioFiles: (full.media?.audioFiles || []).map((f: { metadata?: { path?: string } }) => f.metadata?.path),
  };
}

/**
 * Screenshot the Audiobookshelf book page (its own web client, root user from the test env).
 * Returns null when it worked, else the error text (the API values are the assertion; this is the picture).
 */
export async function absBookPageShot(browser: Browser, itemId: string, title: string, name: string): Promise<string | null> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${urls.abs()}/`);
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    const base = page.url().replace(/\/login.*$/, '');
    await page.locator('input:not([type=password])').first().fill(env('ABS_ROOT_USER'));
    await page.locator('input[type=password]').first().fill(env('ABS_ROOT_PASSWORD'));
    await page.locator('input[type=password]').first().press('Enter');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
    await page.goto(`${base}/item/${itemId}`);
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: evidencePath(SHOTS, 'shots', `${name}.jpg`), type: 'jpeg', quality: 82 });
    return null;
  } catch (error) {
    await page.screenshot({ path: evidencePath(SHOTS, `${name}-failed.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
    return String(error);
  } finally {
    await ctx.close();
  }
}

/** A browser page on RMAB as the admin. */
export async function adminPage(browser: Browser, width: number, height: number, dark: boolean) {
  const ctx = await browser.newContext({
    baseURL: urls.rmab(), viewport: { width, height }, colorScheme: dark ? 'dark' : 'light',
    deviceScaleFactor: width < 768 ? 2 : 1, storageState: evidencePath('storage-state.json'),
  });
  return { ctx, page: await ctx.newPage() };
}

export async function openPaths(page: Page) {
  await page.goto('/admin/settings');
  await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: /Paths/ }).click();
  await expect(page.getByText('Audiobook Organization Template', { exact: true })).toBeVisible();
}

/** Full-height capture (sticky header stays on top) after transitions settle. */
export async function fullShot(page: Page, name: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const size = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: evidencePath(SHOTS, 'shots', `${name}.jpg`), type: 'jpeg', quality: 82, fullPage: true });
  await page.setViewportSize(size);
}

/** One capture from the top of `top` to the bottom of `bottom` (e.g. the section down to the Save row). */
export async function regionShot(page: Page, top: ReturnType<Page['locator']>, bottom: ReturnType<Page['locator']>, name: string) {
  const size = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const a = await top.boundingBox();
  const b = await bottom.boundingBox();
  if (!a || !b) throw new Error(`regionShot ${name}: element not on the page`);
  const y = Math.max(0, a.y - 12);
  await page.screenshot({
    path: evidencePath(SHOTS, 'shots', `${name}.jpg`), type: 'jpeg', quality: 85,
    clip: { x: Math.max(0, a.x - 12), y, width: Math.min(size.width, a.width + 24), height: b.y + b.height + 12 - y },
  });
  await page.setViewportSize(size);
}

/** The whole page fits the viewport while shooting, so the sticky header never covers the element. */
export async function elementShot(page: Page, selector: ReturnType<Page['locator']>, name: string) {
  const size = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await selector.screenshot({ path: evidencePath(SHOTS, 'shots', `${name}.jpg`), type: 'jpeg', quality: 85 });
  await page.setViewportSize(size);
}

/** A made-up book row (offline RMAB can't fetch one by ASIN); returns its id. */
export function insertBook(title: string, asin: string): string {
  return psql(`insert into audiobooks (id, audible_asin, title, author, narrator, status, updated_at)
               values (gen_random_uuid()::text, ${sqlStr(asin)}, ${sqlStr(title)}, 'Test Author', 'Other Narrator', 'requested', now()) returning id`).split('\n')[0];
}

/** Generated tones (6 s each) as the app user: `dir/<name>` for each name. */
export function generateTones(dir: string, names: string[]): string[] {
  asApp([`mkdir -p ${q(dir)}`, ...names.map((n, i) =>
    `ffmpeg -nostdin -loglevel error -f lavfi -i sine=frequency=${300 + 100 * i}:duration=6 -c:a libmp3lame -b:a 64k -y ${q(`${dir}/${n}`)}`)].join('\n'));
  return names.map((n) => `${dir}/${n}`);
}

/** Manual Import of `folderPath` for a book row or an existing request; waits for the organize job. */
export async function manualImport(rmab: Rmab, folderPath: string, target: { audiobookId: string } | { requestId: string }) {
  const since = markJobs();
  const res = await rmab.raw('POST', '/api/admin/manual-import', { ...target, folderPath, cleanupSource: false });
  const body = await res.clone().json().catch(() => ({}));
  expect(res.status, `manual import ${folderPath}: ${JSON.stringify(body)}`).toBe(200);
  const requestId: string = body.requestId ?? (target as { requestId: string }).requestId;
  const settled = await waitOrganized(since, requestId);
  return { requestId, status: settled.status };
}
