#!/usr/bin/env node
/**
 * Component: E2E harness runner (stack / unit / preview / down)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run from a TRUSTED checkout. A branch is passed with --worktree and only ever used as a Docker build
 * context; Playwright runs in the pinned runner container. Cleanup runs after every stack/unit run,
 * including failures. Exit codes: 0 pass, 1 spec/assertion failure, 2 harness error (build, compose,
 * image fetch, bootstrap), 130 interrupted.
 *
 *   npm run e2e -- --slug <s> --port <3401-3499> (--image <ref> | --worktree <dir> --trusted) [options]
 *   npm run e2e:unit -- --slug <s> --worktree <dir> --trusted
 *   (--tainted / --pr-dockerfile are disabled until build-time isolation lands; see e2e-harness.md)
 *   npm run e2e -- preview --image <ref> [--replace-image <old ref>]
 *   npm run e2e -- down --slug <s>
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  E2E_DIR, REPO, LABEL, PREVIEW_PROJECT, run, compose, readEnvFile, imageExists, imageSize, isHarnessImage,
  removeHarnessImage, buildRmabImage, gitShortSha, enforceDiskCeiling, cleanupRun, dockerDf, setCommandLog, childEnv, log,
} from './lib/docker.mjs';
import { parseArgs, evidenceDir, USAGE } from './lib/args.mjs';
import {
  newControlToken, buildRunnerImage, runPlaywright, saveRecorder, canaryLines, isolationProbes,
  stableRowCounts, tableRowCounts, compareUpgradeCounts, EXACT_TABLES,
} from './lib/runner.mjs';
import { fetchAndLoad } from './lib/fetch-image.mjs';
import { startExecBridge } from './lib/exec-bridge.mjs';

const RELEASE_REPO = 'ghcr.io/kikootwo/readmeabook';
const UNIT_TIMEOUT_MS = 30 * 60_000;

class HarnessError extends Error {}

/** SIGINT/SIGTERM: remember, let the current child exit, then the caller's finally cleans up. */
function trapSignals(onSignal) {
  const handler = () => onSignal();
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}

function stackEnv(opts, token) {
  return {
    E2E_SLUG: opts.slug,
    RMAB_PORT: opts.port,
    RMAB_IMAGE: 'unset',
    E2E_SCENARIO: opts.scenario,
    FAKE_ARR_TAG: opts.slug,
    FIXTURE_METADATA: opts['offline-fixtures'] ? 'test/offline-metadata.json' : '',
    CONTROL_TOKEN: token,
    E2E_TAINTED: opts.tainted ? '1' : '0',
    E2E_OVERRIDES: opts.overrides || '',
  };
}

function runnerEnv(ctx) {
  return {
    ...readEnvFile(),
    E2E_SLUG: ctx.opts.slug,
    E2E_BASE_URL: 'http://rmab:3030',
    E2E_CONTROL_URL: 'http://fake-arr:9999',
    E2E_CONTROL_TOKEN: ctx.token,
    E2E_ABS_URL: 'http://abs:80',
    E2E_BACKEND: ctx.opts.backend,
    E2E_EVIDENCE_DIR: '/evidence',
    E2E_RMAB_IMAGE: ctx.env.RMAB_IMAGE,
    E2E_TAINTED_RUN: ctx.opts.tainted ? '1' : '0',
    // Untainted runs only: the host exec bridge (docker exec into the stack for trusted specs).
    ...(ctx.bridge ? { E2E_EXEC_BRIDGE_URL: ctx.bridge.url, E2E_EXEC_TOKEN: ctx.bridge.token } : {}),
  };
}

function up(ctx, rmabImage, { generatedSecrets = false } = {}) {
  ctx.env.RMAB_IMAGE = rmabImage;
  if (generatedSecrets) Object.assign(ctx.env, { RMAB_JWT_SECRET: '', RMAB_JWT_REFRESH_SECRET: '', RMAB_CONFIG_ENCRYPTION_KEY: '', RMAB_POSTGRES_PASSWORD: '' });
  if (compose(ctx.project, ['up', '-d', '--no-build'], ctx.env, { allowFail: true }) !== 0) throw new HarnessError('compose up failed');
}

/** Run one Playwright phase; harness errors (no bootstrap) become exit 2. */
async function playwright(ctx, specs, phase, extraEnv = {}) {
  const { status, bootstrapped } = await runPlaywright({ image: ctx.runner, project: ctx.project, evidence: ctx.evidence, env: { ...runnerEnv(ctx), ...extraEnv }, specs, phase });
  if (status !== 0 && !bootstrapped) throw new HarnessError(`bootstrap failed in phase ${phase} (see results-${phase}.json / test-results-${phase})`);
  return status === 0 ? 0 : 1;
}

function saveLogs(ctx, file) {
  const logs = compose(ctx.project, ['logs', '--no-color', '--timestamps'], ctx.env, { capture: true, allowFail: true, quiet: true });
  fs.writeFileSync(path.join(ctx.evidence, file), logs);
  return logs;
}

async function obtainImages(ctx) {
  const { opts } = ctx;
  let image = opts.image;
  if (image) {
    if (!imageExists(image)) throw new HarnessError(`image ${image} not found locally`);
    if (opts['rm-image']) {
      if (!isHarnessImage(image)) throw new HarnessError(`--rm-image refused: ${image} has no ${LABEL} label`);
      ctx.created.push(image);
    }
  } else {
    image = `rmab-e2e/${opts.slug}:${gitShortSha(opts.worktree)}`;
    ctx.created.push(image);
    // Tainted: trusted dockerfile.unified from this checkout unless --pr-dockerfile (then no network).
    const dockerfile = opts.tainted && !opts['pr-dockerfile'] ? path.join(REPO, 'dockerfile.unified') : path.resolve(opts.dockerfile || path.join(opts.worktree, 'dockerfile.unified'));
    ctx.summary.dockerfile = dockerfile;
    try {
      buildRmabImage({ worktree: opts.worktree, dockerfile, tag: image, slug: opts.slug, network: opts['pr-dockerfile'] ? 'none' : undefined });
    } catch (error) {
      throw new HarnessError(`image build failed: ${error.message}`);
    }
  }
  ctx.summary.image = image;
  ctx.sizeRefs.push(image);
  if (compose(ctx.project, ['build', 'fake-arr'], ctx.env, { allowFail: true }) !== 0) throw new HarnessError('fake-arr build failed');
  ctx.created.push(`rmab-e2e/fake-arr:${opts.slug}`);
  try {
    ctx.runner = buildRunnerImage(opts.slug, { allowUntracked: !!opts['allow-untracked'] });
  } catch (error) {
    throw new HarnessError(error.message);
  }
  ctx.created.push(ctx.runner);
  ctx.sizeRefs.push(`rmab-e2e/fake-arr:${opts.slug}`, ctx.runner);
  return image;
}

async function upgradeFlow(ctx, image) {
  const oldRef = `${RELEASE_REPO}:${ctx.opts['upgrade-from'].replace(/^v/, '')}`;
  if (!imageExists(oldRef)) {
    if (run('docker', ['pull', oldRef], { allowFail: true }) !== 0) {
      ctx.warn(`docker pull ${oldRef} failed; fetching it over the registry API (digest-verified)`);
      try {
        await fetchAndLoad(oldRef);
      } catch (error) {
        throw new HarnessError(`could not obtain ${oldRef}: ${error.message}`);
      }
    }
    ctx.pulled.push(oldRef);
  }
  ctx.sizeRefs.push(oldRef);
  ctx.summary.upgradeFrom = oldRef;
  // Phase 1: release image on fresh volumes with image-generated secrets (the real upgrade path).
  up(ctx, oldRef, { generatedSecrets: true });
  let status = await playwright(ctx, ['upgrade.spec.ts'], 'upgrade-seed');
  if (status !== 0) return status;
  const before = await stableRowCounts(ctx, EXACT_TABLES);
  fs.mkdirSync(path.join(ctx.evidence, 'upgrade'), { recursive: true });
  fs.writeFileSync(path.join(ctx.evidence, 'upgrade', 'before-counts.json'), JSON.stringify(before, null, 2));
  saveLogs(ctx, 'compose-phase1.log'); // before the old container is removed
  compose(ctx.project, ['stop', 'rmab'], ctx.env);
  compose(ctx.project, ['rm', '-f', 'rmab'], ctx.env);
  // Phase 2: branch image on the same volumes.
  up(ctx, image, { generatedSecrets: true });
  const statuses = JSON.parse(fs.readFileSync(path.join(ctx.evidence, 'upgrade', 'before.json'), 'utf8')).statuses;
  status = await playwright(ctx, ['upgrade.spec.ts'], 'upgrade-verify', { E2E_UPGRADE_BEFORE: JSON.stringify({ statuses }) });
  const after = tableRowCounts(ctx);
  fs.writeFileSync(path.join(ctx.evidence, 'upgrade', 'after-counts.json'), JSON.stringify(after, null, 2));
  const problems = compareUpgradeCounts(before, after);
  ctx.summary.upgradeRowCounts = problems.length ? { ok: false, problems } : { ok: true };
  return problems.length ? 1 : status;
}

async function finish(ctx, status) {
  const logs = saveLogs(ctx, 'compose.log');
  saveRecorder({ project: ctx.project, env: ctx.env, token: ctx.token, file: path.join(ctx.evidence, 'fake-arr-requests.json') });
  // Every stack of the run counts (isolated specs each had their own stack and logs).
  const leaks = canaryLines([...ctx.priorLogs, logs].join('\n'), readEnvFile().PROWLARR_API_KEY);
  ctx.summary.canaryInRmabLogs = leaks.slice(0, 20);
  if (leaks.length && status === 0) {
    if (ctx.opts['allow-log-canary']) ctx.warn(`${leaks.length} rmab log line(s) contain the Prowlarr canary key (allowed by --allow-log-canary)`);
    else {
      ctx.summary.error = `${leaks.length} rmab log line(s) contain the Prowlarr API key canary`;
      status = 1;
    }
  }
  return status;
}

async function stackOrPreview(opts) {
  const evidence = evidenceDir(opts);
  setCommandLog(path.join(evidence, 'commands.log'));
  const project = opts.command === 'preview' ? PREVIEW_PROJECT : `rmab-e2e-${opts.slug}`;
  const token = newControlToken();
  const ctx = {
    opts, evidence, project, token, runner: null, sizeRefs: [], created: [], pulled: [], priorLogs: [], env: stackEnv(opts, token),
    summary: { command: opts.command, slug: opts.slug, project, tainted: !!opts.tainted, startedAt: new Date().toISOString(), warnings: [] },
  };
  ctx.warn = (msg) => {
    log(`WARNING ${msg}`);
    ctx.summary.warnings.push(msg);
  };
  let interrupted = false;
  const untrap = trapSignals(() => {
    interrupted = true;
    ctx.warn('interrupted: cleaning up');
  });
  let status = 2;
  try {
    ctx.summary.dfBeforeGB = enforceDiskCeiling({ slug: opts.slug, protect: opts.image ? [opts.image] : [], warn: ctx.warn }).total.toFixed(1);
    compose(project, ['down', '-v', '--remove-orphans'], ctx.env, { allowFail: true }); // fresh volumes every run
    const image = await obtainImages(ctx);
    if (interrupted) throw new HarnessError('interrupted');
    if (!opts.tainted) {
      ctx.bridge = await startExecBridge({ project, env: ctx.env });
      ctx.summary.execBridge = `on (127.0.0.1:${ctx.bridge.port})`;
    } else ctx.summary.execBridge = 'off (tainted)';
    if (opts['upgrade-from']) status = await upgradeFlow(ctx, image);
    else {
      const specs = opts.command === 'preview' ? ['preview-seed.spec.ts'] : opts.specs.split(',').map((s) => s.trim()).filter(Boolean);
      // --isolate-specs: one fresh stack (down -v, up) per spec filter, same images, one runner phase each.
      const groups = opts['isolate-specs'] && specs.length > 1 ? specs.map((s) => [s]) : [specs];
      status = 0;
      ctx.summary.specResults = {};
      for (const [n, group] of groups.entries()) {
        if (interrupted) throw new HarnessError('interrupted');
        const tag = groups.length > 1 ? `-${group[0].replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '')}` : '';
        if (n > 0) compose(project, ['down', '-v', '--remove-orphans'], ctx.env, { allowFail: true });
        up(ctx, image);
        const phase = opts.command === 'preview' ? 'preview' : `stack${tag}`;
        const result = await playwright(ctx, group, phase);
        ctx.summary.specResults[group.join(',')] = result === 0 ? 'pass' : 'fail';
        if (groups.length > 1) ctx.priorLogs.push(saveLogs(ctx, `compose${tag}.log`));
        status = Math.max(status, result);
      }
      if (opts.tainted || opts['isolation-check']) {
        const probes = isolationProbes({ project, env: ctx.env });
        fs.writeFileSync(path.join(evidence, 'isolation.json'), JSON.stringify(probes, null, 2));
        ctx.summary.isolation = probes.map((p) => `${p.ok ? 'ok' : 'FAIL'} ${p.name}: ${p.got} (want ${p.expect})`);
        if (probes.some((p) => !p.ok) && status === 0) status = 1;
      }
    }
    status = await finish(ctx, status);
  } catch (error) {
    log(error.message);
    ctx.summary.error = error.message;
    status = error instanceof HarnessError ? 2 : status === 0 ? 2 : status;
    if (ctx.runner || ctx.env.RMAB_IMAGE !== 'unset') saveLogs(ctx, 'compose.log');
  } finally {
    if (ctx.bridge) await ctx.bridge.close();
    ctx.summary.imageSizes = Object.fromEntries(ctx.sizeRefs.filter(imageExists).map((ref) => [ref, imageSize(ref)]));
    if (opts.command === 'preview') {
      // The preview stays up. The old image goes only if the new preview is healthy.
      const healthy = status === 0 && compose(project, ['exec', '-T', 'rmab', 'curl', '-sf', 'http://localhost:3030/api/health'], ctx.env, { allowFail: true, quiet: true, capture: true }) !== '';
      if (opts['replace-image'] && opts['replace-image'] !== opts.image) {
        if (healthy) removeHarnessImage(opts['replace-image'], ctx.warn);
        else ctx.warn(`kept ${opts['replace-image']}: new preview is not healthy`);
      }
      for (const ref of ctx.created.filter((r) => r.startsWith('rmab-e2e/runner:'))) removeHarnessImage(ref, ctx.warn);
    } else {
      cleanupRun({ project, env: ctx.env, images: ctx.created, pulled: ctx.pulled, warn: ctx.warn });
    }
    const df = dockerDf();
    fs.writeFileSync(path.join(evidence, 'docker-df.txt'), `${df.table}\n`);
    if (interrupted) status = 130;
    Object.assign(ctx.summary, { status, finishedAt: new Date().toISOString(), dfAfterGB: df.total.toFixed(1), removedImages: opts.command === 'preview' ? [] : [...ctx.created, ...ctx.pulled] });
    fs.writeFileSync(path.join(evidence, 'summary.json'), `${JSON.stringify(ctx.summary, null, 2)}\n`);
    log(`${status === 0 ? 'PASS' : 'FAIL'} (exit ${status}) — evidence: ${evidence}`);
    untrap();
  }
  return status;
}

function unit(opts) {
  const evidence = evidenceDir(opts);
  setCommandLog(path.join(evidence, 'commands.log'));
  const tag = `rmab-e2e/${opts.slug}-unit:${gitShortSha(opts.worktree)}`;
  const name = `rmab-e2e-${opts.slug}-unit-${Date.now()}`;
  let status = 2;
  let interrupted = false;
  const untrap = trapSignals(() => {
    interrupted = true;
    run('docker', ['rm', '-f', name], { allowFail: true, quiet: true });
  });
  try {
    enforceDiskCeiling({ slug: `${opts.slug}-unit`, warn: (m) => log(`WARNING ${m}`) });
    // Harness-owned Dockerfile + .dockerignore + engine fetcher from this trusted checkout; the worktree is context only.
    const built = run('docker', ['build', '-f', path.join(E2E_DIR, 'Dockerfile.test'), '--build-context', `harness=${path.join(E2E_DIR, 'unit')}`, '-t', tag, '--label', LABEL, '--label', `rmab-e2e.slug=${opts.slug}-unit`, opts.worktree], { allowFail: true });
    if (built !== 0) throw new HarnessError('unit image build failed');
    const res = spawnSync('docker', [
      'run', '--name', name, '--rm', '--network', 'none', '--user', 'node', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '6g', '--cpus', '4', '--pids-limit', '4096', tag,
    ], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: UNIT_TIMEOUT_MS, env: childEnv() });
    fs.writeFileSync(path.join(evidence, 'unit.log'), `${res.stdout || ''}\n${res.stderr || ''}`);
    process.stdout.write(`${(res.stdout || '').split(/\r?\n/).slice(-25).join('\n')}\n`);
    if (res.error) throw new HarnessError(`unit run failed: ${res.error.message}`);
    status = res.status === 0 ? 0 : 1;
  } catch (error) {
    log(error.message);
    status = 2;
  } finally {
    run('docker', ['rm', '-f', name], { allowFail: true, quiet: true });
    removeHarnessImage(tag);
    run('docker', ['image', 'prune', '-f', '--filter', `label=${LABEL}`], { allowFail: true });
    if (interrupted) status = 130;
    log(`unit ${status === 0 ? 'PASS' : 'FAIL'} (exit ${status}) — log: ${path.join(evidence, 'unit.log')}`);
    untrap();
  }
  return status;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (opts.command === 'down') {
    const project = `rmab-e2e-${opts.slug}`;
    const labelled = run('docker', ['images', '--filter', `label=rmab-e2e.slug=${opts.slug}`, '--format', '{{.Repository}}:{{.Tag}}'], { capture: true, allowFail: true, quiet: true }).split(/\r?\n/).filter(Boolean);
    cleanupRun({ project, env: { E2E_SLUG: opts.slug, RMAB_IMAGE: 'unused', RMAB_PORT: '0', CONTROL_TOKEN: 'unused', E2E_TAINTED: '1' }, images: labelled });
    return 0;
  }
  if (opts.command === 'unit') return unit(opts);
  return stackOrPreview(opts);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`[e2e] ${error.message}`);
    process.exit(2);
  }
);
