/**
 * Component: E2E regression #434 helpers (multi-disc fixtures, seeded books, settings, ffprobe, bulk-import SSE)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Everything acts inside the stack's own containers and named volumes through run.mjs's exec bridge
 * (untainted runs only). Audio is generated in the rmab container with ffmpeg lavfi sources (pink
 * noise, so AAC fills its bitrate and a merge passes the size check); every track has its own
 * duration, which is the order oracle for merged chapters. Books use fake ASINs (B0E2E434..) seeded
 * into audible_cache and audiobooks with series/year/narrator set, so no import path looks them up.
 */

import { stackExecSync, writeEvidence, waitFor, Rmab } from '../../lib/harness';
import { MEDIA, PUID, PGID, sh, asApp, q, psql, sqlStr, setConfig, adminUserId, bookRow } from './library-delete-helpers';
import { markJobs, waitOrganized, eventsSince, fmtEvents, newJobsWhere, type JobMark } from './242-helpers';

export { MEDIA, PUID, PGID, sh, asApp, q, psql, sqlStr, bookRow, markJobs, waitOrganized, eventsSince, fmtEvents };

/** Per-run staging root on the downloads volume (unique, removed in afterAll). */
export const RUN = `run-${Date.now().toString(36)}`;
export const ROOT = `/downloads/e2e-434/${RUN}`;

export const AUTHOR = 'E2E Fixture Author';

export interface Track {
  /** Path relative to the book folder, e.g. `Disc 1/01.m4a`. */
  rel: string;
  seconds: number;
}

/** Generated AAC tracks (128 kb/s pink noise, seeded, so deterministic), owned by the app user. */
export function genTracks(bookDir: string, tracks: Track[]) {
  const lines = tracks.map((t, i) => {
    const out = `${bookDir}/${t.rel}`;
    const dir = out.slice(0, out.lastIndexOf('/'));
    const enc = `-ac 1 -ar 44100 -c:a aac -b:a 128k -f mp4 -y ${q(out)}`;
    const noise = q(`anoisesrc=d=${t.seconds}:c=pink:a=0.3:seed=${434 + i}`);
    const sine = q(`sine=frequency=${300 + i * 40}:duration=${t.seconds}`);
    return `mkdir -p ${q(dir)}\nffmpeg -nostdin -loglevel error -f lavfi -i ${noise} ${enc} || ffmpeg -nostdin -loglevel error -f lavfi -i ${sine} ${enc}`;
  });
  asApp(lines.join('\n'));
}

/** Probed duration (s) of every generated file below dir, relative path -> seconds. */
export function probeDurations(dir: string): Record<string, number> {
  const out = sh(
    `cd ${q(dir)}\nfind . -type f | sed 's|^[.]/||' | sort | while IFS= read -r f; do printf '%s\\t%s\\n' "$f" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"; done`
  );
  return Object.fromEntries(
    out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [f, d] = l.split('\t');
        return [f, Number(d)];
      })
  );
}

/** audible_cache + audiobooks rows for a fake ASIN (series/year/narrator set: no Audnexus enrichment). */
export function seedBook(asin: string, title: string): string {
  psql(
    `insert into audible_cache (id, asin, title, author, narrator, description, genres, last_synced_at, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(asin)}, ${sqlStr(title)}, ${sqlStr(AUTHOR)}, 'E2E Narrator', 'Generated test book.', '[]'::jsonb, now(), now(), now())
     on conflict (asin) do nothing`
  );
  return psql(
    `insert into audiobooks (id, audible_asin, title, author, narrator, series, series_part, year, status, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(asin)}, ${sqlStr(title)}, ${sqlStr(AUTHOR)}, 'E2E Narrator', 'E2E 434 Series', '1', 2020, 'requested', now(), now()) returning id`
  ).split('\n')[0];
}

/** A failed request for the book, owned by the admin (shows on /requests; Manual Import may recycle it). */
export function failedRequest(audiobookId: string): string {
  return psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(audiobookId)}, 'audiobook', 'failed', 0, 'e2e fixture: nothing downloaded', now(), now()) returning id`
  ).split('\n')[0];
}

export type SettingKey = 'chapter_merging_enabled' | 'metadata_tagging_enabled' | 'file_rename_enabled';

function getConfig(key: string): string | null {
  return psql(`select count(*) from configuration where key = ${sqlStr(key)}`) === '0'
    ? null
    : psql(`select value from configuration where key = ${sqlStr(key)}`);
}

/** Run `fn` with these settings (each test states all it relies on), then restore what was there (or no row). */
export async function withSettings<T>(settings: Partial<Record<SettingKey, 'true' | 'false'>>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.keys(settings).map((key) => [key, getConfig(key)] as const);
  try {
    for (const [key, value] of Object.entries(settings)) {
      setConfig(key, value as string);
      if (getConfig(key) !== value) throw new Error(`setting ${key} was not stored`);
    }
    return await fn();
  } finally {
    for (const [key, value] of saved) setConfig(key, value);
  }
}

export const ALL_OFF = { chapter_merging_enabled: 'false', metadata_tagging_enabled: 'false', file_rename_enabled: 'false' } as const;

/** The library folder the organizer made for this ASIN ({author}/{title} {asin}), or ''. */
export function libraryFolder(asin: string): string {
  return sh(`find ${q(MEDIA)} -mindepth 2 -maxdepth 2 -type d -name ${q(`*${asin}*`)} | sort | head -1`).trim();
}

/** Every file below a library folder, relative, sorted. */
export function libraryFiles(folder: string): string[] {
  if (!folder) return [];
  return sh(`cd ${q(folder)}\nfind . -type f | sed 's|^[.]/||' | sort`).split('\n').filter(Boolean);
}

export interface Chapter {
  title: string;
  start: number;
  end: number;
  seconds: number;
}

export function chaptersOf(file: string): Chapter[] {
  const out = stackExecSync('rmab', ['ffprobe', '-v', 'error', '-print_format', 'json', '-show_chapters', file]);
  const chapters: any[] = JSON.parse(out).chapters || [];
  return chapters.map((c) => {
    const start = Number(c.start_time);
    const end = Number(c.end_time);
    return { title: String(c.tags?.title ?? ''), start, end, seconds: Math.round((end - start) * 1000) / 1000 };
  });
}

/** Label each chapter with the source track whose probed duration is nearest (within tolerance), else '?<s>'. */
export function labelByDuration(chapters: Chapter[], sources: Record<string, number>, tolerance = 0.12): string[] {
  return chapters.map((c) => {
    let best = '';
    let bestDiff = Infinity;
    for (const [rel, d] of Object.entries(sources)) {
      const diff = Math.abs(d - c.seconds);
      if (diff < bestDiff) [best, bestDiff] = [rel, diff];
    }
    return bestDiff <= tolerance ? best : `?${c.seconds}`;
  });
}

export interface ApiResult {
  status: number;
  body: any;
}

/** POST /api/admin/manual-import; on success waits for the organize job (and the request leaving `processing`). */
export async function manualImportApi(rmab: Rmab, body: Record<string, unknown>, mark: JobMark = markJobs()): Promise<ApiResult & { organized?: unknown; organizeError?: string }> {
  const res = await rmab.raw('POST', '/api/admin/manual-import', body);
  const parsed = await res.json().catch(() => ({}));
  const result: ApiResult & { organized?: unknown; organizeError?: string } = { status: res.status, body: parsed };
  if (res.ok && parsed.requestId) {
    try {
      result.organized = await waitOrganized(mark, parsed.requestId);
    } catch (error) {
      result.organizeError = String(error);
    }
  }
  return result;
}

/** Every organize_files job created after the mark: status and payload (selected files as the organizer got them). */
export function organizeJobs(mark: JobMark): { status: string; payload: any }[] {
  return psql(`select json_build_object('status', status, 'payload', payload)::text from jobs where type = 'organize_files' and ${newJobsWhere(mark)} order by created_at`)
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export interface SseEvent {
  event: string;
  data: any;
}

/** POST /api/admin/bulk-import/scan and read the whole SSE stream (as the wizard does). */
export async function bulkScan(rmab: Rmab, rootPath: string): Promise<{ status: number; events: SseEvent[] }> {
  const res = await rmab.raw('POST', '/api/admin/bulk-import/scan', { rootPath });
  const text = await res.text();
  const events: SseEvent[] = [];
  let event = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ') && event) {
      let data: any = line.slice(6);
      try {
        data = JSON.parse(data);
      } catch {
        /* keep raw */
      }
      events.push({ event, data });
      event = '';
    }
  }
  return { status: res.status, events };
}

/** Wait until every listed request has left `processing` and no organize job after the mark is still running. */
export async function waitRequestsSettled(mark: JobMark, requestIds: string[], timeoutMs = 240_000) {
  return waitFor(
    'bulk organize jobs finished',
    async () => {
      const jobs = organizeJobs(mark);
      if (jobs.length === 0 || jobs.some((j) => !['completed', 'failed'].includes(j.status))) return null;
      const statuses = requestIds.map((id) => psql(`select status from requests where id = ${sqlStr(id)}`));
      return statuses.every((s) => s && s !== 'processing') ? { jobs: jobs.map((j) => j.status), statuses } : null;
    },
    { timeoutMs, intervalMs: 2_000 }
  );
}

export function saveJson(name: string, value: unknown) {
  writeEvidence(`434/${name}.json`, { image: process.env.E2E_RMAB_IMAGE || '', run: RUN, ...(value as object) });
}

/** Best-effort removal of what the spec created: staging, library folders, rows for its fake ASINs. */
export function cleanup(asins: string[]) {
  const errors: string[] = [];
  try {
    // The whole spec root: a worker restarted after a failed test has its own RUN
    sh(`rm -rf ${q(ROOT.slice(0, ROOT.lastIndexOf('/')))}`);
    for (const asin of asins) {
      const folder = libraryFolder(asin);
      if (folder) sh(`rm -rf ${q(folder)}\nrmdir ${q(folder.slice(0, folder.lastIndexOf('/')))} 2>/dev/null || true`);
    }
  } catch (error) {
    errors.push(`files: ${String(error)}`);
  }
  const list = asins.map(sqlStr).join(',');
  const books = `(select id from audiobooks where audible_asin in (${list}))`;
  const reqs = `(select id from requests where audiobook_id in ${books})`;
  try {
    psql(
      `begin;
       delete from job_events where job_id in (select id from jobs where request_id in ${reqs});
       delete from jobs where request_id in ${reqs};
       delete from download_history where request_id in ${reqs};
       delete from requests where id in ${reqs};
       delete from audiobooks where audible_asin in (${list});
       delete from audible_cache where asin in (${list});
       commit;`
    );
  } catch (error) {
    errors.push(`rows: ${String(error).slice(0, 400)}`);
  }
  return errors;
}
