/**
 * Component: E2E helpers for the #177 Library performance spec (seed shapes, async psql, open-loop load)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { spawn } from 'child_process';
import path from 'path';
import { urls } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { percentile, timedGet } from './177-library-helpers';

/**
 * Library rows with real id shapes: even rows a Plex guid (`plex://album/<24 hex>`, 15 ten-character
 * windows), odd rows an Audiobookshelf `li_<18 hex>` id (9 windows), so the ASIN guid index is
 * populated as on a real install. ASIN `B0P<7 digits>`; every 10th row above 2000 has none.
 */
export function seedLibrary(libraryId: string, from: number, to: number) {
  psql(
    `insert into plex_library (id, plex_guid, title, author, narrator, duration, year, asin, plex_library_id, added_at, last_scanned_at, created_at, updated_at)
     select gen_random_uuid(),
            case when g % 2 = 0 then 'plex://album/' || substr(md5('plex' || g), 1, 24) else 'li_' || substr(md5('abs' || g), 1, 18) end,
            'Perf Book ' || g, 'Perf Author ' || (g % 700), 'Perf Narrator', 36000000, 1950 + (g % 70),
            case when g > 2000 and g % 10 = 0 then null else 'B0P' || lpad(g::text, 7, '0') end,
            ${sqlStr(libraryId)}, now() - (g || ' minutes')::interval, now(), now(), now()
     from generate_series(${from}, ${to}) g`
  );
}

/** 2k audiobook requests: 1000 on library books (B0P), 1000 request-only (B0Q); statuses spread, 5% live. */
export function seedRequests(userIds: string[]) {
  const ids = `array[${userIds.map(sqlStr).join(',')}]::text[]`;
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

/** psql through the exec bridge without blocking the runner's event loop (writes during a window). */
export function psqlAsync(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '../../lib/exec-client.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`psql exit ${code}: ${err.trim()}`))));
    const argv = ['gosu', 'postgres', 'psql', '-d', 'readmeabook', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'];
    child.stdin.end(JSON.stringify({ service: 'rmab', argv, input: sql }));
  });
}

/** Unauthenticated GET of a static file: no database call, so its excess latency is event-loop lag. */
export async function probe(pathname: string): Promise<number> {
  const started = performance.now();
  const res = await fetch(`${urls.rmab()}${pathname}`);
  await res.arrayBuffer();
  return performance.now() - started;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const stats = (ms: number[]) => ({
  n: ms.length,
  p50: Math.round(percentile(ms, 50)),
  p95: Math.round(percentile(ms, 95)),
  p99: Math.round(percentile(ms, 99)),
  max: Math.round(ms.length ? Math.max(...ms) : NaN),
});

export interface Sampled {
  ms: number[];
  errors: string[];
}

export const sampled = (): Sampled => ({ ms: [], errors: [] });

/** One timed call recorded into `into` (non-200 recorded as an error, latency kept). */
export async function record(token: string, pathname: string, into: Sampled): Promise<void> {
  try {
    const r = await timedGet(token, pathname);
    into.ms.push(r.ms);
    if (r.status !== 200) into.errors.push(`${pathname} ${r.status}`);
  } catch (error) {
    into.errors.push(`${pathname} ${(error as Error).message}`);
  }
}

/** Call `fn` every `everyMs` (first after `offsetMs`) until `stopAt`; open loop: a slow call never delays the next. */
export async function every(stopAt: number, everyMs: number, offsetMs: number, fn: (i: number) => Promise<void>): Promise<void> {
  const inflight: Promise<void>[] = [];
  let next = Date.now() + offsetMs;
  for (let i = 0; next < stopAt; i++) {
    await sleep(Math.max(0, next - Date.now()));
    inflight.push(fn(i));
    next += everyMs;
  }
  await Promise.all(inflight);
}

/** Back-to-back calls until `stopAt` (the closed-loop stress case). */
export async function loop(stopAt: number, fn: () => Promise<void>, gapMs = 0): Promise<void> {
  while (Date.now() < stopAt) {
    await fn();
    if (gapMs) await sleep(gapMs);
  }
}
