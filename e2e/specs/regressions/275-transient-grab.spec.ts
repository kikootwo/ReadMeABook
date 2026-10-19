/**
 * Component: E2E regression #275 (transient grab failure must fall through to the next ranked release)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Scenario transient-grab-503: release A (ranked first) always answers HTTP 503 on its Prowlarr
 * grab URL; release B is healthy. Pre-fix code (a013e21) fails on A and never fetches B, so this
 * spec must fail at the "B fetched after A's 503" assertion and nowhere earlier.
 */

import { test, expect } from '@playwright/test';
import { snap, evidencePath, writeEvidence, waitFor, fakeArr, Rmab, type Recorded } from '../../lib/harness';

const releaseOf = (r: Recorded) => {
  try {
    return JSON.parse(Buffer.from(String(r.query.link), 'base64url').toString('utf8')).r as string;
  } catch {
    return undefined;
  }
};
test.use({ storageState: evidencePath('storage-state.json') });

const isGrab = (r: Recorded, id: string) => r.service === 'prowlarr' && /^\/\d+\/download$/.test(r.path) && releaseOf(r) === id;

test('#275: an HTTP 503 grab on the top release falls through to the next ranked release', async ({ page }) => {
  const loaded = await fakeArr.scenario('transient-grab-503');
  expect(loaded.releases).toEqual(['A', 'B']);
  const book = (await fakeArr.books()).martian;
  const rmab = await Rmab.loginAdmin();

  const created = await rmab.requestBook(book);
  writeEvidence('275/request-created.json', created);

  // 1. The top-ranked release A is grabbed first and gets the scenario's 503.
  const a503 = await waitFor('release A grab answered 503', async () => (await fakeArr.requests()).find((r) => isGrab(r, 'A') && r.status === 503), {
    timeoutMs: 240_000,
    intervalMs: 2_000,
  });

  // 2. THE regression assertion: B is fetched after A's 503 (pre-fix code never fetches B).
  let bGrab: Recorded | undefined;
  try {
    bGrab = await waitFor('release B fetched after A answered 503', async () => (await fakeArr.requests()).find((r) => isGrab(r, 'B') && r.seq > a503.seq), {
      timeoutMs: 120_000,
      intervalMs: 2_000,
    });
  } finally {
    writeEvidence('275/fake-arr-requests.json', await fakeArr.requests());
    writeEvidence('275/request-after-grab.json', await rmab.findRequest(book.asin).catch((e) => ({ error: String(e) })));
    await page.goto('/requests');
    await snap(page, '275', 'requests-after-grab');
  }
  expect(bGrab!.status).toBe(200);
  const aGrabs = (await fakeArr.requests()).filter((r) => isGrab(r, 'A'));
  expect(aGrabs.every((r) => r.seq < bGrab!.seq)).toBe(true);

  // 3. fake qBittorrent receives B's torrent (and never A's).
  const add = await waitFor('qBittorrent add of release B', async () => (await fakeArr.requests()).find((r) => r.service === 'qbit' && r.path === '/api/v2/torrents/add' && r.added?.some((a) => a.releaseId === 'B')), {
    timeoutMs: 60_000,
  });
  expect(add.added!.map((a) => a.releaseId)).toEqual(['B']);

  // 4. The request completes from release B.
  const done = await waitFor(
    'request downloaded/available',
    async () => {
      const r = await rmab.findRequest(book.asin);
      return r && ['downloaded', 'available'].includes(r.status) ? r : null;
    },
    { timeoutMs: 300_000, intervalMs: 3_000 }
  );
  writeEvidence('275/request-done.json', done);
  await page.goto('/requests');
  await snap(page, '275', 'requests-done');
});
