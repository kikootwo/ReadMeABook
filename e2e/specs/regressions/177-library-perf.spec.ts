/**
 * Component: E2E #177 Library API performance at the design's load under a 2-CPU cap
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with `--overrides cpu-cap` (rmab limited to 2 CPUs; Postgres runs in it too). Schedules off
 * and RMAB's boot burst waited out, so no real scan removes the seeded rows; the recently-added
 * check's writes are made by the spec instead. psql seeds 10k `plex_library` rows with real id
 * shapes plus 2k audiobook requests. The budgeted case, 60 s open loop at 10k: 5 `?live=1` pollers
 * every 5 s, one full load every 2 s (first pages, sorts, a status filter, a search, author groups,
 * a cursor page), one burst of 10 full loads (5 viewers x 2 pages) at 30 s; during it the
 * recently-added touch of the 10 newest rows every 10 s, a progress tick on downloading requests
 * every 5 s and one new library row at 40 s. Event-loop lag: a static file (no database call)
 * every 50 ms, excess over its idle median; `/api/health` every 200 ms against its idle p95.
 * Budgets (soft): full p95 < 300 ms, live p95 < 50 ms, lag p99 < 100 ms, health p95 <= idle p95 +
 * 25 ms, no failed call. Calibration only (no budget): the cold first load, the same window at 30k
 * rows, and a closed-loop stress case at 10k. Evidence: `177-perf/result.json`.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, stackExecSync, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { disableSchedules, waitStartupSettled } from './284-helpers';
import { activeLibraryId, percentile, registerUser, timedGet } from './177-library-helpers';
import { every, loop, probe, psqlAsync, record, sampled, seedLibrary, seedRequests, sleep, stats, type Sampled } from './177-perf-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const WINDOW_MS = 60_000;
const STRESS_MS = 30_000;
const LAG_PROBE = '/file.svg';
const BUDGET = { fullP95: 300, liveP95: 50, lagP99: 100, healthMarginMs: 25 };

interface Viewer { name: string; token: string }

/** The full-mode queries a household's tabs make, rotated through the window. */
function fullQueries(cursor: string): string[] {
  return [
    '/api/library?limit=60',
    '/api/library?limit=60&sort=title',
    '/api/library?limit=60&status=on_the_way,problem',
    '/api/library?limit=60&q=perf%20author%2012',
    '/api/library?limit=60&group=author',
    `/api/library?limit=60&cursor=${encodeURIComponent(cursor)}`,
  ];
}

async function idleBaseline(admin: Rmab) {
  const lag: number[] = [];
  const health: number[] = [];
  const full: number[] = [];
  const live: number[] = [];
  for (let i = 0; i < 40; i++) {
    lag.push(await probe(LAG_PROBE));
    await sleep(50);
  }
  for (let i = 0; i < 40; i++) health.push((await timedGet(admin.token, '/api/health')).ms);
  for (let i = 0; i < 10; i++) full.push((await timedGet(admin.token, '/api/library?limit=60')).ms);
  for (let i = 0; i < 20; i++) live.push((await timedGet(admin.token, '/api/library?live=1')).ms);
  return { lag, health, full, live };
}

/** The design's load for WINDOW_MS, with the background writes a default install makes. */
async function realisticWindow(viewers: Viewer[], libraryId: string, cursor: string) {
  const startedAt = Date.now();
  const stopAt = startedAt + WINDOW_MS;
  const live = sampled();
  const full = sampled();
  const burst = sampled();
  const health = sampled();
  const lag: number[] = [];
  const writes: string[] = [];
  const queries = fullQueries(cursor);
  const write = (label: string, sql: string) =>
    psqlAsync(sql).then(() => void writes.push(`${Date.now() - startedAt}ms ${label}`), (e) => void writes.push(`${label} FAILED ${e.message}`));
  const lib = sqlStr(libraryId);

  await Promise.all([
    // 5 live pollers at refreshMs (5 s), starts spread over the first 5 s
    ...viewers.slice(0, 5).map((v, i) => every(stopAt, 5_000, i * 1_000, () => record(v.token, '/api/library?live=1', live))),
    // one full load every 2 s, rotating queries and viewers
    every(stopAt, 2_000, 500, (i) => record(viewers[i % viewers.length].token, queries[i % queries.length], full)),
    // the settle burst: 5 tabs revalidate their 2 loaded pages at once
    (async () => {
      await sleep(30_000);
      await Promise.all(viewers.slice(0, 5).flatMap((v) => [
        record(v.token, '/api/library?limit=60', burst),
        record(v.token, `/api/library?limit=60&cursor=${encodeURIComponent(cursor)}`, burst),
      ]));
    })(),
    every(stopAt, 50, 0, async () => void lag.push(await probe(LAG_PROBE))),
    every(stopAt, 200, 25, () => record(viewers[0].token, '/api/health', health)),
    // recently-added check: stamps its 10 newest rows every run, values unchanged (every 10 s here, 5 min by default)
    every(stopAt, 10_000, 5_000, () => write('recently-added touch', `update plex_library set last_scanned_at = now(), updated_at = now()
      where id in (select id from plex_library where plex_library_id = ${lib} order by added_at desc nulls last limit 10)`)),
    // downloads move: progress ticks on the downloading requests
    every(stopAt, 5_000, 2_500, () => write('progress tick', `update requests set progress = least(progress + 1, 99), updated_at = now()
      where type = 'audiobook' and status = 'downloading' and deleted_at is null`)),
    // a scan finds one new book: one real rebuild under load
    (async () => {
      await sleep(40_000);
      await write('new library row', `insert into plex_library (id, plex_guid, title, author, plex_library_id, added_at, last_scanned_at, created_at, updated_at)
        values (gen_random_uuid(), 'li_e2e177perfnew' || floor(random() * 1e9)::text, 'Perf Book New', 'Perf Author New', ${lib}, now(), now(), now(), now())`);
    })(),
  ]);
  const all: Sampled = { ms: [...full.ms, ...burst.ms], errors: [...full.errors, ...burst.errors] };
  return { live, full, burst, all, health, lag, writes };
}

async function stressWindow(admin: Viewer, user: Viewer) {
  const stopAt = Date.now() + STRESS_MS;
  const live = sampled();
  const full = sampled();
  await Promise.all([
    ...[admin, user, admin, user].map((v) => loop(stopAt, () => record(v.token, '/api/library?live=1', live))),
    loop(stopAt, () => record(admin.token, '/api/library?limit=60', full)),
    loop(stopAt, () => record(user.token, '/api/library?limit=60&sort=title', full)),
  ]);
  return { live: stats(live.ms), full: stats(full.ms), errors: [...live.errors, ...full.errors].slice(0, 10) };
}

function summarize(idle: Awaited<ReturnType<typeof idleBaseline>>, w: Awaited<ReturnType<typeof realisticWindow>>) {
  const lagIdleMedian = percentile(idle.lag, 50);
  return {
    idle: { lagProbe: stats(idle.lag), health: stats(idle.health), full: stats(idle.full), live: stats(idle.live) },
    loaded: {
      full: stats(w.all.ms),
      fullSteady: stats(w.full.ms),
      fullBurst: stats(w.burst.ms),
      live: stats(w.live.ms),
      health: stats(w.health.ms),
      lagProbe: stats(w.lag),
    },
    lagP99Ms: Math.round(percentile(w.lag, 99) - lagIdleMedian),
    healthP95OverIdleMs: Math.round(percentile(w.health.ms, 95) - percentile(idle.health, 95)),
    errors: [...w.all.errors, ...w.live.errors, ...w.health.errors].slice(0, 10),
    writes: w.writes,
  };
}

test('#177: Library full and live modes at the design load (10k rows, 2 CPUs), 30k and stress as calibration', async () => {
  test.setTimeout(25 * 60_000);
  const admin = await Rmab.loginAdmin();
  const disabled: string[] = [];
  try {
    await disableSchedules(admin, disabled);
    await waitStartupSettled();

    const libraryId = activeLibraryId();
    const cpus = stackExecSync('rmab', ['sh', '-c', 'cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo unknown']).trim();
    const users: { id: string; rmab: Rmab }[] = [];
    for (let i = 0; i < 4; i++) users.push(await registerUser(admin, `perf177u${i}`, `e2e-perf177-pass-${i}`));
    const viewers: Viewer[] = [{ name: 'admin', token: admin.token }, ...users.map((u, i) => ({ name: `user${i}`, token: u.rmab.token }))];
    const adminId = psql(`select id from users where role = 'admin' order by created_at limit 1`);

    seedLibrary(libraryId, 1, 10_000);
    seedRequests([adminId, ...users.map((u) => u.id)]);
    psql('analyze plex_library; analyze requests; analyze audiobooks;');
    const rowCount = () => Number(psql(`select count(*) from plex_library where plex_library_id = ${sqlStr(libraryId)}`));
    const seeded = rowCount();
    const guidWindows = Number(psql(`select count(*) from plex_library where plex_library_id = ${sqlStr(libraryId)} and plex_guid ~ '[A-Za-z0-9]{10}'`));

    const result: Record<string, unknown> = { cpuMax: cpus, budget: BUDGET, windowMs: WINDOW_MS, guidRowsWithAsinWindows: guidWindows };

    // 10k: cold first load (calibration), idle baseline, the budgeted window, then the stress case
    const cold = await timedGet(admin.token, '/api/library?limit=60');
    const cursor = cold.body?.nextCursor as string;
    const idle10 = await idleBaseline(admin);
    const window10 = await realisticWindow(viewers, libraryId, cursor);
    result.rows10000 = {
      // seeded before the window; the window adds one library row at 40 s
      counts: { libraryRows: seeded, afterWindow: rowCount(), total: cold.body?.stats?.total },
      coldFirstMs: Math.round(cold.ms),
      ...summarize(idle10, window10),
      stress: await stressWindow(viewers[0], viewers[1]),
    };

    // 30k (calibration): the first call after growing serves the previous rows; time until the new rows show
    seedLibrary(libraryId, 10_001, 30_000);
    psql('analyze plex_library;');
    const grownAt = performance.now();
    const firstAfterGrow = await timedGet(admin.token, '/api/library?limit=60');
    let visibleMs = NaN;
    for (let i = 0; i < 60; i++) {
      const r = await timedGet(admin.token, '/api/library?limit=60');
      if ((r.body?.stats?.total ?? 0) >= 30_000) {
        visibleMs = Math.round(performance.now() - grownAt);
        break;
      }
      await sleep(250);
    }
    const idle30 = await idleBaseline(admin);
    const window30 = await realisticWindow(viewers, libraryId, cursor);
    result.rows30000 = {
      counts: { libraryRows: rowCount() },
      firstCallAfterGrowMs: Math.round(firstAfterGrow.ms),
      newRowsVisibleAfterMs: visibleMs,
      ...summarize(idle30, window30),
    };
    writeEvidence('177-perf/result.json', result);

    const r = result.rows10000 as ReturnType<typeof summarize> & { counts: { libraryRows: number; afterWindow: number; total: number } };
    expect.soft(r.counts.libraryRows, '10k rows seeded').toBe(10_000);
    expect.soft(r.counts.afterWindow, 'the window inserted one library row').toBe(10_001);
    expect.soft(r.counts.total, 'entries: library rows + 1000 request-only books').toBe(11_000);
    expect.soft(guidWindows, 'guid index populated by real id shapes').toBeGreaterThan(9_000);
    expect.soft(r.errors, 'no failed call in the window').toEqual([]);
    expect.soft(r.writes.filter((w) => w.includes('FAILED')), 'background writes ran').toEqual([]);
    expect.soft(r.loaded.full.p95, 'full p95 under the design load (ms)').toBeLessThan(BUDGET.fullP95);
    expect.soft(r.loaded.live.p95, 'live p95 under the design load (ms)').toBeLessThan(BUDGET.liveP95);
    expect.soft(r.lagP99Ms, 'event-loop lag p99, static probe (ms)').toBeLessThan(BUDGET.lagP99);
    expect.soft(r.healthP95OverIdleMs, '/api/health p95 over its idle p95 (ms)').toBeLessThanOrEqual(BUDGET.healthMarginMs);
  } finally {
    for (const id of disabled) await admin.raw('PUT', `/api/admin/jobs/${id}`, { enabled: true });
    psql(`begin;
      delete from requests where audiobook_id in (select id from audiobooks where audible_asin like 'B0P%' or audible_asin like 'B0Q%');
      delete from audiobooks where audible_asin like 'B0P%' or audible_asin like 'B0Q%';
      delete from plex_library where title like 'Perf Book %';
      commit;`);
  }
});
