/**
 * Component: E2E regression #540 (the app stops cleanly when the container stops)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * run.mjs --stop-specs 540-stop --stop-cycles 3 --stop-time 10 runs the phases below; between two
 * phases the harness runs a timed `docker stop --time 10` on this run's rmab container and starts it
 * again (stop/stop-<n>.json). A merge is held busy by SIGSTOPping its ffmpeg (generated audio, short
 * fixtures), so a job is reliably running when the stop lands.
 *   stop-0  merging on, tagging off, nothing running                     → stop 1 (E1: idle)
 *   stop-1  E1 log order; martian merge held                             → stop 2 (E2: job running)
 *   stop-2  E2 log lines, rerun → downloaded, temp leftovers; artemis merge held, node SIGKILLed
 *           (crash: no ffmpeg left, app restarted), rerun held again     → stop 3 (second cut)
 *   stop-3  E4: the request cut twice is reset and imported by retry_failed_imports; E3: phm merge
 *           held, released together with a SIGTERM to app-start.sh, so the job finishes in the window
 * Values are read first and checked with expect.soft, so a run on main records every difference.
 * Exec bridge required.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackLogsSync, writeEvidence, type Book } from '../../lib/harness';
import { psql, setConfig, sh, sqlStr } from './library-delete-helpers';

const phase = process.env.E2E_PHASE ?? '';
const stops: Array<{ cycle: number; stopSeconds: number; exitCode: number; health: string[]; healthySeconds: number | null }> =
  JSON.parse(process.env.E2E_STOP_RESULTS || '[]');

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(!/^stop-\d$/.test(phase), '540-stop only runs via run.mjs --stop-specs');
test.setTimeout(15 * 60_000);

const BANNER = 'ReadMeABook Unified Container Starting';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn returns a value, or null at the timeout (main never gets there for some checks). */
async function poll<T>(fn: () => T | null | undefined | false | Promise<T | null | undefined | false>, timeoutMs: number, intervalMs = 2000): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value as T;
    } catch { /* retry */ }
    if (Date.now() > end) return null;
    await sleep(intervalMs);
  }
}

/** rmab logs split at each container start: segment k ends with stop k's lines. */
const segments = () => stackLogsSync('rmab').split(BANNER);
const count = (text: string, needle: string) => text.split(needle).length - 1;
const lines = (text: string, re: RegExp) => text.split('\n').filter((l) => re.test(l)).map((l) => l.trim().slice(0, 300));

/** What stop k left in the logs, and what the following start reported. */
function stopReport(k: number) {
  const seg = segments();
  const stop = seg[k] ?? '';
  const next = seg[k + 1] ?? '';
  const at = (needle: string) => stop.indexOf(needle);
  return {
    timing: stops.find((s) => s.cycle === k) ?? null,
    shutdown: lines(stop, /\[Shutdown\]|\[App\] (Stop requested|node exited|Ending leftover)/),
    order: {
      sigterm: at('[Shutdown] SIGTERM received'), done: at('[Shutdown] Done in'), nodeExited: at('[App] node exited'),
      pgFastShutdown: at('received fast shutdown request'), pgDown: at('database system is shut down'),
    },
    terminatingConnections: count(stop, 'terminating connection due to administrator command'),
    recoveryNextStart: count(next, 'database system was not properly shut down') + count(next, 'automatic recovery in progress'),
  };
}

const status = (id: string) => psql(`select status from requests where id = ${sqlStr(id)}`);
const organizeJobs = (id: string) =>
  psql(`select bull_job_id || ':' || status from jobs where request_id = ${sqlStr(id)} and type = 'organize_files' order by created_at`).split('\n').filter(Boolean);
const pids = (comm: string) =>
  sh(`for d in /proc/[0-9]*; do c=$(cat "$d/comm" 2>/dev/null) || continue; [ "$c" = "${comm}" ] && echo "\${d#/proc/}"; done; true`).split(/\s+/).filter(Boolean);
const healthy = () => poll(() => sh('curl -sf --max-time 2 http://localhost:3030/api/health >/dev/null && echo ok || true') === 'ok', 120_000);

/** Hold the next merge's ffmpeg (SIGSTOP) once it starts; its PID lands in /tmp/e2e-ffpid. */
function holdNextMerge() {
  const skip = pids('ffmpeg').join(' ');
  sh(`rm -f /tmp/e2e-ffpid
cat > /tmp/e2e-hold.sh <<'EOS'
#!/bin/bash
skip=" $1 "
for _ in $(seq 1 15000); do
  for d in /proc/[0-9]*; do
    read -r c < "$d/comm" 2>/dev/null || continue
    [ "$c" = ffmpeg ] || continue
    p="\${d#/proc/}"
    case "$skip" in *" $p "*) continue ;; esac
    case "$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null)" in *concat*) kill -STOP "$p" && echo "$p" > /tmp/e2e-ffpid && exit 0 ;; esac
  done
  sleep 0.02
done
EOS
setsid bash /tmp/e2e-hold.sh '${skip}' >/dev/null 2>&1 </dev/null &`);
}
const heldPid = () => poll(() => sh('cat /tmp/e2e-ffpid 2>/dev/null || true').trim(), 240_000, 1000);

async function requestHeld(rmab: Rmab, scenario: string, key: 'martian' | 'artemis' | 'phm') {
  await fakeArr.scenario(scenario);
  const book: Book = (await fakeArr.books())[key];
  holdNextMerge();
  const id = (await rmab.requestBook(book)).request.id;
  const pid = await heldPid();
  return { id, pid };
}

test('#540 stop phases', async () => {
  const rmab = await Rmab.loginAdmin();
  const out: Record<string, unknown> = { phase };
  const save = () => writeEvidence(`540/${phase}.json`, out); // after each step, so a failure keeps what was read

  if (phase === 'stop-0') {
    setConfig('chapter_merging_enabled', 'true');
    setConfig('metadata_tagging_enabled', 'false');
    out.idle = { ffmpeg: pids('ffmpeg').length, activeJobs: psql(`select count(*) from jobs where status = 'active'`) };
  }

  if (phase === 'stop-1') {
    out.e1 = stopReport(1);
    save();
    const held = await requestHeld(rmab, 'stop-merge-martian', 'martian');
    out.martian = { ...held, status: status(held.id), jobs: organizeJobs(held.id) };
    expect(held.pid, 'martian merge held').toBeTruthy();
  }

  if (phase === 'stop-2') {
    out.e2 = stopReport(2);
    save();
    const martian = psql(`select r.id from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin = 'B082BHJMFF' and r.deleted_at is null`);
    const done = await poll(() => (['downloaded', 'available'].includes(status(martian)) ? status(martian) : null), 240_000);
    out.e2Recovery = {
      status: status(martian), done, jobs: organizeJobs(martian),
      stalledLog: count(stackLogsSync('rmab'), 'stalled'),
      tmp: sh('ls -la /tmp/readmeabook 2>&1 || true'),
      tmpTagCopies: sh("find /downloads -name '*.tmp' 2>/dev/null | head -20; true"),
      partials: sh("find /media -name '.rmab-partial-*' 2>/dev/null | head; true"),
      library: sh("find /media/audiobooks -type f 2>/dev/null | sort | head -40; true"),
    };

    save();

    // Crash: node SIGKILLed during a held merge
    const held = await requestHeld(rmab, 'asin-merge', 'artemis');
    const nodeBefore = pids('node');
    sh(`for p in ${nodeBefore.join(' ')}; do kill -KILL "$p"; done`);
    const restarted = await poll(() => {
      const now = pids('node');
      return now.length > 0 && now.every((p) => !nodeBefore.includes(p)) ? now : null;
    }, 60_000, 1000);
    const ffmpegAfterCrash = pids('ffmpeg');
    out.crash = {
      ...held, nodeBefore, nodeAfter: restarted, ffmpegAfterCrash, healthy: await healthy(),
      wrapperLines: lines(stackLogsSync('rmab'), /\[App\] (node exited|ERROR|Ending leftover)/).slice(-4),
    };
    save();
    // Second cut: hold the rerun (after Bull's stall check, 30-60 s), then the harness stops the container
    holdNextMerge();
    const rerun = await heldPid();
    out.crash = { ...(out.crash as object), rerunHeld: rerun, jobs: organizeJobs(held.id) };
    expect.soft(ffmpegAfterCrash, 'no ffmpeg left after the crash').toEqual([]);
    expect(rerun, 'artemis rerun held for the second cut').toBeTruthy();
  }

  if (phase === 'stop-3') {
    out.e2b = stopReport(3);
    save();
    const artemis = psql(`select r.id from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin = 'B072R1CY4P' and r.deleted_at is null`);
    const reset = await poll(() => (status(artemis) !== 'processing' ? status(artemis) : null), 150_000);
    const resetMessage = psql(`select coalesce(error_message, '') from requests where id = ${sqlStr(artemis)}`);
    if (reset === 'awaiting_import') await rmab.triggerScheduledJob('retry_failed_imports');
    const imported = await poll(() => (['downloaded', 'available'].includes(status(artemis)) ? status(artemis) : null), 180_000);
    out.e4 = { statusAfterSecondCut: reset ?? 'processing (unchanged after 150 s)', resetMessage, imported, final: status(artemis), jobs: organizeJobs(artemis) };
    save();
    expect.soft(reset, 'request cut twice is reset').toBe('awaiting_import');
    expect.soft(imported, 'retried import completes').toBeTruthy();

    // E3: the held merge is released together with the stop, so it finishes inside the window
    const held = await requestHeld(rmab, 'asin-merge-tagged', 'phm');
    const nodeBefore = pids('node');
    const wrapper = pids('app-start.sh');
    out.e3 = { ...held, wrapper };
    save();
    if (held.pid) sh(`kill -CONT ${held.pid}; kill -TERM ${wrapper.join(' ')}`);
    const restarted = await poll(() => {
      const now = pids('node');
      return now.length > 0 && now.every((p) => !nodeBefore.includes(p)) ? now : null;
    }, 60_000, 1000);
    await healthy();
    const logs = stackLogsSync('rmab');
    const statusRightAfter = status(held.id);
    await sleep(75_000); // a job left active would rerun through the stall check by now
    const jobs = organizeJobs(held.id);
    const stalled = jobs.map((j) => count(stackLogsSync('rmab'), `Job ${j.split(':')[0]} stalled`));
    out.e3 = {
      ...held, wrapper, restarted, statusRightAfter, final: status(held.id), jobs, stalled,
      shutdown: lines(logs, /\[Shutdown\] (SIGTERM|Done|Job )|\[App\] node exited/).slice(-5),
    };
    expect.soft(lines(logs, /\[Shutdown\] Done in/).at(-1) ?? '', 'job finished in the window').toMatch(/finished 1, left 0/);
    expect.soft(statusRightAfter, 'request imported before node exited').toMatch(/^(downloaded|available)$/);
    expect.soft(jobs.map((j) => j.split(':')[1]), 'jobs row completed').toEqual(['completed']);
    expect.soft(stalled, 'not rerun after the restart').toEqual([0]);
  }

  save();

  // Checks on values already written
  const e = (out.e1 ?? out.e2 ?? out.e2b) as ReturnType<typeof stopReport> | undefined;
  if (e) {
    expect.soft(e.timing?.stopSeconds ?? 99, 'docker stop seconds').toBeLessThanOrEqual(phase === 'stop-1' ? 3 : 8);
    expect.soft(e.timing?.health.at(-1), 'healthy again after start').toBe('healthy');
    expect.soft(e.order.sigterm, '[Shutdown] SIGTERM received').toBeGreaterThanOrEqual(0);
    expect.soft(e.order.done, 'Done after SIGTERM').toBeGreaterThan(e.order.sigterm);
    expect.soft(e.order.nodeExited, 'wrapper waited for node').toBeGreaterThan(e.order.done);
    expect.soft(e.order.pgFastShutdown, 'PostgreSQL stopped after node').toBeGreaterThan(e.order.nodeExited);
    expect.soft(e.terminatingConnections, 'no sessions left for PostgreSQL to end').toBe(0);
    expect.soft(e.recoveryNextStart, 'no crash recovery on the next start').toBe(0);
    if (phase !== 'stop-1') expect.soft(e.shutdown.join('\n'), 'job left for retry').toContain('left for retry on next start');
  }
});
