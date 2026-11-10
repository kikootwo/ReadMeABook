/**
 * Component: E2E stop flow (container stopped and started between spec phases)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * --stop-specs <a,b> --stop-cycles <n> [--stop-time <s>]: phases stop-0 … stop-<n> run the given specs
 * (each reads E2E_PHASE); between two phases the harness runs a timed `docker stop --time <s>` on this
 * run's own rmab container (found by compose project + service + harness label, never by a name from a
 * spec), saves its exit code and the logs, starts it again and waits for Docker's health status.
 * Results go to summary.json (`stops`) and stop/stop-<i>.json for the next phase.
 * Times per stop, all from Docker's `kill` event for the stop signal (SIGTERM) and on the daemon's clock:
 *   appStopSeconds        to the wrapper's `[App] node exited` line (`docker logs --timestamps`): the app's own part
 *   containerStopSeconds  to the container's exit (`State.FinishedAt`, containerd's exit time): the whole container
 *   pgCheckpointSeconds   PostgreSQL's shutdown checkpoint (`total=` of its log line): the part a slow disk stretches
 * The kill event is logged just after Docker sends the signal (moby kill.go), so both times can read a few
 * ms short. Events come from a `docker events` stream started (and seen live) before the stop and ended
 * after FinishedAt is read, never from the daemon's replay buffer (its last 256 events, which the other
 * stacks' execs can push the kill out of). `killToDieSeconds` (to Docker's `die` event) and `stopSeconds`
 * (the docker CLI's wall time on the host) also count the daemon's work after the exit, which a busy
 * machine stretches by seconds; they are recorded only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { LABEL, childEnv, run } from './docker.mjs';

const HEALTH_TIMEOUT_MS = 180_000;
const STOP_SIGNAL = '15'; // SIGTERM, Docker's default: dockerfile.unified sets no STOPSIGNAL
const EVENT_FORMAT = '{{.TimeNano}} {{.Actor.ID}} {{.Action}} {{index .Actor.Attributes "signal"}}';
const APP_EXITED = '[App] node exited';
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

const byNs = (a, b) => (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0);

/**
 * Docker events (`<TimeNano> <Actor.ID> <Action> <signal>` lines) + the container's FinishedAt → its last
 * stop: the first `kill` with the stop signal (15) after any earlier `die` and not after the exit, to the
 * exit. A kill with another signal (Docker's follow-up SIGKILL at the timeout) is never timed: with the
 * SIGTERM unseen the reading is null. Lines for other containers and other actions are ignored. `seconds`
 * is null when that kill or the exit is missing; `killToDieSeconds` when it or the die is. `killNs` (BigInt
 * or null) is for parseStopLogs, not for JSON.
 */
export function parseStopEvents(text, id, finishedAt) {
  const events = String(text || '').split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter(([ns, actor, action]) =>
    /^\d+$/.test(ns ?? '') && id && actor?.startsWith(id) && (action === 'kill' || action === 'die'))
    .map(([ns, , action, signal = '']) => ({ ns: BigInt(ns), action, signal })).sort(byNs);
  const exited = rfc3339Ns(finishedAt);
  const after = exited === null ? -1n : events.filter((e) => e.action === 'die' && e.ns < exited).at(-1)?.ns ?? -1n;
  const kill = exited === null ? undefined
    : events.find((e) => e.action === 'kill' && e.signal === STOP_SIGNAL && e.ns > after && e.ns <= exited);
  const die = kill && events.find((e) => e.action === 'die' && e.ns >= kill.ns);
  return {
    seconds: kill ? secondsBetween(kill.ns, exited) : null,
    killToDieSeconds: die ? secondsBetween(kill.ns, die.ns) : null,
    killNs: kill ? kill.ns : null,
    events: events.map((e) => `${e.ns} ${e.action}${e.signal ? ` ${e.signal}` : ''}`),
  };
}

/**
 * `docker logs --timestamps` text (each line led by the daemon's RFC 3339 receive time) + the stop
 * signal's kill (`killNs`) → the app's part of the stop: kill to the earliest `[App] node exited` line at
 * or after it (app-start.sh logs it once node has exited; a line from an earlier start or from a crash
 * before the stop is ignored), and PostgreSQL's shutdown checkpoint (`total=` of the first `checkpoint
 * complete` after `checkpoint starting: shutdown`). The receive time trails the write slightly, so the
 * app's part never reads short. Nulls when the kill or the line is missing.
 */
export function parseStopLogs(text, killNs) {
  const none = { appSeconds: null, appLine: null, pgCheckpointSeconds: null };
  if (typeof killNs !== 'bigint') return none;
  const rows = String(text || '').split(/\r?\n/).map((l) => {
    const m = /^(\S+) (.*)$/.exec(l.trim());
    const ns = m ? rfc3339Ns(m[1]) : null;
    return ns === null ? null : { ns, line: l.trim() };
  }).filter((r) => r && r.ns >= killNs).sort(byNs);
  const exited = rows.find((r) => r.line.includes(APP_EXITED));
  const ckptStart = rows.find((r) => r.line.includes('checkpoint starting: shutdown'));
  const ckpt = ckptStart && rows.find((r) => r.ns >= ckptStart.ns && /checkpoint complete:.* total=\d+(\.\d+)? s/.test(r.line));
  return {
    appSeconds: exited ? secondsBetween(killNs, exited.ns) : null,
    appLine: exited ? exited.line.slice(0, 200) : null,
    pgCheckpointSeconds: ckpt ? Number(/ total=(\d+(?:\.\d+)?) s/.exec(ckpt.line)[1]) : null,
  };
}

/** The container's log lines (stdout and stderr) since `since`, with the daemon's timestamps; '' if unread. */
function containerLogs(id, since) {
  if (rfc3339Ns(since) === null) return '';
  const res = spawnSync('docker', ['logs', '--timestamps', '--since', since, id], {
    env: childEnv(), encoding: 'utf8', timeout: 60_000, maxBuffer: 256 * 1024 * 1024,
  });
  return `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
}

/**
 * A live `docker events` stream for one container (kill, die, exec_die). `live()` runs `docker exec <id>
 * true` and waits for its exec_die, so the stream is known to be subscribed before the stop is sent.
 */
function eventStream(id) {
  let text = '';
  const child = spawn('docker', [
    'events', '--filter', `container=${id}`, '--filter', 'event=kill', '--filter', 'event=die', '--filter', 'event=exec_die',
    '--format', EVENT_FORMAT,
  ], { env: childEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
  const closed = new Promise((resolve) => child.on('close', resolve));
  child.on('error', () => {}); // no stream: the readings stay null and the spec fails
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { text += chunk; });
  const waitFor = async (re, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    while (!re.test(text)) {
      if (Date.now() > end) return false;
      await sleep(50);
    }
    return true;
  };
  return {
    text: () => text,
    waitFor,
    async live() {
      run('docker', ['exec', id, 'true'], { allowFail: true, quiet: true, timeoutMs: 30_000 });
      return waitFor(/ exec_die\b/, 15_000);
    },
    async stop() {
      child.kill();
      await Promise.race([closed, sleep(5000)]);
    },
  };
}

/** Timed stop + start of the rmab container; returns what the next phase and summary.json need. */
export async function stopAndStart(id, stopTime) {
  const startedAt = new Date().toISOString();
  const stream = eventStream(id);
  const streamLive = await stream.live();
  const t0 = process.hrtime.bigint();
  run('docker', ['stop', '--time', String(stopTime), id]);
  const stopSeconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const [code, started, finished] = inspect(id, '{{.State.ExitCode}} {{.State.StartedAt}} {{.State.FinishedAt}}').split(/\s+/);
  // The die is logged after the exit, seconds late on a busy host; recorded only, so wait for it briefly
  await stream.waitFor(/^\d+ \S+ die\b/m, 5000);
  await stream.stop();
  const container = parseStopEvents(stream.text(), id, finished);
  const app = parseStopLogs(containerLogs(id, started), container.killNs);
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
    startedAt, stopTime, appStopSeconds: app.appSeconds, containerStopSeconds: container.seconds,
    pgCheckpointSeconds: app.pgCheckpointSeconds, killToDieSeconds: container.killToDieSeconds,
    stopSeconds: Math.round(stopSeconds * 100) / 100, exitedAt: rfc3339Ns(finished) === null ? null : finished,
    appExitLine: app.appLine, stopEvents: container.events, streamLive,
    exitCode: /^\d+$/.test(code ?? '') ? Number(code) : null, // unread is null, never 0
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
