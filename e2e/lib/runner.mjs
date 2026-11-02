/**
 * Component: E2E Playwright runner container + host-side stack checks (recorder, canary, isolation, row counts)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Playwright and Chromium run ONLY inside the pinned runner image, on the stack + control networks, as
 * pwuser with all capabilities dropped. Nothing from a branch is executed on the host.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { E2E_DIR, LABEL, run, compose, log, childEnv } from './docker.mjs';

const RUNNER_TIMEOUT_MS = 45 * 60_000;

export function newControlToken() {
  return randomBytes(24).toString('hex');
}

/** Files in the runner build context that git doesn't track (they would be baked into the runner image). */
export function untrackedHarnessFiles() {
  const out = run('git', ['-C', E2E_DIR, 'status', '--porcelain', '--untracked-files=all', '--', 'specs', 'lib', 'bootstrap.ts', 'playwright.config.ts'], { capture: true, allowFail: true, quiet: true });
  return out.split(/\r?\n/).filter((l) => l.startsWith('??')).map((l) => l.slice(3));
}

export function buildRunnerImage(slug, { allowUntracked = false } = {}) {
  const untracked = untrackedHarnessFiles();
  if (untracked.length && !allowUntracked) {
    throw new Error(`untracked files would be baked into the runner image: ${untracked.join(', ')} (commit, remove, or pass --allow-untracked)`);
  }
  const tag = `rmab-e2e/runner:${slug}`;
  run('docker', ['build', '-f', path.join(E2E_DIR, 'runner', 'Dockerfile'), '-t', tag, '--label', LABEL, '--label', `rmab-e2e.slug=${slug}`, E2E_DIR]);
  return tag;
}

/**
 * Run Playwright in a fresh runner container and copy /evidence out. Returns
 * { status, bootstrapped } where bootstrapped=false means globalSetup never finished (harness error).
 */
export async function runPlaywright({ image, project, evidence, env, specs, phase }) {
  const name = `${project}-runner-${Date.now()}`;
  // Env goes through a file so tokens/creds never appear in commands.log or `ps`.
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-e2e-env-')), 'runner.env');
  fs.writeFileSync(envFile, Object.entries({ ...env, E2E_PHASE: phase }).map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, ' ')}`).join('\n'));
  let status = 2;
  let bootstrapped = false;
  try {
    run('docker', [
      'create', '--name', name, '--network', `${project}_stack`,
      '--user', 'pwuser', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '4g', '--pids-limit', '2048', '--shm-size', '1g', '--init',
      '--label', LABEL, '--env-file', envFile,
      image, 'npx', 'playwright', 'test', '-c', 'playwright.config.ts', ...specs, '--project', 'chromium',
    ], { quiet: false });
    run('docker', ['network', 'connect', `${project}_control`, name]);
    log(`$ playwright test ${specs.join(' ')} (container ${name}, phase ${phase})`);
    // Async: the host exec bridge (untainted runs) must keep serving while the runner works.
    status = await new Promise((resolve) => {
      const child = spawn('docker', ['start', '-a', name], { env: childEnv(), stdio: 'inherit' });
      const timer = setTimeout(() => child.kill(), RUNNER_TIMEOUT_MS);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
    });
    run('docker', ['cp', `${name}:/evidence/.`, evidence], { allowFail: true });
    bootstrapped = fs.existsSync(path.join(evidence, 'bootstrap-ok'));
    fs.rmSync(path.join(evidence, 'bootstrap-ok'), { force: true });
  } finally {
    run('docker', ['rm', '-f', name], { allowFail: true, quiet: true });
    fs.rmSync(path.dirname(envFile), { recursive: true, force: true });
  }
  return { status, bootstrapped };
}

/** Recorder dump via fake-arr itself (control is not published to the host). */
export function saveRecorder({ project, env, token, file }) {
  const out = compose(project, ['exec', '-T', 'fake-arr', 'wget', '-qO-', '--header', `x-control-token: ${token}`, 'http://127.0.0.1:9999/__control/requests'], env, { capture: true, allowFail: true, quiet: true });
  fs.writeFileSync(file, out || '[]');
}

/** Lines of the rmab service log that contain the Prowlarr canary key. */
export function canaryLines(composeLog, key) {
  return composeLog.split(/\r?\n/).filter((l) => /^rmab[-\s]/.test(l) && l.includes(key));
}

/**
 * Tainted-mode isolation probes, run inside the rmab container (its own curl). Every probe must FAIL to
 * connect, except the control port which must answer 401 and the proxy which must 403 a non-allowlisted host.
 */
export function isolationProbes({ project, env }) {
  const curl = (args) => {
    const out = compose(project, ['exec', '-T', 'rmab', 'curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--noproxy', '*', '-m', '6', ...args], env, { capture: true, allowFail: true, quiet: true });
    return out || '000';
  };
  const viaProxy = (url) => compose(project, ['exec', '-T', 'rmab', 'curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '-x', 'http://egress-proxy:3128', '-m', '15', url], env, { capture: true, allowFail: true, quiet: true }) || '000';
  const probes = [
    { name: 'host.docker.internal (host)', got: curl(['http://host.docker.internal:3401/']), expect: '000' },
    { name: 'Docker bridge gateway 172.17.0.1', got: curl(['http://172.17.0.1/']), expect: '000' },
    { name: 'LAN 192.168.1.1', got: curl(['http://192.168.1.1/']), expect: '000' },
    { name: 'LAN 192.168.0.1', got: curl(['http://192.168.0.1/']), expect: '000' },
    { name: 'LAN 10.0.0.1', got: curl(['http://10.0.0.1/']), expect: '000' },
    { name: 'internet 1.1.1.1:443 direct', got: curl(['https://1.1.1.1/']), expect: '000' },
    { name: 'fake-arr control without token', got: curl(['http://fake-arr:9999/__control/requests']), expect: '401' },
    { name: 'egress proxy: non-allowlisted host', got: viaProxy('http://example.com/'), expect: '403' },
    { name: 'egress proxy: allowlisted api.audnex.us', got: viaProxy('https://api.audnex.us/books/B08G9PRS1K'), expect: '200' },
  ];
  for (const p of probes) p.ok = p.got === p.expect;
  return probes;
}

/** Exact row count of every table in RMAB's public schema (bundled Postgres via docker exec). */
export function tableRowCounts({ project, env }) {
  const sql =
    "select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text " +
    "from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1";
  const out = compose(project, ['exec', '-T', 'rmab', 'gosu', 'postgres', 'psql', '-d', 'readmeabook', '-At', '-c', sql], env, { capture: true, quiet: true });
  const counts = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^([a-z_][a-z0-9_]*)=(\d+)$/.exec(line.trim());
    if (m) counts[m[1]] = Number(m[2]);
  }
  return counts;
}

/** Counts that stop moving: three identical snapshots of `tables` in a row (max ~2 min). */
export async function stableRowCounts(ctx, tables) {
  let last = null;
  let same = 0;
  for (let i = 0; i < 40; i++) {
    const counts = tableRowCounts(ctx);
    const key = JSON.stringify(tables.map((t) => counts[t] ?? -1));
    same = key === last ? same + 1 : 0;
    last = key;
    if (same >= 2) return counts;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`row counts for ${tables.join(', ')} did not settle`);
}

// Rows that must survive an upgrade unchanged; every other table may only grow (jobs, events, caches).
export const EXACT_TABLES = ['users', 'audiobooks', 'requests', 'download_history', 'api_tokens', 'blocked_releases'];

export function compareUpgradeCounts(before, after) {
  const problems = [];
  for (const t of EXACT_TABLES) if (t in before && before[t] !== after[t]) problems.push(`${t}: ${before[t]} -> ${after[t] ?? 'missing'}`);
  for (const [t, n] of Object.entries(before)) if ((after[t] ?? -1) < n) problems.push(`${t} shrank: ${n} -> ${after[t] ?? 'missing'}`);
  return [...new Set(problems)];
}
