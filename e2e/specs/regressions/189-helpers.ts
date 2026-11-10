/**
 * Component: E2E regression #189 helpers (fixture books, seed/cleanup, the held-to-origin session, replays)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Every book is a made-up name on a fake ASIN (B0E2E189xx) seeded in audible_cache + audiobooks;
 * covers are flat SVGs drawn in the browser, and the browser never leaves the RMAB origin (anything
 * else is aborted and recorded in `blocked`).
 */

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { evidencePath } from '../../lib/harness';
import { libraryFolder, psql, sqlStr, sh, q, MEDIA } from './434-helpers';

export const RUN = `run-${Date.now().toString(36)}`;
export const ROOT_PARENT = '/downloads/e2e-189';
export const ROOT = `${ROOT_PARENT}/${RUN}`;
export const MEDIA_ROOT = `${MEDIA}/e2e-189-${RUN}`;
export const AUTHOR = 'E2E Fixture Author';
const COVER_HOST = 'covers.e2e.invalid';

export const BOOK = {
  wrong: { asin: 'B0E2E18901', title: 'E2E Wrong Guess' },
  search: { asin: 'B0E2E18902', title: 'E2E Search Pick' },
  typed: { asin: 'B0E2E18903', title: 'E2E Typed Pick' },
  owned: { asin: 'B0E2E18904', title: 'E2E Owned Book' },
  asked: { asin: 'B0E2E18905', title: 'E2E Asked Book' },
  fix: { asin: 'B0E2E18907', title: 'E2E Requested Fix' },
  twice: { asin: 'B0E2E18908', title: 'E2E Twice Found' },
  race: { asin: 'B0E2E18909', title: 'E2E Late Request' },
} as const;
const ALL_ASINS = Object.values(BOOK).map((b) => b.asin);
export const UNKNOWN_ASIN = 'B0E2E18999';
const PLEX_GUID = `e2e-189-${RUN}`;

export const FOLDERS = ['Folder Alpha', 'Folder Bravo', 'Folder Charlie', 'Folder Delta', 'Folder Golf', 'Folder Echo', 'Folder Foxtrot'];
const cover = (asin: string) => `https://${COVER_HOST}/${asin}.jpg`;
const match = (b: { asin: string; title: string }) => ({ asin: b.asin, title: b.title, author: AUTHOR, narrator: 'E2E Narrator', coverArtUrl: cover(b.asin), durationMinutes: 61 });

/** What the replayed scan gives each real row (by folder name): the scan's match and flags. */
const REPLAY: Record<string, { match: ReturnType<typeof match> | null; inLibrary?: boolean; hasActiveRequest?: boolean }> = {
  'Folder Alpha': { match: match(BOOK.wrong) },
  'Folder Bravo': { match: null },
  'Folder Charlie': { match: match(BOOK.asked), hasActiveRequest: true },
  'Folder Delta': { match: match(BOOK.owned), inLibrary: true },
  'Folder Golf': { match: match(BOOK.race) },
  'Folder Echo': { match: match(BOOK.twice) },
  'Folder Foxtrot': { match: match(BOOK.twice) },
};
/** Replayed text-search results: one free book, one In Library, one Requested. */
export const SEARCH_REPLAY = [
  { ...match(BOOK.search), inLibrary: false, hasActiveRequest: false },
  { ...match(BOOK.owned), inLibrary: true, hasActiveRequest: false },
  { ...match(BOOK.asked), inLibrary: false, hasActiveRequest: true },
];

/** URLs off the RMAB origin that a page asked for (aborted). */
export const blocked: string[] = [];

export function seed() {
  for (const b of Object.values(BOOK)) {
    psql(`insert into audible_cache (id, asin, title, author, narrator, description, genres, last_synced_at, created_at, updated_at)
          values (gen_random_uuid(), ${sqlStr(b.asin)}, ${sqlStr(b.title)}, ${sqlStr(AUTHOR)}, 'E2E Narrator', 'Generated test book.', '[]'::jsonb, now(), now(), now())
          on conflict (asin) do nothing`);
    psql(`insert into audiobooks (id, audible_asin, title, author, narrator, series, series_part, year, status, created_at, updated_at)
          values (gen_random_uuid(), ${sqlStr(b.asin)}, ${sqlStr(b.title)}, ${sqlStr(AUTHOR)}, 'E2E Narrator', 'E2E 189 Series', '1', 2020, 'requested', now(), now())`);
  }
  psql(`insert into plex_library (id, plex_guid, title, author, asin, plex_library_id, last_scanned_at, created_at, updated_at)
        values (gen_random_uuid(), ${sqlStr(PLEX_GUID)}, ${sqlStr(BOOK.owned.title)}, ${sqlStr(AUTHOR)}, ${sqlStr(BOOK.owned.asin)}, 'e2e-189', now(), now(), now())`);
  activeRequest(BOOK.asked.asin);
}

/** A pending request (the admin's) for the book: the scan's Requested. */
export function activeRequest(asin: string) {
  psql(`insert into requests (id, user_id, audiobook_id, type, status, progress, created_at, updated_at)
        select gen_random_uuid(), (select id from users where role = 'admin' order by created_at limit 1), id, 'audiobook', 'pending', 0, now(), now()
        from audiobooks where audible_asin = ${sqlStr(asin)} limit 1`);
}

export function requestsFor(asin: string): string[] {
  return psql(`select r.status from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin = ${sqlStr(asin)} and r.deleted_at is null order by r.created_at`)
    .split('\n').filter(Boolean);
}

export function cleanup(): string[] {
  const errors: string[] = [];
  try {
    sh(`rm -rf ${q(ROOT)} ${q(MEDIA_ROOT)}\nrmdir ${q(ROOT_PARENT)} 2>/dev/null || true`);
    for (const asin of ALL_ASINS) {
      const folder = libraryFolder(asin);
      if (folder) sh(`rm -rf ${q(folder)}`);
    }
  } catch (error) {
    errors.push(`files: ${String(error)}`);
  }
  const list = ALL_ASINS.map(sqlStr).join(',');
  const reqs = `(select id from requests where audiobook_id in (select id from audiobooks where audible_asin in (${list})))`;
  try {
    psql(`begin;
          delete from job_events where job_id in (select id from jobs where request_id in ${reqs});
          delete from jobs where request_id in ${reqs};
          delete from requests where id in ${reqs};
          delete from audiobooks where audible_asin in (${list});
          delete from audible_cache where asin in (${list});
          delete from plex_library where plex_guid = ${sqlStr(PLEX_GUID)};
          commit;`);
  } catch (error) {
    errors.push(`rows: ${String(error).slice(0, 400)}`);
  }
  return errors;
}

function coverSvg(url: string) {
  let h = 0;
  for (const c of url) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${h},45%,42%)"/></svg>`;
}

/** The scan stream the wizard reads: the real rows (by folder name) given REPLAY's matches and flags. */
export function scanReplayBody(realRows: any[]): string {
  const rows = FOLDERS.map((name, index) => {
    const real = realRows.find((r) => r.folderName === name);
    const r = REPLAY[name];
    return { ...real, index, match: r.match, inLibrary: !!r.inLibrary, hasActiveRequest: !!r.hasActiveRequest };
  });
  return [...rows.map((r) => `event: book_matched\ndata: ${JSON.stringify(r)}\n\n`), `event: complete\ndata: {}\n\n`].join('');
}

/** A context held to the RMAB origin, with the scan replay (unless `scanBody` is null) and the text-search replay. */
export async function session(browser: Browser, opts: { width: number; height: number; dark?: boolean; scanBody: (() => string) | null }) {
  const ctx: BrowserContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  const base = new URL(process.env.E2E_BASE_URL!).host;
  await ctx.route((url) => url.host !== base, (route) => {
    const url = route.request().url();
    if (new URL(url).host === COVER_HOST) return route.fulfill({ contentType: 'image/svg+xml', body: coverSvg(url) });
    blocked.push(url);
    return route.abort();
  });
  const scanBody = opts.scanBody;
  if (scanBody) {
    await ctx.route((url) => url.pathname === '/api/admin/bulk-import/scan', (route) => route.fulfill({ contentType: 'text/event-stream', body: scanBody() }));
  }
  await ctx.route((url) => url.pathname === '/api/admin/bulk-import/match', (route) => {
    const text = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (/^(B0[A-Z0-9]{8}|\d{9}[\dX])$/i.test(text.trim())) return route.continue(); // typed ASIN: the real route
    return route.fulfill({ json: { kind: 'search', asin: null, store: 'audible.com', results: SEARCH_REPLAY } });
  });
  return { ctx, page: await ctx.newPage() };
}

/** Admin page → Bulk Import → into `segments` under the root → Scan; resolves on the review footer. */
export async function openReview(page: Page, rootLabel: string, segments: string[]) {
  await page.goto('/admin');
  await page.getByRole('button', { name: /Bulk Import/ }).first().click();
  await page.getByRole('button', { name: new RegExp(rootLabel) }).click();
  for (const seg of segments) await page.getByRole('button', { name: seg, exact: true }).click();
  await page.getByRole('button', { name: 'Scan for Audiobooks' }).click();
  await expect(page.getByRole('button', { name: 'Start Import' })).toBeVisible({ timeout: 180_000 });
}

export const row = (page: Page, text: string) => page.getByTestId('bulk-import-row').filter({ hasText: text });
export const dialog = (page: Page) => page.getByRole('dialog');

export async function typeAsin(page: Page, asin: string) {
  await dialog(page).getByRole('searchbox').fill(asin);
  await dialog(page).getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog(page).getByRole('status')).not.toHaveText('Searching…', { timeout: 30_000 });
  await expect(dialog(page).getByRole('status')).not.toHaveText('');
}

/** True when the dialog's search field holds focus (on a phone the keyboard would be up). */
export async function fieldFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.getAttribute('type') === 'search');
}
