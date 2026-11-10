/**
 * Component: E2E stop flow (container stopped and started between spec phases)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * --stop-specs <a,b> --stop-cycles <n> [--stop-time <s>]: phases stop-0 … stop-<n> run the given specs
 * (each reads E2E_PHASE); between two phases the harness runs a timed `docker stop --time <s>` on this
 * run's own rmab container (found by compose project + service + harness label, never by a name from a
 * spec), saves its exit code and the logs, starts it again and waits for Docker's health status.
 * Results go to summary.json (`stops`) and stop/stop-<i>.json for the next phase.
 * Times per stop: `containerStopSeconds` is the container's own stop, Docker's first `kill` event (the
 * stop signal) to the container's exit (`State.FinishedAt`, containerd's exit time), both on the daemon's
 * clock. Specs assert it. `killToDieSeconds` (to Docker's `die` event) and `stopSeconds` (the docker CLI's
 * wall time on the host) also count the daemon's work after the exit, which a busy machine stretches by
 * seconds; they are recorded only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { LABEL, run } from './docker.mjs';

const HEALTH_TIMEOUT_MS = 180_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** This run's rmab container: compose project + service label + the harness label, exactly one. */
export function rmabContainer(project) {
  const ids = run('docker', [
    'ps', '-aq',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=rmab',
    '--filter', `label=${LABEL}`,
  ], { capture: true, quiet: true }).split(/\s+/).filter(Boolean);
  if (ids.length !== 1) throw new Error(`expected one rmab container in compose project ${project}, found ${ids.length}`);
  return ids[0];
}

function inspect(id, format) {
  return run('docker', ['inspect', '-f', format, id], { capture: true, allowFail: true, quiet: true });
}

/** RFC 3339 time with up to 9 fraction digits (`docker inspect`) → Unix nanoseconds, or null. */
export function rfc3339Ns(value) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(String(value || '').trim());
  const ms = m ? Date.parse(`${m[1]}${m[3]}`) : NaN;
  if (!m || !Number.isFinite(ms) || ms <= 0) return null; // Docker's zero time (0001-…) is "never"
  return BigInt(ms) * 1_000_000n + BigInt((m[2] ?? '').padEnd(9, '0'));
}

const secondsBetween = (from, to) => Math.round(Number(to - from) / 1e6) / 1e3;

/**
 * Docker events (`<TimeNano> <Actor.ID> <Action>` lines) + the container's FinishedAt → its last stop:
 * the first `kill` after any earlier `die` and not after the exit, to the exit. Several kills are
 * Docker's follow-up signal (SIGKILL at the timeout); lines for other containers are ignored. `seconds`
 * is null when the kill or the exit is missing; `killToDieSeconds` when the kill or the die is.
 */
export function parseStopEvents(text, id, finishedAt) {
  const events = String(text || '').split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter(([ns, actor, action]) =>
    /^\d+$/.test(ns ?? '') && id && actor?.startsWith(id) && (action === 'kill' || action === 'die'))
    .map(([ns, , action]) => ({ ns: BigInt(ns), action })).sort((a, b) => (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0));
  const exited = rfc3339Ns(finishedAt);
  const after = exited === null ? -1n : events.filter((e) => e.action === 'die' && e.ns < exited).at(-1)?.ns ?? -1n;
  const kill = exited === null ? undefined : events.find((e) => e.action === 'kill' && e.ns > after && e.ns <= exited);
  const die = kill && events.find((e) => e.action === 'die' && e.ns >= kill.ns);
  return {
    seconds: kill ? secondsBetween(kill.ns, exited) : null,
    killToDieSeconds: die ? secondsBetween(kill.ns, die.ns) : null,
    events: events.map((e) => `${e.ns} ${e.action}`),
  };
}

/**
 * The container's own stop time. Window: its last StartedAt (`docker inspect`) to the daemon's current
 * time (`docker info` SystemTime), so the daemon's clock bounds it, never the host's, and a die the
 * daemon logged late is still inside. Read right after the stop (the daemon keeps only its latest
 * events), before the next `docker start`. Nulls when anything can't be read: never a guess.
 */
export function containerStopTime(id) {
  const none = { seconds: null, killToDieSeconds: null, exitedAt: null, events: [] };
  try {
    const [started, finished] = inspect(id, '{{.State.StartedAt}} {{.State.FinishedAt}}').split(/\s+/);
    const now = run('docker', ['info', '--format', '{{.SystemTime}}'], { capture: true, allowFail: true, quiet: true, timeoutMs: 30_000 });
    if (rfc3339Ns(started) === null || rfc3339Ns(finished) === null || rfc3339Ns(now) === null) return none;
    const out = run('docker', [
      'events', '--since', started, '--until', now,
      '--filter', `container=${id}`, '--filter', 'event=kill', '--filter', 'event=die',
      '--format', '{{.TimeNano}} {{.Actor.ID}} {{.Action}}',
    ], { capture: true, allowFail: true, quiet: true, timeoutMs: 30_000 });
    return { ...parseStopEvents(out, id, finished), exitedAt: finished };
  } catch {
    return none;
  }
}

/** Timed stop + start of the rmab container; returns what the next phase and summary.json need. */
export async function stopAndStart(id, stopTime) {
  const startedAt = new Date().toISOString();
  const t0 = process.hrtime.bigint();
  run('docker', ['stop', '--time', String(stopTime), id]);
  const stopSeconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const exitCode = Number(inspect(id, '{{.State.ExitCode}}'));
  const container = containerStopTime(id);
  run('docker', ['start', id]);
  const t1 = Date.now();
  const health = [];
  let status = '';
  while (Date.now() - t1 < HEALTH_TIMEOUT_MS) {
    status = inspect(id, '{{if .State.Health}}{{.State.Health.Status}}{{end}}');
    if (health.at(-1) !== status) health.push(status);
    if (status === 'healthy') break;
    await sleep(2000);
  }
  return {
    startedAt, stopTime, containerStopSeconds: container.seconds, killToDieSeconds: container.killToDieSeconds,
    stopSeconds: Math.round(stopSeconds * 100) / 100, exitedAt: container.exitedAt, stopEvents: container.events, exitCode,
    health, healthySeconds: status === 'healthy' ? Math.round((Date.now() - t1) / 1000) : null,
  };
}

/**
 * Phases stop-0 … stop-<cycles>, one timed stop/start between each pair. `up`, `playwright` and
 * `saveLogs` come from run.mjs.
 */
export async function stopFlow(ctx, image, { up, playwright, saveLogs }) {
  const { opts } = ctx;
  const specs = opts['stop-specs'].split(',').map((s) => s.trim()).filter(Boolean);
  const cycles = Number(opts['stop-cycles'] || 1);
  const stopTime = Number(opts['stop-time'] || 10);
  const dir = path.join(ctx.evidence, 'stop');
  fs.mkdirSync(dir, { recursive: true });
  ctx.summary.stops = [];
  up(ctx, image);
  const id = rmabContainer(ctx.project);
  let status = 0;
  for (let n = 0; n <= cycles; n++) {
    // Every phase runs (a failure in one is recorded, not fatal), so a run on main shows each difference
    const phase = await playwright(ctx, specs, `stop-${n}`, { E2E_STOP_RESULTS: JSON.stringify(ctx.summary.stops) });
    status = Math.max(status, phase);
    if (n === cycles) break;
    const result = { cycle: n + 1, ...(await stopAndStart(id, stopTime)) };
    ctx.summary.stops.push(result);
    fs.writeFileSync(path.join(dir, `stop-${n + 1}.json`), `${JSON.stringify(result, null, 2)}\n`);
    saveLogs(ctx, `compose-after-stop-${n + 1}.log`);
  }
  return status;
}
