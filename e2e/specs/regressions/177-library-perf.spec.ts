/**
 * Component: E2E #177 Library API performance under a CPU cap (full mode vs live mode)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with `--overrides cpu-cap` (rmab container limited to 2 CPUs; Postgres runs in it too).
 * Schedules off (library scan, recently added, Audible refresh) and RMAB's boot burst waited out, so
 * no scan removes the seeded rows. psql seeds 10k `plex_library` rows in the active library plus 2k
 * audiobook requests (half on library books, statuses spread, 5% live), then grows the library to
 * 30k. Per size: an idle `/api/health` baseline, then a loaded window with 4 back-to-back `?live=1`
 * pollers, 2 back-to-back full first-page loads (admin and a user) and a `/api/health` sampler every
 * 50 ms from the runner (out of process). Reports p50/p95/p99 per mode and the health latency vs its
 * idle baseline (event-loop lag proxy) in `177-perf/result.json`. Budgets are soft checks.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, stackExecSync, writeEvidence } from '../../lib/harness';
import { psql } from './242-helpers';
import { disableSchedules, waitStartupSettled } from './284-helpers';
import { activeLibraryId, percentile, registerUser, timedGet } from './177-library-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const LOAD_MS = 30_000;
const BUDGET = { fullP95: 300, liveP95: 50, healthRatio: 1.5, lagP99: 100 };

function seedLibrary(libraryId: string, from: number, to: number) {
  psql(
    `insert into plex_library (id, plex_guid, title, author, narrator, duration, year, asin, plex_library_id, added_at, last_scanned_at, created_at, updated_at)
     select gen_random_uuid(), 'e2e-177-perf-' || g, 'Perf Book ' || g, 'Perf Author ' || (g % 700), 'Perf Narrator', 36000000, 1950 + (g % 70),
            'B0P' || lpad(g::text, 7, '0'), ${`'${libraryId.replace(/'/g, "''")}'`}, now() - (g || ' minutes')::interval, now(), now(), now()
     from generate_series(${from}, ${to}) g`
  );
}

function seedRequests(userIds: string[]) {
  const ids = `array[${userIds.map((id) => `'${id}'`).join(',')}]::text[]`;
  psql(
    `begin;
     insert into audiobooks (id, audible_asin, title, author, status, created_at, updated_at)
     select gen_random_uuid(), case when g <= 1000 then 'B0P' || lpad(g::text, 7, '0') else 'B0Q' || lpad(g::text, 7, '0') end,
            'Requested Perf Book ' || g, 'Perf Author ' || (g % 700), 'requested', now(), now()
     from generate_series(1, 2000) g;
     insert into requests (id, user_id, audiobook_id, type, status, progress, created_at, updated_at)
     select gen_random_uuid(), (${ids})[1 + (row_number() over () % ${userIds.length})], a.id, 'audiobook',
            (array['available','downloading','failed','awaiting_approval','denied','pending','downloaded','awaiting_release','available','available','searching','warn','available','available','awaiting_search','available','available','available','available','processing'])[1 + (row_number() over () % 20)],
            (row_number() over () % 100), now() - (row_number() over () || ' seconds')::interval, now()
     from audiobooks a where a.audible_asin like 'B0P%' or a.audible_asin like 'B0Q%';
     commit;`
  );
}

async function sample(token: string, path: string, n: number) {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) ms.push((await timedGet(token, path)).ms);
  return ms;
}

async function loadedWindow(admin: Rmab, user: Rmab) {
  const stopAt = Date.now() + LOAD_MS;
  const live: number[] = [];
  const full: number[] = [];
  const health: number[] = [];
  const errors: string[] = [];
  const loop = async (token: string, path: string, into: number[], gapMs: number) => {
    while (Date.now() < stopAt) {
      const r = await timedGet(token, path);
      if (r.status !== 200) errors.push(`${path} ${r.status}`);
      into.push(r.ms);
      if (gapMs) await new Promise((res) => setTimeout(res, gapMs));
    }
  };
  await Promise.all([
    ...[admin, user, admin, user].map((v) => loop(v.token, '/api/library?live=1', live, 0)),
    loop(admin.token, '/api/library?limit=60', full, 0),
    loop(user.token, '/api/library?limit=60&sort=title', full, 0),
    loop(admin.token, '/api/health', health, 50),
  ]);
  return { live, full, health, errors };
}

const stats = (ms: number[]) => ({ n: ms.length, p50: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)), p99: Math.round(percentile(ms, 99)) });

test('#177: Library full and live modes at 10k and 30k library rows under a 2-CPU cap', async () => {
  test.setTimeout(20 * 60_000);
  const admin = await Rmab.loginAdmin();
  const disabled: string[] = [];
  await disableSchedules(admin, disabled);
  await waitStartupSettled();

  const libraryId = activeLibraryId();
  // cgroup v2 first, then v1; the host-side `docker inspect` NanoCpus is the authority (harness log).
  const cpus = stackExecSync('rmab', [
    'sh',
    '-c',
    'cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo "v1 $(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null) $(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null)" || echo unknown',
  ]).trim();
  const users: { id: string; rmab: Rmab }[] = [];
  for (let i = 0; i < 4; i++) users.push(await registerUser(admin, `perf177u${i}`, `e2e-perf177-pass-${i}`));
  const user = users[0].rmab;

  seedLibrary(libraryId, 1, 10_000);
  seedRequests([psql(`select id from users where role = 'admin' order by created_at limit 1`), ...users.map((u) => u.id)]);
  psql('analyze plex_library; analyze requests; analyze audiobooks;');

  const result: Record<string, unknown> = { cpuMax: cpus, budget: BUDGET };
  for (const size of [10_000, 30_000]) {
    if (size === 30_000) {
      seedLibrary(libraryId, 10_001, 30_000);
      psql('analyze plex_library;');
    }
    const first = await timedGet(admin.token, '/api/library?limit=60');
    const counts = { libraryRows: Number(psql(`select count(*) from plex_library where plex_library_id = '${libraryId.replace(/'/g, "''")}'`)), total: first.body?.stats?.total, matched: first.body?.matched };
    await sample(admin.token, '/api/library?limit=60', 3); // warm-up
    const idleHealth = await sample(admin.token, '/api/health', 40);
    const idleFull = await sample(admin.token, '/api/library?limit=60', 10);
    const idleLive = await sample(admin.token, '/api/library?live=1', 20);
    const loaded = await loadedWindow(admin, user);
    const idleMedian = percentile(idleHealth, 50);
    result[`rows${size}`] = {
      counts,
      coldFirstMs: Math.round(first.ms), // first call after the seed: rebuilds the row snapshot

      idle: { health: stats(idleHealth), full: stats(idleFull), live: stats(idleLive) },
      loaded: { full: stats(loaded.full), live: stats(loaded.live), health: stats(loaded.health), errors: loaded.errors.slice(0, 10) },
      healthP95Ratio: Number((percentile(loaded.health, 95) / percentile(idleHealth, 95)).toFixed(2)),
      lagP99Ms: Math.round(percentile(loaded.health, 99) - idleMedian),
    };
  }
  writeEvidence('177-perf/result.json', result);

  for (const id of disabled) await admin.raw('PUT', `/api/admin/jobs/${id}`, { enabled: true });

  for (const size of [10_000, 30_000]) {
    const r = result[`rows${size}`] as {
      counts: { libraryRows: number; total: number };
      loaded: { errors: string[]; full: { p95: number }; live: { p95: number } };
      healthP95Ratio: number;
      lagP99Ms: number;
    };
    expect.soft(r.counts.libraryRows, `${size}: rows seeded`).toBe(size);
    expect.soft(r.counts.total, `${size}: entries (library rows + 1000 request-only books)`).toBe(size + 1000);
    expect.soft(r.loaded.errors, `${size}: no failed call`).toEqual([]);
    expect.soft(r.loaded.full.p95, `${size}: full first page p95 under load (ms)`).toBeLessThan(BUDGET.fullP95);
    expect.soft(r.loaded.live.p95, `${size}: live mode p95 under load (ms)`).toBeLessThan(BUDGET.liveP95);
    expect.soft(r.healthP95Ratio, `${size}: unrelated endpoint p95 vs idle`).toBeLessThanOrEqual(BUDGET.healthRatio);
    expect.soft(r.lagP99Ms, `${size}: event-loop lag proxy p99 (ms)`).toBeLessThan(BUDGET.lagP99);
  }
});
