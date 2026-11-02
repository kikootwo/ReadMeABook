/**
 * Component: E2E stop flow (container stopped and started between spec phases)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * --stop-specs <a,b> --stop-cycles <n> [--stop-time <s>]: phases stop-0 … stop-<n> run the given specs
 * (each reads E2E_PHASE); between two phases the harness runs a timed `docker stop --time <s>` on this
 * run's own rmab container (found by compose project + service + harness label, never by a name from a
 * spec), saves its exit code and the logs, starts it again and waits for Docker's health status.
 * Results go to summary.json (`stops`) and stop/stop-<i>.json for the next phase.
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

/** Timed stop + start of the rmab container; returns what the next phase and summary.json need. */
export async function stopAndStart(id, stopTime) {
  const startedAt = new Date().toISOString();
  const t0 = process.hrtime.bigint();
  run('docker', ['stop', '--time', String(stopTime), id]);
  const stopSeconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const exitCode = Number(inspect(id, '{{.State.ExitCode}}'));
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
    startedAt, stopTime, stopSeconds: Math.round(stopSeconds * 100) / 100, exitCode,
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
