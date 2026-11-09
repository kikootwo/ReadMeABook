/**
 * Component: E2E regression #325a across an upgrade (a library cover cached before covers were named by ASIN)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * run.mjs --offline-fixtures --overrides abs-fake-metadata --upgrade-from 1.2.13 --upgrade-specs 284-cover-legacy
 * runs this file on the release image (E2E_PHASE=upgrade-seed), then on the branch image on the same
 * volumes (upgrade-verify). Every title is made up; covers are generated images uploaded to ABS.
 *   seed:   martian X (B082BHJMFF) delivered for real; real ABS scan, rematch to X + cover A; one
 *           plex_library_scan links it (`available`) and caches A under a legacy `<hash>.jpg` name.
 *           Then a real ABS rematch to artemis Y (B072R1CY4P) + cover B and one more scan: the row's
 *           ASIN is now Y while the file still holds A (the release image never fetches it again).
 *   verify: one plex_library_scan: library_asin Y; the card (API and page) shows cover B or none,
 *           never A; the legacy file is gone. Screenshots of the upgraded card (1280 light, 375 dark).
 * Schedules stay off across the upgrade (turned back on at the end of verify). Values read first,
 * then expect.soft. Not named *upgrade.spec.ts (the stock run's filter is a path regex).
 */

import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { Abs, authState, ctl, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, urls, waitFor, writeEvidence } from '../../lib/harness';
import { dbNow, markJobs, MEDIA, psql, sh, sqlStr, waitOrganized } from './242-helpers';
import { absItem, disableSchedules, FAKE_PROXY, fixtureBooks, printenv, rmabCover, SCAN_TYPES, SCHEDULES, session, waitStartupSettled } from './284-helpers';

const phase = process.env.E2E_PHASE;
const DIR = '284-cover-legacy';
const LEGACY = /^\/app\/cache\/library\/[0-9a-f]{16}\.jpg$/;

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(phase !== 'upgrade-seed' && phase !== 'upgrade-verify', '284-cover-legacy only runs via run.mjs --upgrade-from --upgrade-specs');

type Seeded = { requestId: string; itemId: string; legacyPath: string; coverA: string; coverB: string };

/** psql trims, so multi-column reads join with '|'. */
const rowOf = (requestId: string) => {
  const [status, absItemId, libraryAsin, audibleAsin, plexAsin, coverPath] = psql(
    `select concat_ws('|', r.status, coalesce(a.abs_item_id,''), ${phase === 'upgrade-verify' ? `coalesce(a.library_asin,'')` : `''`}, coalesce(a.audible_asin,''), coalesce(p.asin,''), coalesce(p.cached_library_cover_path,'')) from requests r join audiobooks a on a.id = r.audiobook_id left join plex_library p on p.plex_guid = a.abs_item_id where r.id = ${sqlStr(requestId)}`
  ).split('|');
  return { status, absItemId, libraryAsin, audibleAsin, plexAsin, coverPath };
};

async function oneScan(rmab: Rmab, requestId: string, label: string) {
  const t0 = dbNow();
  await rmab.triggerScheduledJob('plex_library_scan');
  const status = await waitFor(`scan ${label}`, async () => {
    const s = psql(`select status from jobs where type in ${SCAN_TYPES} and created_at > ${sqlStr(t0)}::timestamp order by created_at desc limit 1`);
    return s === 'completed' || s === 'failed' ? s : null;
  }, { timeoutMs: 300_000, intervalMs: 2_000 });
  const row = rowOf(requestId);
  writeEvidence(`${DIR}/scan-${label}.json`, { status, row });
  expect.soft(status, `scan ${label}`).toBe('completed');
  return row;
}

const cacheUrl = (p: string) => `/api/cache/library/${p.split('/').pop()}`;

test('284 upgrade-seed: the release image caches cover A under a legacy name, then ABS moves the item to Y with cover B', async ({ browser }) => {
  test.skip(phase !== 'upgrade-seed');
  test.setTimeout(1_200_000);
  for (const service of ['abs', 'rmab']) expect(printenv(service, 'HTTPS_PROXY'), `${service} must run with --overrides abs-fake-metadata`).toBe(FAKE_PROXY);
  const { martian, artemis } = fixtureBooks();
  expect([martian.asin, artemis.asin]).toEqual(['B082BHJMFF', 'B072R1CY4P']);
  expect(martian.title, 'run with --offline-fixtures').toMatch(/^Fixture Book /);
  fs.mkdirSync(evidencePath(DIR), { recursive: true });

  const rmab = await Rmab.loginAdmin();
  await disableSchedules(rmab, []); // off across the upgrade; verify turns them back on
  await waitStartupSettled();

  // Deliver martian (X) for real up to `downloaded`.
  const def = {
    name: 'cover-legacy-325a', description: 'One mp3 torrent for book martian (generated tones).', book: 'martian',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [{ id: 'good', title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]', sizeMB: 420, seeders: 60, fixture: 'martian-mp3' }],
  };
  expect((await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) })).status).toBe(200);
  const idx = await rmab.get<{ indexers: unknown[]; flagConfigs: unknown[] }>('/api/admin/settings/prowlarr/indexers');
  expect((await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers: idx.indexers, flagConfigs: idx.flagConfigs })).ok).toBe(true);
  const since = markJobs();
  const requestId = (await rmab.requestBook((await fakeArr.books()).martian)).request.id;
  await waitFor('request downloaded', async () => ['downloaded', 'available', 'failed'].includes(psql(`select status from requests where id = ${sqlStr(requestId)}`)), { timeoutMs: 420_000, intervalMs: 3_000 });
  await waitOrganized(since, requestId);
  const filePath = psql(`select a.file_path from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(requestId)}`);
  expect(filePath.startsWith(`${MEDIA}/`), `precondition: delivered (${filePath})`).toBe(true);

  // Real ABS scan adds the folder; the item holds X with cover A.
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  expect((await fetch(`${urls.abs()}/api/libraries/${libraryId}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${abs.token}` } })).ok).toBe(true);
  const rel = filePath.slice(MEDIA.length + 1);
  const item = await waitFor('ABS item for RMAB folder', async () =>
    (await abs.libraryItems(libraryId)).find((i) => String(i.relPath || '').replace(/\/+$/, '') === rel) || null, { timeoutMs: 180_000, intervalMs: 2_000 });
  const { rematch, setCover } = absItem(browser, abs, item.id);
  await rematch(martian.asin);
  const coverA = await setCover('#b4235a', 'A');

  // The release image links the request and caches A under a legacy name.
  const s1 = await oneScan(rmab, requestId, 'seed-1-martian');
  const cachedA = await rmabCover(s1.coverPath ? cacheUrl(s1.coverPath) : null);

  // ABS moves the item to Y with cover B; the release image's next scan rewrites the row's ASIN, keeps A.
  await rematch(artemis.asin);
  const coverB = await setCover('#1d4ed8', 'B');
  const s2 = await oneScan(rmab, requestId, 'seed-2-artemis');
  const cachedAfter = await rmabCover(s2.coverPath ? cacheUrl(s2.coverPath) : null);
  const listed = (await rmab.get<{ requests: { id: string; audiobook: Record<string, unknown> }[] }>('/api/requests?limit=100')).requests.find((r) => r.id === requestId)?.audiobook ?? {};
  const seeded: Seeded = { requestId, itemId: item.id, legacyPath: s2.coverPath, coverA, coverB };
  writeEvidence(`${DIR}/seed.json`, { seeded, s1, s2, cachedA, cachedAfter, listed });

  expect.soft(s1, 'seed scan 1: linked').toMatchObject({ status: 'available', absItemId: item.id, audibleAsin: martian.asin, plexAsin: martian.asin });
  expect.soft(s1.coverPath, 'seed scan 1: a legacy cover name').toMatch(LEGACY);
  expect.soft(cachedA, 'seed scan 1: the cached file holds A').toMatchObject({ status: 200, sha: coverA });
  expect.soft(coverB, 'precondition: covers A and B differ').not.toBe(coverA);
  expect.soft(s2, 'seed scan 2: the row now holds Y, same file').toMatchObject({ status: 'available', plexAsin: artemis.asin, coverPath: s1.coverPath });
  expect(cachedAfter, 'seed scan 2: the file still holds A (the state the upgrade meets)').toMatchObject({ status: 200, sha: coverA });
});

test('284 upgrade-verify: after the upgrade the card shows cover B or none, never A', async ({ browser }) => {
  test.skip(phase !== 'upgrade-verify');
  test.setTimeout(900_000);
  const { martian, artemis } = fixtureBooks();
  const seeded = JSON.parse(fs.readFileSync(evidencePath(DIR, 'seed.json'), 'utf8')).seeded as Seeded;
  const { requestId, legacyPath, coverA, coverB } = seeded;
  const rmab = await Rmab.loginAdmin();
  await waitStartupSettled();
  const before = rowOf(requestId);

  const s = await oneScan(rmab, requestId, 'verify-1');
  const listed = (await rmab.get<{ requests: { id: string; audiobook: Record<string, unknown> }[] }>('/api/requests?limit=100')).requests.find((r) => r.id === requestId)?.audiobook ?? {};
  const detail = (await rmab.get<{ request: { audiobook: Record<string, unknown> } }>(`/api/requests/${requestId}`)).request.audiobook;
  const shown = await rmabCover(listed.coverArtUrl);
  const legacyServed = await rmabCover(cacheUrl(legacyPath));
  const cacheFiles = sh('ls -1 /app/cache/library').split('\n').filter(Boolean);
  const legacyName = legacyPath.split('/').pop()!;

  // The page: no <img> on the card points at the legacy file.
  const imgSrcs: Record<string, string[]> = {};
  for (const [name, width, height, dark] of [['card-1280-light', 1280, 900, false], ['card-375-dark', 375, 812, true]] as const) {
    const { ctx, page, settled } = await session(browser, width, height, dark);
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: artemis.title }).first()).toBeVisible({ timeout: 30_000 });
    await settled(DIR, name);
    imgSrcs[name] = await page.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src));
    await ctx.close();
  }
  writeEvidence(`${DIR}/verify.json`, { before, s, listed, detail, shown, legacyServed, cacheFiles, imgSrcs, coverA, coverB });

  // Turn the schedules back on for later specs in the stack.
  const { jobs } = await rmab.get<{ jobs: { id: string; type: string }[] }>('/api/admin/jobs');
  for (const job of jobs.filter((j) => SCHEDULES.includes(j.type))) await rmab.raw('PUT', `/api/admin/jobs/${job.id}`, { enabled: true });

  expect.soft(s, 'verify scan: followed').toMatchObject({ status: 'available', libraryAsin: artemis.asin, audibleAsin: martian.asin, plexAsin: artemis.asin });
  expect.soft(listed, 'GET /api/requests: the library edition').toMatchObject({ audibleAsin: martian.asin, libraryAsin: artemis.asin, title: artemis.title });
  expect.soft(detail.coverArtUrl, 'GET /api/requests/:id: the same cover').toBe(listed.coverArtUrl ?? null);
  expect(shown.sha, 'the card never serves cover A').not.toBe(coverA);
  expect.soft(String(listed.coverArtUrl), 'the cover was fetched again under Y\'s name').toMatch(new RegExp(`^/api/cache/library/[0-9a-f]{16}-${artemis.asin}\\.jpg$`));
  expect.soft(shown, 'the card serves cover B').toMatchObject({ status: 200, sha: coverB });
  expect.soft(legacyServed.status, 'the legacy file is gone').toBe(404);
  expect.soft(cacheFiles, 'the legacy file is gone from the cache').not.toContain(legacyName);
  for (const [name, srcs] of Object.entries(imgSrcs)) {
    expect.soft(srcs.filter((src) => decodeURIComponent(src).includes(legacyName)), `${name}: no image from the legacy file`).toEqual([]);
  }
});
