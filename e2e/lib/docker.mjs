/**
 * Component: E2E harness Docker helpers (minimal-env docker/compose, labelled images, cleanup, disk ceiling)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Everything here runs from the trusted checkout. A branch under test only supplies a Docker build
 * context; its code runs only inside containers (image build, the RMAB container, the unit container).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const E2E_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO = path.dirname(E2E_DIR);
export const COMPOSE_FILE = path.join(E2E_DIR, 'compose.yml');
export const TAINTED_FILE = path.join(E2E_DIR, 'compose.tainted.yml');
export const ENV_FILE = path.join(E2E_DIR, '.env.test');
export const LABEL = 'rmab-e2e=true';
export const PREVIEW_PROJECT = 'rmab-e2e-preview';
const DISK_CEILING_GB = 50;
const BUILD_CACHE_CAP = '15gb';

// Host variables docker/compose legitimately need (daemon selection, Windows/Docker Desktop plumbing).
// Everything else is dropped so the host environment can't override .env.test or compose variables.
const PASSTHROUGH = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles',
  'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'BUILDKIT_PROGRESS',
];

let commandLog = null;
export function setCommandLog(file) {
  commandLog = file;
}

export function log(line) {
  console.log(`[e2e] ${line}`);
  if (commandLog) fs.appendFileSync(commandLog, `[${new Date().toISOString()}] ${line}\n`);
}

/** Read KEY=VALUE pairs from e2e/.env.test. */
export function readEnvFile(file = ENV_FILE) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Minimal child environment: passthrough allowlist + every .env.test key + explicit extras. */
export function childEnv(extra = {}) {
  const base = {};
  for (const k of PASSTHROUGH) if (process.env[k] !== undefined) base[k] = process.env[k];
  return { ...base, ...readEnvFile(), ...extra };
}

/** Run a command. capture=true returns stdout; allowFail=true never throws. Never logs env values. */
export function run(cmd, args, { capture = false, allowFail = false, env, input, quiet = false, timeoutMs } = {}) {
  if (!quiet) log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    env: childEnv(env),
    encoding: 'utf8',
    input,
    timeout: timeoutMs,
    maxBuffer: 512 * 1024 * 1024,
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
  });
  if (res.error && !allowFail) throw res.error;
  if (res.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.slice(0, 4).join(' ')}... exited ${res.status}${res.stderr ? `: ${res.stderr.trim().slice(-2000)}` : ''}`);
  }
  return capture ? (res.stdout || '').trim() : res.status ?? 1;
}

export const OVERRIDES_DIR = path.join(E2E_DIR, 'overrides');

/** Trusted compose overrides by name (e2e/overrides/<name>.yml); untainted runs only. */
export function overrideFiles(names) {
  return String(names || '').split(',').map((n) => n.trim()).filter(Boolean).map((n) => {
    if (!/^[a-z0-9-]+$/.test(n)) throw new Error(`invalid override name ${n}`);
    const file = path.join(OVERRIDES_DIR, `${n}.yml`);
    if (!fs.existsSync(file)) throw new Error(`unknown override ${n} (see e2e/overrides/)`);
    return file;
  });
}

export function composeArgs(project, args, { tainted = false, overrides = '' } = {}) {
  const extra = overrideFiles(overrides).flatMap((f) => ['-f', f]);
  return ['compose', '-p', project, '-f', COMPOSE_FILE, ...extra, ...(tainted ? ['-f', TAINTED_FILE] : []), '--env-file', ENV_FILE, ...args];
}

export function compose(project, args, env, opts = {}) {
  return run('docker', composeArgs(project, args, { tainted: env?.E2E_TAINTED === '1', overrides: env?.E2E_OVERRIDES }), { env, ...opts });
}

export function imageExists(ref) {
  return spawnSync('docker', ['image', 'inspect', ref], { stdio: 'ignore', env: childEnv() }).status === 0;
}

export function imageLabel(ref, label) {
  return run('docker', ['image', 'inspect', '-f', `{{index .Config.Labels "${label}"}}`, ref], { capture: true, allowFail: true, quiet: true });
}

/** True only for images the harness built (label rmab-e2e=true); everything else is never removed. */
export function isHarnessImage(ref) {
  return imageExists(ref) && imageLabel(ref, 'rmab-e2e') === 'true';
}

export function removeHarnessImage(ref, warn = log) {
  if (!imageExists(ref)) return;
  if (!isHarnessImage(ref)) {
    warn(`not removing ${ref}: it has no rmab-e2e=true label`);
    return;
  }
  run('docker', ['image', 'rm', ref], { allowFail: true });
}

export function imageSize(ref) {
  const bytes = Number(run('docker', ['image', 'inspect', '-f', '{{.Size}}', ref], { capture: true, allowFail: true, quiet: true }));
  return Number.isFinite(bytes) && bytes > 0 ? `${(bytes / 1e9).toFixed(2)} GB` : 'unknown';
}

export function gitShortSha(dir) {
  return run('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { capture: true, quiet: true });
}

/**
 * Build the RMAB image. `worktree` is only the build context. `network: 'none'` disables network for
 * every RUN step (used for --pr-dockerfile builds of tainted code).
 */
export function buildRmabImage({ worktree, dockerfile, tag, slug, network }) {
  const sha = gitShortSha(worktree);
  run('docker', [
    'build', '-f', dockerfile, '-t', tag,
    ...(network ? ['--network', network] : []),
    '--label', LABEL, '--label', `rmab-e2e.slug=${slug}`, '--label', `rmab-e2e.sha=${sha}`,
    '--build-arg', `GIT_COMMIT=${sha}`, '--build-arg', `APP_VERSION=e2e-${sha}`,
    '--build-arg', `BUILD_DATE=${new Date().toISOString()}`,
    worktree,
  ]);
  return { tag, sha };
}

/** `docker builder prune` flag that caps the cache (renamed in newer Docker releases). */
function builderPruneArgs() {
  const help = run('docker', ['builder', 'prune', '--help'], { capture: true, allowFail: true, quiet: true });
  if (help.includes('--max-used-space')) return ['builder', 'prune', '-f', '--max-used-space', BUILD_CACHE_CAP];
  return ['builder', 'prune', '-f', '--keep-storage', BUILD_CACHE_CAP];
}

const UNIT = { B: 1, KB: 1e3, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
function parseSize(s) {
  const m = /^([\d.]+)\s*([kKMGT]?B)/.exec(String(s).trim());
  return m ? Number(m[1]) * (UNIT[m[2]] || UNIT[m[2].toUpperCase()] || 1) : 0;
}

/** One `docker system df` call: totals in GB plus a printable table. */
export function dockerDf() {
  const raw = run('docker', ['system', 'df', '--format', '{{json .}}'], { capture: true, allowFail: true, quiet: true });
  const rows = raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const get = (type) => parseSize(rows.find((r) => r.Type === type)?.Size || '0B') / 1e9;
  const result = { images: get('Images'), containers: get('Containers'), volumes: get('Local Volumes'), buildCache: get('Build Cache') };
  result.total = result.images + result.volumes + result.buildCache;
  result.table = ['TYPE TOTAL ACTIVE SIZE RECLAIMABLE', ...rows.map((r) => `${r.Type} ${r.TotalCount} ${r.Active} ${r.Size} ${r.Reclaimable}`)].join('\n');
  return result;
}

/**
 * Remove rmab-e2e-* LEFTOVERS only (pool-safe: other slots may be mid-run on the same daemon).
 * - A stack is a leftover when none of its containers is running (stopped containers or orphan volumes).
 * - Images: only rmab-e2e/* images labelled with this run's slug, plus our dangling images.
 * The preview stack and `protect` refs are never touched; other teams' images are never removed.
 */
export function pruneLeftovers({ slug, protect = [] } = {}) {
  const list = (args) => run('docker', args, { capture: true, allowFail: true, quiet: true }).split(/\r?\n/).filter(Boolean);
  const label = '{{.Label "com.docker.compose.project"}}';
  const running = new Set(list(['ps', '--filter', 'label=com.docker.compose.project', '--format', label]));
  const projects = new Set(
    [...list(['ps', '-a', '--filter', 'label=com.docker.compose.project', '--format', label]), ...list(['volume', 'ls', '--format', label])]
      .filter((p) => p.startsWith('rmab-e2e-') && p !== PREVIEW_PROJECT && !running.has(p))
  );
  for (const project of projects) {
    // Always pass our compose file: never let compose pick up a compose file from the cwd.
    compose(project, ['down', '-v', '--remove-orphans'], { E2E_SLUG: project.replace(/^rmab-e2e-/, ''), RMAB_IMAGE: 'unused', RMAB_PORT: '0', CONTROL_TOKEN: 'unused' }, { allowFail: true });
    for (const v of list(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])) run('docker', ['volume', 'rm', v], { allowFail: true });
  }
  if (slug) {
    for (const ref of list(['images', '--filter', `label=rmab-e2e.slug=${slug}`, '--format', '{{.Repository}}:{{.Tag}}']).filter((r) => r.startsWith('rmab-e2e/') && !protect.includes(r))) {
      removeHarnessImage(ref);
    }
  }
  run('docker', ['image', 'prune', '-f', '--filter', `label=${LABEL}`], { allowFail: true });
  run('docker', builderPruneArgs(), { allowFail: true });
}

/** Disk ceiling check before a build: prune (incl. the build cache) only when images + cache + volumes exceed 50 GB. */
export function enforceDiskCeiling({ slug, protect, warn }) {
  const df = dockerDf();
  if (df.total > DISK_CEILING_GB) {
    warn(`docker system df total ${df.total.toFixed(1)} GB > ${DISK_CEILING_GB} GB: pruning rmab-e2e leftovers and the build cache`);
    pruneLeftovers({ slug, protect });
  }
  return df;
}

/**
 * Per-run cleanup (runs in `finally`, incl. failures and Ctrl-C): down -v, images this run built
 * (label-checked), images this run pulled that were not present before, our dangling images.
 */
export function cleanupRun({ project, env, images = [], pulled = [], warn = log }) {
  compose(project, ['down', '-v', '--remove-orphans'], env, { allowFail: true });
  for (const ref of images) removeHarnessImage(ref, warn);
  for (const ref of pulled) run('docker', ['image', 'rm', ref], { allowFail: true });
  run('docker', ['image', 'prune', '-f', '--filter', `label=${LABEL}`], { allowFail: true });
}
