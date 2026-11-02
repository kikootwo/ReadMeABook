/**
 * Component: E2E verified-import cleanup helpers (staging, freezing the app process, case evidence)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Builds on the #242 helpers: everything acts inside the stack's own containers and named volumes
 * through run.mjs's exec bridge (untainted runs only). Audio is generated (harness fixtures or ffmpeg
 * lavfi sources); nothing real is copied in.
 */

import fs from 'node:fs';
import { evidencePath, Rmab, waitFor } from '../../lib/harness';
import { MEDIA, PUID, PGID, sh, asApp, q, psql, sqlStr, shas, listing, eventsSince, fmtEvents, waitOrganized, sabHistoryDeletes, requestState, fmtShas, type JobEventRow, type JobMark } from './242-helpers';

export { MEDIA, PUID, PGID, sh, asApp, q, psql, sqlStr, shas, listing, eventsSince, fmtEvents, waitOrganized, sabHistoryDeletes, requestState, fmtShas };
export type { JobEventRow };

export const PARTIAL_GLOB = '.rmab-partial-*.part';

/** Per-case evidence and check recorder (evidence under <evidence>/verified-import/<case>/). */
export class Evidence {
  readonly dir: string;
  readonly checks: { name: string; kind: 'safety' | 'log' | 'control'; ok: boolean; detail?: string }[] = [];

  constructor(readonly id: string) {
    this.dir = `verified-import/${id}`;
  }

  save(name: string, content: unknown) {
    fs.writeFileSync(evidencePath(this.dir, name), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }

  check(name: string, ok: boolean, kind: 'safety' | 'log' | 'control' = 'safety', detail?: string) {
    this.checks.push({ name, kind, ok, detail });
  }

  /** Record the result and return the failed checks as readable lines (empty when all passed). */
  finish(extra: Record<string, unknown> = {}): string[] {
    const failed = this.checks.filter((c) => !c.ok);
    this.save('result.json', { case: this.id, image: process.env.E2E_RMAB_IMAGE || '', result: failed.length ? 'FAIL' : 'PASS', checks: this.checks, ...extra });
    return failed.map((f) => `${f.kind}: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
}

export const has = (rows: JobEventRow[], text: string, level?: string) =>
  rows.some((r) => r.message.includes(text) && (!level || r.level === level));

/** File names of a harness fixture (generated tones), as stored in fake-arr's /fixtures/<id>/. */
export function fixtureFiles(fixtureId: string): string[] {
  // fake-arr is alpine: busybox find has no -printf
  return sh(`cd ${q(`/fixtures/${fixtureId}`)} && find . -type f | sed 's|^[.]/||' | sort`, { service: 'fake-arr' }).split('\n').filter(Boolean);
}

/** Copy a fixture's files into `dest` on the shared downloads volume, owned by the app user. */
export function stageFixture(fixtureId: string, dest: string) {
  sh(`mkdir -p ${q(dest)}\ncp -r ${q(`/fixtures/${fixtureId}`)}/. ${q(dest)}/\nchown -R ${PUID}:${PGID} ${q(dest)}`, { service: 'fake-arr' });
}

export function sha(file: string): string {
  return sh(`sha256sum ${q(file)} | cut -d' ' -f1`).trim();
}

export function isSymlink(p: string): boolean {
  return sh(`if [ -L ${q(p)} ]; then echo yes; else echo no; fi`).trim() === 'yes';
}

export function partialsIn(dir: string): string[] {
  return sh(`[ -d ${q(dir)} ] || exit 0\nfind ${q(dir)} -maxdepth 1 -name ${q(PARTIAL_GLOB)} -printf '%f %s\\n'`).split('\n').filter(Boolean);
}

/** Organizer reads metadata_tagging_enabled straight from the database, so this takes effect on the next job. */
export function setTagging(on: boolean) {
  psql(`update configuration set value = ${sqlStr(String(on))} where key = 'metadata_tagging_enabled'`);
}

/** PID of the app server that runs the Bull workers (Next sets process.title to "next-server (...)", which replaces the command line). */
export function appPid(): string {
  return sh(
    [
      'for p in /proc/[0-9]*; do',
      '  cmd=$(tr "\\0" " " < "$p/cmdline" 2>/dev/null) || continue',
      '  case "$cmd" in "next-server"*|"node server.js"*|*" server.js"*) echo "${p#/proc/}"; exit 0;; esac',
      'done',
      'exit 1',
    ].join('\n')
  ).trim();
}

/** Start a detached root shell script in rmab that survives the exec call; its output goes to `outFile`. */
export function startDetached(name: string, script: string, outFile: string) {
  const file = `/tmp/${name}.sh`;
  sh(`cat > ${q(file)} <<'RMAB_E2E_EOF'\n${script}\nRMAB_E2E_EOF\nrm -f ${q(outFile)}\nif command -v setsid >/dev/null 2>&1; then setsid sh ${q(file)} > /dev/null 2>&1 < /dev/null & else nohup sh ${q(file)} > /dev/null 2>&1 < /dev/null & fi`);
}

export function readOut(outFile: string): string {
  return sh(`cat ${q(outFile)} 2>/dev/null || true`).trim();
}

/** Restore the seeded library from the in-container backup and clear staging folders. */
export function restoreLibrary(backup: string, extra: string[] = []) {
  sh([`rm -rf ${q(MEDIA)} /downloads/manual /downloads/seed ${extra.map(q).join(' ')}`, `cp -a ${q(backup)} ${q(MEDIA)}`, `chown ${PUID}:${PGID} ${q(MEDIA)}`].join('\n'));
}

export function saveState(e: Evidence, phase: string, dirs: string[]) {
  e.save(`listing-${phase}.txt`, dirs.map((d) => `# ${d}\n${listing(d)}\n`).join('\n'));
  for (const d of dirs) e.save(`sha256-${d.replace(/[^a-z0-9]+/gi, '_')}-${phase}.txt`, fmtShas(shas(d)));
}

/** Manual import over HTTP (as the UI does) and wait for its organize job. */
export async function manualImport(e: Evidence, rmab: Rmab, since: JobMark, body: Record<string, unknown>) {
  e.save('trigger.json', { method: 'POST', path: '/api/admin/manual-import', body });
  const res = await rmab.raw('POST', '/api/admin/manual-import', body);
  const response = await res.json().catch(() => ({}));
  e.save('trigger-response.json', { status: res.status, body: response });
  e.check(`manual import accepted (HTTP ${res.status})`, res.ok, 'control', JSON.stringify(response));
  if (res.ok) {
    try {
      e.save('organize-jobs.json', await waitOrganized(since, response.requestId));
    } catch (error) {
      e.check('organize job finished in time', false, 'control', String(error));
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  const events = eventsSince(since);
  e.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  if (response.requestId) e.save('request-state.tsv', `${requestState(response.requestId)}\n`);
  return { events, requestId: response.requestId as string | undefined };
}

export function requestError(requestId: string): { status: string; errorMessage: string } {
  const [status, errorMessage] = psql(`select status, coalesce(error_message, '') from requests where id = ${sqlStr(requestId)}`).split('\t');
  return { status, errorMessage: errorMessage || '' };
}

export async function waitRequestDone(requestId: string, timeoutMs = 300_000) {
  return waitFor(
    'request downloaded/available',
    async () => {
      const s = psql(`select status from requests where id = ${sqlStr(requestId)}`);
      return ['downloaded', 'available', 'failed', 'warn'].includes(s) ? s : null;
    },
    { timeoutMs, intervalMs: 3_000 }
  );
}
