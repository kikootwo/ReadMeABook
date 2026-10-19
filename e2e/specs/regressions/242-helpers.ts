/**
 * Component: E2E regression #242 helpers (container exec, file snapshots, job events, case evidence)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Everything acts inside the stack's own containers and named volumes, through run.mjs's exec bridge
 * (untainted runs only; the #242 specs skip otherwise).
 */

import fs from 'node:fs';
import { evidencePath, waitFor, fakeArr, stackExecSync, Rmab, type Recorded } from '../../lib/harness';

// Node's fetch reuses keep-alive sockets the fake/app servers have already closed (idle > 5 s), which
// surfaces as "fetch failed / other side closed" before the request was read. Retry only that case.
const rawFetch = globalThis.fetch;
if (!(rawFetch as any).__e2e242) {
  const patched = async (input: any, init?: any) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await rawFetch(input, init);
      } catch (error: any) {
        const stale = /other side closed|ECONNRESET/.test(String(error?.cause?.message || error?.cause?.code || ''));
        if (!stale || attempt >= 3) throw error;
      }
    }
  };
  (patched as any).__e2e242 = true;
  globalThis.fetch = patched as typeof fetch;
}

export const MEDIA = '/media/audiobooks';
export const PUID = process.env.PUID || '1000';
export const PGID = process.env.PGID || '1000';
export const BACKUP = '/tmp/rmab-e2e-library-backup';

/** Run a shell script inside a service (script on stdin; never through a host shell). */
export function sh(script: string, { service = 'rmab', user }: { service?: string; user?: string } = {}): string {
  return stackExecSync(service, ['sh', '-s'], { user, input: `set -e\n${script}\n` });
}

export const asApp = (script: string) => sh(script, { user: `${PUID}:${PGID}` });

/** Single-quote a value for sh. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function psql(sql: string): string {
  return stackExecSync('rmab', ['gosu', 'postgres', 'psql', '-d', 'readmeabook', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql }).trim();
}

export const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function dbNow(): string {
  return psql("select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US')");
}

/** sha256 of every regular file below dir (symlinks not followed), path -> sha. */
export function shas(dir: string, prune: string[] = []): Record<string, string> {
  const pr = prune.map((p) => `-path ${q(p)} -prune -o`).join(' ');
  const out = sh(`[ -e ${q(dir)} ] || exit 0\nfind ${q(dir)} ${pr} -type f -print0 | xargs -0 -r sha256sum`);
  const map: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.*)$/.exec(line);
    if (m) map[m[2]] = m[1];
  }
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

/** Human listing: type owner size path [-> link target]. */
export function listing(dir: string, prune: string[] = []): string {
  const pr = prune.map((p) => `-path ${q(p)} -prune -o`).join(' ');
  return sh(`[ -e ${q(dir)} ] || { echo "(missing) ${dir}"; exit 0; }\nfind ${q(dir)} ${pr} -printf '%p\\t%y %u:%g %s %l\\n' | sort`);
}

export function exists(p: string): boolean {
  return sh(`if [ -e ${q(p)} ] || [ -L ${q(p)} ]; then echo yes; else echo no; fi`).trim() === 'yes';
}

export function fileSize(p: string): number {
  const out = sh(`stat -c %s ${q(p)} 2>/dev/null || echo -1`).trim();
  return Number(out);
}

export interface JobEventRow {
  at: string;
  level: string;
  context: string;
  message: string;
  metadata: string;
}

/** Every job event created after `since` (UTC timestamp from dbNow). */
export function eventsSince(since: string): JobEventRow[] {
  const out = psql(
    `select to_char(e.created_at at time zone 'UTC','HH24:MI:SS.MS'), e.level, e.context, replace(replace(e.message, E'\\t', ' '), E'\\n', ' '), coalesce(replace(e.metadata::text, E'\\t', ' '), '')
     from job_events e where e.created_at at time zone 'UTC' > ${sqlStr(since)}::timestamp order by e.created_at, e.id`
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [at, level, context, message, metadata] = l.split('\t');
      return { at, level, context, message, metadata: metadata || '' };
    });
}

export const fmtEvents = (rows: JobEventRow[]) => rows.map((r) => `${r.at} ${r.level.padEnd(5)} [${r.context}] ${r.message}${r.metadata ? `  ${r.metadata}` : ''}`).join('\n');

/** Wait for every organize_files job created after `since` to finish, and the request to leave `processing`. */
export async function waitOrganized(since: string, requestId: string, timeoutMs = 180_000) {
  return waitFor(
    'organize job finished',
    async () => {
      const jobs = psql(`select status from jobs where type = 'organize_files' and created_at at time zone 'UTC' > ${sqlStr(since)}::timestamp`).split('\n').filter(Boolean);
      if (jobs.length === 0 || jobs.some((s) => !['completed', 'failed'].includes(s))) return null;
      const status = psql(`select status from requests where id = ${sqlStr(requestId)}`);
      return status && status !== 'processing' ? { jobs, status } : null;
    },
    { timeoutMs, intervalMs: 1_500 }
  );
}

export async function sabHistoryDeletes(nzoId?: string): Promise<Recorded[]> {
  return (await fakeArr.requests()).filter(
    (r) => r.service === 'sab' && r.query.mode === 'history' && r.query.name === 'delete' && (!nzoId || String(r.query.value || '').split(',').includes(nzoId))
  );
}

/** Indexer settings as the admin Settings page saves them (GET then PUT), with "Remove after processing" set. */
export async function setRemoveAfterProcessing(rmab: Rmab, indexerId: number, on: boolean) {
  const body = await rmab.get<{ indexers: any[]; flagConfigs: any[] }>('/api/admin/settings/prowlarr/indexers');
  const indexers = body.indexers.map((i) => (i.id === indexerId ? { ...i, enabled: true, removeAfterProcessing: on } : i));
  const res = await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers, flagConfigs: body.flagConfigs });
  if (!res.ok) throw new Error(`PUT indexers: HTTP ${res.status} ${await res.text()}`);
  return psql(`select value from configuration where key = 'prowlarr_indexers'`);
}

export function requestState(requestId: string): string {
  return psql(
    `select 'request', id, type, status, coalesce(error_message,'') from requests where id = ${sqlStr(requestId)};
     select 'download_history', id, coalesce(download_client,''), coalesce(download_client_id,''), coalesce(download_status,''), coalesce(download_path,''), to_char(created_at,'HH24:MI:SS') from download_history where request_id = ${sqlStr(requestId)} order by created_at;`
  );
}

/** Per-case evidence and check recorder. */
export class CaseRun {
  readonly dir: string;
  readonly checks: { name: string; kind: 'safety' | 'log' | 'control'; ok: boolean; detail?: string }[] = [];

  constructor(readonly id: string) {
    this.dir = `242/${id}`;
  }

  save(name: string, content: unknown) {
    fs.writeFileSync(evidencePath(this.dir, name), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }

  check(name: string, ok: boolean, kind: 'safety' | 'log' | 'control' = 'safety', detail?: string) {
    this.checks.push({ name, kind, ok, detail });
  }

  failed() {
    return this.checks.filter((c) => !c.ok);
  }

  finish(extra: Record<string, unknown> = {}) {
    const failed = this.failed();
    const result = { case: this.id, image: process.env.E2E_RMAB_IMAGE || '', result: failed.length ? 'FAIL' : 'PASS', checks: this.checks, ...extra };
    this.save('result.json', result);
    return failed;
  }
}

/** Compare two sha maps: files missing or changed in `after`. New files are reported separately. */
export function diffShas(before: Record<string, string>, after: Record<string, string>) {
  const missing = Object.keys(before).filter((p) => !(p in after));
  const changed = Object.keys(before).filter((p) => p in after && after[p] !== before[p]);
  const added = Object.keys(after).filter((p) => !(p in before));
  return { missing, changed, added };
}

export const fmtShas = (m: Record<string, string>) => Object.entries(m).map(([p, s]) => `${s}  ${p}`).join('\n') + '\n';
