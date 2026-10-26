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
