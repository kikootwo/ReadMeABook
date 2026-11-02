/**
 * Component: E2E library delete guard helpers (books imported for real, ABS linkage, request deletes)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Every book is imported through the app's own organize job (manual import for audio, an ebook
 * request + Bull organize job for ebooks), so filePath, filesHash and fileFormat are what the app
 * writes. Only the backend linkage (abs_item_id / plex_guid) is set by SQL, from the item the
 * backend reports for the folder. Audio is generated with ffmpeg; ebooks are generated text stand-ins.
 */

import fs from 'node:fs';
import { authState, env, evidencePath, urls, waitFor, Rmab } from '../../lib/harness';
import {
  MEDIA, PUID, PGID, sh, asApp, q, psql, sqlStr, shas, listing, markJobs, eventsSince, fmtEvents, waitOrganized, requestState, type JobEventRow,
} from './242-helpers';

export { MEDIA, PUID, PGID, sh, asApp, q, psql, sqlStr, shas, listing, eventsSince, fmtEvents };

/** Per-case evidence and check recorder (evidence under <evidence>/library-delete/<case>/). */
export class Case {
  readonly dir: string;
  readonly checks: { name: string; kind: 'safety' | 'log' | 'control'; ok: boolean; detail?: string }[] = [];

  constructor(readonly id: string) {
    this.dir = `library-delete/${id}`;
  }

  save(name: string, content: unknown) {
    fs.writeFileSync(evidencePath(this.dir, name), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }

  check(name: string, ok: boolean, kind: 'safety' | 'log' | 'control' = 'safety', detail?: string) {
    this.checks.push({ name, kind, ok, detail });
  }

  /** Record the result; the failed checks as readable lines (empty when all passed). */
  finish(): string[] {
    const failed = this.checks.filter((c) => !c.ok);
    this.save('result.json', { case: this.id, image: process.env.E2E_RMAB_IMAGE || '', result: failed.length ? 'FAIL' : 'PASS', checks: this.checks });
    return failed.map((f) => `${f.kind}: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
}

export const has = (rows: JobEventRow[], text: string) => rows.some((r) => r.message.includes(text));

export function exists(p: string): boolean {
  return sh(`if [ -e ${q(p)} ] || [ -L ${q(p)} ]; then echo yes; else echo no; fi`).trim() === 'yes';
}

export function setConfig(key: string, value: string | null) {
  psql(
    value === null
      ? `delete from configuration where key = ${sqlStr(key)}`
      : `insert into configuration (id, key, value, created_at, updated_at) values (gen_random_uuid(), ${sqlStr(key)}, ${sqlStr(value)}, now(), now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`
  );
}

export const adminUserId = () => psql(`select id from users where role = 'admin' order by created_at limit 1`);

/** A book row as a search result would create it. */
export function newBook(title: string, author: string, asin: string): string {
  return psql(
    `insert into audiobooks (id, audible_asin, title, author, status, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(asin)}, ${sqlStr(title)}, ${sqlStr(author)}, 'requested', now(), now()) returning id`
  ).split('\n')[0];
}

export interface BookRow {
  filePath: string;
  filesHash: string;
  fileFormat: string;
  absItemId: string;
  plexGuid: string;
  status: string;
}

export function bookRow(id: string): BookRow {
  // One JSON value: psql() trims its output, which drops leading empty tab-separated fields.
  return JSON.parse(
    psql(
      `select json_build_object('filePath', coalesce(file_path,''), 'filesHash', coalesce(files_hash,''), 'fileFormat', coalesce(file_format,''), 'absItemId', coalesce(abs_item_id,''), 'plexGuid', coalesce(plex_guid,''), 'status', status)::text from audiobooks where id = ${sqlStr(id)}`
    )
  ) as BookRow;
}

/** Generated audio files (AAC in MP4 for .m4a/.m4b), owned by the app user. */
export function genAudio(dir: string, names: string[], seconds = 4, freq = 440) {
  asApp(
    [`mkdir -p ${q(dir)}`, ...names.map((n, i) => `ffmpeg -nostdin -loglevel error -f lavfi -i sine=frequency=${freq + i * 50}:duration=${seconds} -c:a aac -b:a 64k -f mp4 -y ${q(`${dir}/${n}`)}`)].join('\n')
  );
}

export function genEbook(dir: string, name: string) {
  asApp(`mkdir -p ${q(dir)}\ni=0; while [ $i -lt 200 ]; do echo "generated ebook ${name}"; i=$((i+1)); done > ${q(`${dir}/${name}`)}`);
}

/** Manual import (POST /api/admin/manual-import, as the UI does); waits for its organize job. */
export async function importAudio(c: Case, rmab: Rmab, audiobookId: string, folderPath: string, label = 'audio') {
  const mark = markJobs();
  const res = await rmab.raw('POST', '/api/admin/manual-import', { audiobookId, folderPath, cleanupSource: false });
  const body = await res.json().catch(() => ({}));
  c.check(`${label}: manual import accepted (HTTP ${res.status})`, res.ok, 'control', JSON.stringify(body));
  if (res.ok) await waitOrganized(mark, body.requestId).catch((e) => c.check(`${label}: organize finished`, false, 'control', String(e)));
  c.save(`${label}-events.log`, `${fmtEvents(eventsSince(mark))}\n`);
  return body.requestId as string;
}

/** An ebook request for the book and its organize_files job, queued as JobQueueService.addJob does. */
export async function importEbook(c: Case, audiobookId: string, downloadPath: string, label = 'ebook') {
  const reqId = psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(audiobookId)}, 'ebook', 'downloaded', 100, now(), now()) returning id`
  ).split('\n')[0];
  const payload = { requestId: reqId, audiobookId, downloadPath, cleanupSource: false };
  const bullId = `e2e-libdel-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const mark = markJobs();
  const jobId = psql(
    `insert into jobs (id, bull_job_id, request_id, type, status, priority, payload, max_attempts, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(bullId)}, ${sqlStr(reqId)}, 'organize_files', 'pending', 8, ${sqlStr(JSON.stringify(payload))}::jsonb, 3, now(), now()) returning id`
  ).split('\n')[0];
  const js = `const Q=require('bull');const q=new Q('audiobook-jobs',process.env.REDIS_URL||'redis://127.0.0.1:6379');q.add('organize_files',${JSON.stringify({ ...payload, jobId })},{priority:8,jobId:${JSON.stringify(bullId)}}).then(j=>{console.log(j.id);return q.close();}).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});`;
  const added = sh(`cd /app && node -e ${q(js)}`).trim().split('\n').pop() || '';
  c.check(`${label}: Bull accepted the ebook organize job`, added === bullId, 'control');
  await waitOrganized(mark, reqId).catch((e) => c.check(`${label}: ebook organize finished`, false, 'control', String(e)));
  c.save(`${label}-events.log`, `${fmtEvents(eventsSince(mark))}\n${requestState(reqId)}\n`);
  return reqId;
}

async function absFetch(method: string, p: string): Promise<Response> {
  const login = await fetch(`${urls.abs()}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env('ABS_ROOT_USER'), password: env('ABS_ROOT_PASSWORD') }),
  }).then((r) => r.json());
  const token = login.user?.accessToken || login.user?.token || '';
  return fetch(`${urls.abs()}${p}`, { method, headers: { Authorization: `Bearer ${token}` } });
}

/** Scan ABS and return the id of the item whose path is `folder`. */
export async function absItemFor(folder: string): Promise<string> {
  const libraryId = authState().absLibraryId;
  const item = await waitFor(
    `ABS item for ${folder}`,
    async () => {
      await absFetch('POST', `/api/libraries/${libraryId}/scan`).catch(() => undefined);
      const res = await absFetch('GET', `/api/libraries/${libraryId}/items?limit=500`);
      const items: { id: string; path: string }[] = res.ok ? (await res.json()).results : [];
      return items.find((i) => i.path === folder) || null;
    },
    { timeoutMs: 120_000, intervalMs: 3_000 }
  );
  return item.id;
}

/** Link the book to the ABS item for `folder` (what the library match would store). */
export async function linkAbs(audiobookId: string, folder: string): Promise<string> {
  const id = await absItemFor(folder);
  psql(`update audiobooks set abs_item_id = ${sqlStr(id)} where id = ${sqlStr(audiobookId)}`);
  return id;
}

export async function absItemExists(id: string): Promise<boolean> {
  return (await absFetch('GET', `/api/items/${id}`)).status === 200;
}

/** DELETE /api/admin/requests/<id> (as the admin requests table does). */
export async function deleteRequest(c: Case, rmab: Rmab, requestId: string, label: string) {
  const res = await rmab.raw('DELETE', `/api/admin/requests/${requestId}`);
  const body = await res.json().catch(() => ({}));
  c.save(`${label}-response.json`, { status: res.status, body });
  c.check(`${label}: delete answered 200 (HTTP ${res.status})`, res.status === 200, 'control', JSON.stringify(body));
  return { status: res.status, details: (body.details || {}) as { filesDeleted?: boolean; filesKeptReason?: string }, message: String(body.message || '') };
}

/** sha256 of every file below MEDIA, minus the given subtrees. */
export function mediaShas(exclude: string[] = []): Record<string, string> {
  const all = shas(MEDIA);
  return Object.fromEntries(Object.entries(all).filter(([p]) => !exclude.some((x) => p === x || p.startsWith(`${x}/`))));
}

const AWAY = '/media/.libdel-away';

/** Move everything out of media_dir (what the app sees before a network share is mounted). */
export function emptyMediaDir() {
  sh(`rm -rf ${q(AWAY)}\nmkdir -p ${q(AWAY)}\nfind ${q(MEDIA)} -mindepth 1 -maxdepth 1 -exec mv {} ${q(AWAY)}/ \\;`);
}

/** Put media_dir's contents back after emptyMediaDir. */
export function restoreMediaDir() {
  sh(`find ${q(AWAY)} -mindepth 1 -maxdepth 1 -exec mv {} ${q(MEDIA)}/ \\;\nrmdir ${q(AWAY)}`);
}

export function sameShas(a: Record<string, string>, b: Record<string, string>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
