/**
 * Component: E2E regression #599 (series volumes merged as duplicates and remembered)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Default flags (NOT --offline-fixtures / abs-fake-metadata: the fake serves no series HTML).
 * RMAB reads the real audible.de series page B0H3C5X19W; exec bridge required.
 * Setup: region de over psql (no settings PUT, which would start a storefront refresh), then the
 * config cache wait; one `dedup_auto` work linking vols 1-3 (the state a 1.3.0 install was left
 * in) and a library row for vol 1.
 *   1  GET /api/series/B0H3C5X19W: the five issue ASINs are present (fail fast if not), vol 1 is
 *      available, vols 2/3 are not; psql: the three ASINs sit in three works, no empty work.
 *   2  Re-seed, 5 concurrent GETs: no 5xx, the three ASINs in three works, no empty work.
 *   3  The series page at 1280 light and 375 dark (covers answered locally).
 * Live titles are numbered today ("... 1/2/3"), so local dedup alone no longer merges them: the
 * heal and the collapse split are proven by the page's position labels (same series, known and
 * different positions). Every GET records its layout (modern rows carry language/releaseDate)
 * and how many rows carry a position. audible.de answering 503 skips the spec with that reason.
 */

import { test, expect, type Browser } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, snap, stackLogsSync, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { activeLibraryId } from './177-library-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });

const SERIES = 'B0H3C5X19W';
const VOLS = ['B0H36S85HC', 'B0H6N477LX', 'B0H6N6TH8T', 'B0HQZV8WC6', 'B0HR12DG1S'];
const [V1, V2, V3] = VOLS;
const WORK = 'e2e-599-stale-work';
const GUID = 'e2e-599-vol1';
const COVER_HOST = 'm.media-amazon.com';
const CACHE_WAIT_MS = 62_000;

type Book = { asin: string; title: string; seriesPart?: string; language?: string; releaseDate?: string; isAvailable?: boolean };
const samples: Array<{ step: string; status: number; layout?: string; rows?: number; labelled?: number }> = [];
let regionBefore = '';

function seedStaleWork() {
  const asins = [V1, V2, V3].map(sqlStr).join(', ');
  psql(`begin;
    delete from work_asins where asin in (${asins});
    delete from works w where w.id = ${sqlStr(WORK)} or not exists (select 1 from work_asins a where a.work_id = w.id);
    insert into works (id, title, author, created_at, updated_at) values (${sqlStr(WORK)}, 'Die Tagebücher der Apothekerin', 'E2E 599', now(), now());
    insert into work_asins (id, work_id, asin, is_canonical, source, created_at) values
      (gen_random_uuid()::text, ${sqlStr(WORK)}, ${sqlStr(V1)}, true, 'dedup_auto', now()),
      (gen_random_uuid()::text, ${sqlStr(WORK)}, ${sqlStr(V2)}, false, 'dedup_auto', now()),
      (gen_random_uuid()::text, ${sqlStr(WORK)}, ${sqlStr(V3)}, false, 'dedup_auto', now());
    commit;`);
}

function worksState() {
  const rows = psql(`select asin || ':' || work_id from work_asins where asin in (${[V1, V2, V3].map(sqlStr).join(', ')}) order by asin`);
  const workOf = Object.fromEntries(rows.split('\n').filter(Boolean).map((l) => l.split(':')));
  const empty = Number(psql(`select count(*) from works w where not exists (select 1 from work_asins a where a.work_id = w.id)`));
  return { workOf, distinctWorks: new Set(Object.values(workOf)).size, empty };
}

function record(step: string, status: number, books?: Book[]) {
  samples.push({
    step,
    status,
    ...(books && {
      layout: books.some((b) => b.language || b.releaseDate) ? 'modern' : 'legacy',
      rows: books.length,
      labelled: books.filter((b) => b.seriesPart).length,
    }),
  });
}

/** A 404 here means the scrape failed; skip when audible.de answered 503, fail otherwise. The
 *  logger prints the error as JSON on the lines after "Failed to scrape", so look a few lines on */
function skipOn503(status: number) {
  if (status !== 404) return;
  const logs = stackLogsSync('rmab');
  test.skip(new RegExp(`Failed to scrape series detail ${SERIES}[^\\n]*(?:\\n[^\\n]*){0,3}503`).test(logs), 'audible.de answered 503 for the series page');
}

async function getSeries(rmab: Rmab, step: string): Promise<{ status: number; books?: Book[] }> {
  const res = await rmab.raw('GET', `/api/series/${SERIES}`);
  const body = res.ok ? await res.json() : undefined;
  record(step, res.status, body?.series?.books);
  return { status: res.status, books: body?.series?.books };
}

test.beforeAll(async () => {
  regionBefore = psql(`select coalesce((select value from configuration where key = 'audible.region'), '')`);
  psql(`insert into configuration (id, key, value, category, created_at, updated_at)
        values (gen_random_uuid()::text, 'audible.region', 'de', 'system', now(), now())
        on conflict (key) do update set value = 'de', updated_at = now()`);
  psql(`delete from plex_library where plex_guid = ${sqlStr(GUID)}`);
  psql(`insert into plex_library (id, plex_guid, title, author, narrator, duration, year, asin, file_path, plex_library_id, added_at, last_scanned_at, created_at, updated_at)
        values (gen_random_uuid()::text, ${sqlStr(GUID)}, 'Die Tagebücher der Apothekerin 1', 'E2E 599', 'E2E Narrator', 30000000, 2026,
                ${sqlStr(V1)}, '/media/audiobooks/e2e-599', ${sqlStr(activeLibraryId())}, now(), now(), now(), now())`);
  await new Promise((r) => setTimeout(r, CACHE_WAIT_MS));
});

test.afterAll(() => {
  if (!execBridgeAvailable()) return;
  writeEvidence('599/series-gets.json', samples);
  psql(`delete from plex_library where plex_guid = ${sqlStr(GUID)}`);
  if (regionBefore) psql(`update configuration set value = ${sqlStr(regionBefore)} where key = 'audible.region'`);
  else psql(`delete from configuration where key = 'audible.region'`);
});

test('#599: the series view heals a work that linked vols 1-3; vols 2/3 show and are not owned', async () => {
  test.setTimeout(240_000);
  seedStaleWork();
  const rmab = await Rmab.loginAdmin();

  const { status, books } = await getSeries(rmab, 'heal');
  skipOn503(status);
  expect(status, 'series GET').toBe(200);
  const asins = (books ?? []).map((b) => b.asin);
  for (const asin of VOLS) expect(asins.filter((a) => a === asin), `${asin} listed once`).toHaveLength(1);

  const byAsin = Object.fromEntries((books ?? []).map((b) => [b.asin, b]));
  expect(byAsin[V1].isAvailable, 'vol 1 available').toBe(true);
  expect(byAsin[V2].isAvailable, 'vol 2 not owned').toBe(false);
  expect(byAsin[V3].isAvailable, 'vol 3 not owned').toBe(false);

  const state = worksState();
  writeEvidence('599/after-heal.json', { books: books?.filter((b) => VOLS.includes(b.asin)), state });
  expect(state.workOf[V1], 'vol 1 stays in the seeded work').toBe(WORK);
  expect(state.distinctWorks, 'vols 1-3 in three works').toBe(3);
  expect(state.empty, 'no empty work').toBe(0);
});

test('#599: five concurrent views heal once, without errors or empty works', async () => {
  test.setTimeout(240_000);
  seedStaleWork();
  const rmab = await Rmab.loginAdmin();

  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => getSeries(rmab, `concurrent-${i}`)));
  results.forEach((r) => skipOn503(r.status));
  for (const r of results) expect(r.status, 'no 5xx').toBeLessThan(500);
  for (const r of results) expect(r.status).toBe(200);

  const state = worksState();
  writeEvidence('599/after-concurrent.json', { statuses: results.map((r) => r.status), state });
  expect(state.distinctWorks, 'vols 1-3 in three works').toBe(3);
  expect(state.empty, 'no empty work').toBe(0);
});

async function seriesShot(browser: Browser, name: string, view: { width: number; height: number; dark: boolean }) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: view.width, height: view.height },
    colorScheme: view.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  const base = new URL(process.env.E2E_BASE_URL!).host;
  await ctx.route((url) => url.host !== base, (route) =>
    new URL(route.request().url()).host === COVER_HOST
      ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#4a6b8a"/></svg>' })
      : route.abort());
  const page = await ctx.newPage();
  try {
    const seriesRes = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/series/${SERIES}`);
    await page.goto(`/series/${SERIES}`);
    const res = await seriesRes;
    const books: Book[] = (await res.json().catch(() => ({})))?.series?.books ?? [];
    record(`page-${name}`, res.status(), books);
    skipOn503(res.status());
    const vol2 = books.find((b) => b.asin === V2);
    expect(vol2, 'vol 2 in the page data').toBeTruthy();
    await expect(page.getByText(vol2!.title).first()).toBeVisible({ timeout: 30_000 });
    // The shot shows the book grid (vols 1-3 apart), not the series header
    await page.getByText('Books in Series').first().evaluate((el) => {
      el.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -80); // clear the sticky header
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));
    await snap(page, '599', name);
  } finally {
    await ctx.close();
  }
}

test('#599: the series page shows the volumes apart (1280 light, 375 dark)', async ({ browser }) => {
  test.setTimeout(180_000);
  await seriesShot(browser, 'series-1280-light', { width: 1280, height: 800, dark: false });
  await seriesShot(browser, 'series-375-dark', { width: 375, height: 812, dark: true });
});
