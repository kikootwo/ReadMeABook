/**
 * Component: E2E upgrade spec (last release seeded on fresh volumes → branch image on the same volumes)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * run.mjs --upgrade-from <tag> runs this file twice: E2E_PHASE=upgrade-seed on the release image,
 * then E2E_PHASE=upgrade-verify on the branch image. Both phases use image-generated secrets that
 * persist in the config volume (the real upgrade path). Exact per-table row counts are taken by
 * run.mjs on the host (docker exec psql) after each phase; this spec covers the app-level checks.
 */

import { test, expect } from '@playwright/test';
import { env, writeEvidence, waitFor, fakeArr, snap, urls, loginAdminUi, Rmab, execBridgeAvailable, EXEC_BRIDGE_SKIP } from '../lib/harness';
import { psql, sqlStr } from './regressions/242-helpers';

const phase = process.env.E2E_PHASE;

// #302: watches made on the release image must read as entire catalog after the upgrade
const WATCH = { authorAsin: 'B0E2EUPGAU', authorName: 'Pellam Ostrowyne', seriesAsin: 'B0E2EUPGSE', seriesTitle: 'The Lanternwick Papers (E2E)' };

test.skip(phase !== 'upgrade-seed' && phase !== 'upgrade-verify', 'upgrade spec only runs via run.mjs --upgrade-from');

test('upgrade-seed: seed requests on the release image', async () => {
  test.skip(phase !== 'upgrade-seed');
  const rmab = await Rmab.loginAdmin();
  const books = await fakeArr.books();
  await fakeArr.scenario('preview');
  for (const key of ['phm', 'martian', 'artemis']) await rmab.requestBook(books[key]);
  const status = async (key: string) => (await rmab.findRequest(books[key].asin))?.status;
  await waitFor('phm downloaded or available', async () => ['downloaded', 'available'].includes(await status('phm')), { timeoutMs: 300_000, intervalMs: 3_000 });
  await waitFor('martian downloading', async () => (await status('martian')) === 'downloading', { timeoutMs: 180_000, intervalMs: 3_000 });
  await waitFor('artemis failed', async () => (await status('artemis')) === 'failed', { timeoutMs: 300_000, intervalMs: 3_000 });
  const requests = await rmab.get<{ requests: any[] }>('/api/requests?limit=100');
  expect(requests.requests.length).toBe(3);
  await rmab.post('/api/user/watched-authors', { authorAsin: WATCH.authorAsin, authorName: WATCH.authorName });
  await rmab.post('/api/user/watched-series', { seriesAsin: WATCH.seriesAsin, seriesTitle: WATCH.seriesTitle });
  writeEvidence('upgrade/before.json', {
    statuses: Object.fromEntries(requests.requests.map((r) => [r.audiobook?.audibleAsin, r.status])),
    health: await (await fetch(`${urls.rmab()}/api/health`)).json().catch(() => null),
  });
});

test('upgrade-verify: branch image keeps requests, logins and decryptable secrets', async ({ page }) => {
  test.skip(phase !== 'upgrade-verify');
  const before = JSON.parse(env('E2E_UPGRADE_BEFORE'));
  expect((await fetch(`${urls.rmab()}/api/health`)).ok).toBe(true);

  // Admin login still works (password hash + JWT secrets carried over in the config volume).
  const rmab = await Rmab.loginAdmin();

  // Statuses that cannot move on their own survived the upgrade.
  const requests = await rmab.get<{ requests: any[] }>('/api/requests?limit=100');
  expect(requests.requests.length).toBe(Object.keys(before.statuses).length);
  for (const r of requests.requests) {
    const was = before.statuses[r.audiobook?.audibleAsin];
    if (was === 'failed' || was === 'available') expect.soft(r.status, `status of ${r.audiobook?.title}`).toBe(was);
  }

  // Encrypted settings still decrypt: an interactive search needs the stored Prowlarr key, and
  // fake Prowlarr only answers 200 for the exact canary value.
  await fakeArr.scenario('preview');
  const since = (await fakeArr.requests()).at(-1)?.seq ?? 0;
  const failed = requests.requests.find((r) => r.status === 'failed');
  expect(failed, 'a failed request to search for').toBeTruthy();

  // The startup schema sync added requests.auto_rerequest_count (NOT NULL DEFAULT 0) and the
  // failed row seeded on the release image reads 0.
  if (execBridgeAvailable()) {
    const column = psql("select count(*) from information_schema.columns where table_name = 'requests' and column_name = 'auto_rerequest_count'");
    const count = psql(`select auto_rerequest_count from requests where id = ${sqlStr(failed.id)}`);
    writeEvidence('upgrade/auto-rerequest-count.json', { column, failedRequestId: failed.id, count });
    expect(column, 'requests.auto_rerequest_count exists').toBe('1');
    expect(count, 'the seeded failed row reads 0').toBe('0');
  } else {
    test.info().annotations.push({ type: 'skipped-check', description: `auto_rerequest_count: ${EXEC_BRIDGE_SKIP}` });
  }
  // #302: startup schema sync added new_releases_since (nullable) to both watch tables; the
  // watches seeded on the release image read null = entire catalog
  type Watch = { authorAsin?: string; seriesAsin?: string; newReleasesOnly?: boolean; newReleasesSince?: string | null };
  const authors = await rmab.get<{ authors: Watch[] }>('/api/user/watched-authors');
  const series = await rmab.get<{ series: Watch[] }>('/api/user/watched-series');
  const watchedAuthor = authors.authors.find((a) => a.authorAsin === WATCH.authorAsin);
  const watchedSeries = series.series.find((s) => s.seriesAsin === WATCH.seriesAsin);
  expect(watchedAuthor, 'seeded watched author kept').toMatchObject({ newReleasesOnly: false, newReleasesSince: null });
  expect(watchedSeries, 'seeded watched series kept').toMatchObject({ newReleasesOnly: false, newReleasesSince: null });
  if (execBridgeAvailable()) {
    const columns = psql("select table_name || '.' || is_nullable from information_schema.columns where column_name = 'new_releases_since' and table_name in ('watched_authors', 'watched_series') order by table_name");
    const values = psql(`select (select count(*) from watched_authors where author_asin = ${sqlStr(WATCH.authorAsin)} and new_releases_since is null), (select count(*) from watched_series where series_asin = ${sqlStr(WATCH.seriesAsin)} and new_releases_since is null)`);
    writeEvidence('upgrade/302-watch-columns.json', { columns, nullSeededRows: values, watchedAuthor, watchedSeries });
    expect(columns.split(/\s+/), 'new_releases_since exists, nullable, on both tables').toEqual(['watched_authors.YES', 'watched_series.YES']);
    expect(values.split(/\s+/), 'seeded watches read null').toEqual(['1', '1']);
  } else {
    test.info().annotations.push({ type: 'skipped-check', description: `new_releases_since: ${EXEC_BRIDGE_SKIP}` });
  }

  const search = await rmab.post<any>(`/api/requests/${failed.id}/interactive-search`, {});
  writeEvidence('upgrade/interactive-search.json', search);
  const searches = (await fakeArr.requests(since)).filter((r) => r.service === 'prowlarr' && r.path === '/api/v1/search');
  expect(searches.length).toBeGreaterThan(0);
  expect(searches.every((r) => r.headers['x-api-key'] === env('PROWLARR_API_KEY') && r.status === 200)).toBe(true);

  // UI login in either backend mode (Plex mode: through the "Admin Login" toggle).
  await loginAdminUi(page);
  await page.goto('/requests');
  await snap(page, 'upgrade', 'requests-after-upgrade');
});
