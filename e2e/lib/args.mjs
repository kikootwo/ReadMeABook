/**
 * Component: E2E runner argument parsing and safety checks (slugs, worktrees, tainted mode, evidence)
 * Documentation: documentation/testing/e2e-harness.md
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { E2E_DIR, REPO, run } from './docker.mjs';

export const TAINT_MARKER = '.rmab-e2e-tainted';

/**
 * Tainted mode (external PR code) is DISABLED until build-time isolation lands: a tainted image build
 * still runs branch code with network (npm lifecycle scripts, Prisma generators, next build, and
 * BuildKit features such as ADD <url> or a # syntax= frontend). The code paths stay; this gate refuses them.
 */
export const TAINTED_MODE_ENABLED = false;
export const TAINTED_DISABLED_MESSAGE = 'tainted mode is disabled until build-time isolation lands; see documentation/testing/e2e-harness.md ("Tainted mode")';

export const USAGE = `usage:
  node e2e/run.mjs [stack] --slug <s> --port <3401-3499> (--image <ref> | --worktree <dir> (--trusted | --tainted))
       [--pr-dockerfile] [--dockerfile <file>] [--specs <a,b>] [--scenario <name>]
       [--backend abs|plex] [--upgrade-from <release tag, e.g. 1.2.3>] [--evidence <dir>]
       [--offline-fixtures] [--rm-image] [--allow-log-canary] [--isolation-check] [--allow-untracked]
       [--overrides <name,name>]   (trusted e2e/overrides/*.yml; untainted only)
       [--isolate-specs]           (fresh stack per --specs entry, same images)
  node e2e/run.mjs unit --slug <s> --worktree <dir> (--trusted | --tainted) [--evidence <dir>]
  (--tainted and --pr-dockerfile are currently disabled)
  node e2e/run.mjs preview --image <ref> [--replace-image <ref>] [--evidence <dir>]
  node e2e/run.mjs down --slug <s> [--force-reserved]`;

const FLAGS = new Set(['offline-fixtures', 'rm-image', 'help', 'trusted', 'tainted', 'pr-dockerfile', 'allow-log-canary', 'force-reserved', 'isolation-check', 'allow-untracked', 'isolate-specs']);
const VALUE_OPTIONS = new Set(['slug', 'port', 'image', 'worktree', 'dockerfile', 'specs', 'scenario', 'backend', 'upgrade-from', 'evidence', 'overrides', 'replace-image']);

/** `child` is inside `parent` (or equal). Case-insensitive on Windows. */
export function isInside(parent, child) {
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

/** The main checkout that owns the trusted harness (parent of git's common dir), e.g. C:\GIT\ReadMeABook-maint. */
export function trustedRoot() {
  const common = run('git', ['-C', REPO, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { capture: true, quiet: true });
  return fs.realpathSync.native(path.dirname(path.resolve(common)));
}

/** Worktrees must live inside the trusted root (its .claude/worktrees included); anything else is refused. */
export function checkWorktree(dir) {
  const real = fs.realpathSync.native(path.resolve(dir));
  const root = trustedRoot();
  if (!isInside(root, real)) throw new Error(`--worktree ${real} is outside ${root}; refusing (only worktrees of the maintainer checkout are allowed)`);
  if (!fs.existsSync(path.join(real, 'package.json'))) throw new Error(`--worktree ${real} is not a checkout`);
  return real;
}

export function isReservedSlug(slug) {
  return slug === 'preview' || slug.endsWith('-unit');
}

export function parseArgs(argv) {
  const opts = { command: 'stack', specs: 'smoke.spec.ts', backend: 'abs', scenario: 'smoke' };
  let i = 0;
  if (argv[0] && !argv[0].startsWith('--')) opts.command = argv[i++];
  for (; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`bad argument ${argv[i]}\n${USAGE}`);
    const key = argv[i].slice(2);
    if (FLAGS.has(key)) opts[key] = true;
    else if (!VALUE_OPTIONS.has(key)) throw new Error(`unknown option --${key}\n${USAGE}`);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
    else throw new Error(`--${key} needs a value\n${USAGE}`);
  }
  if (opts.help) return opts;
  if (!['stack', 'unit', 'preview', 'down'].includes(opts.command)) throw new Error(`unknown command ${opts.command}\n${USAGE}`);
  if (opts.command === 'preview') {
    if (opts.slug) throw new Error('preview always uses the reserved slug "preview"');
    opts.slug = 'preview';
    opts.port = '3400';
  } else if (opts.slug && isReservedSlug(opts.slug) && !opts['force-reserved']) {
    throw new Error(`slug "${opts.slug}" is reserved (preview stack / unit runs); pass --force-reserved to operate on it`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(opts.slug || '')) throw new Error(`--slug must match [a-z0-9-] (got ${opts.slug})`);
  if (opts.command === 'stack') {
    const port = Number(opts.port);
    if (!(port >= 3401 && port <= 3499)) throw new Error('--port must be in 3401-3499 (3400 is the preview)');
    if (!opts.image === !opts.worktree) throw new Error('pass exactly one of --image or --worktree');
  }
  if (opts.command === 'unit' && !opts.worktree) throw new Error('unit needs --worktree');
  if (opts.command === 'preview' && !opts.image) throw new Error('preview needs --image');
  if (!['abs', 'plex'].includes(opts.backend)) throw new Error('--backend must be abs or plex');
  // Fail closed: every --worktree run declares its trust explicitly.
  if (opts.worktree) {
    if (!!opts.trusted === !!opts.tainted) throw new Error('--worktree needs exactly one trust declaration: --trusted (our own branch) or --tainted (external code)');
    opts.worktree = checkWorktree(opts.worktree);
    if (opts.trusted && fs.existsSync(path.join(opts.worktree, TAINT_MARKER))) {
      throw new Error(`${opts.worktree} is marked tainted (${TAINT_MARKER}); --trusted is refused for it`);
    }
  } else if (opts.trusted || opts.tainted) {
    throw new Error('--trusted / --tainted only apply to --worktree runs');
  }
  if ((opts.tainted || opts['pr-dockerfile']) && !TAINTED_MODE_ENABLED) throw new Error(TAINTED_DISABLED_MESSAGE);
  if (opts.tainted) {
    if (opts.command !== 'stack' || !opts.worktree) throw new Error('--tainted applies to stack runs with --worktree');
    if (opts.dockerfile) throw new Error('--tainted builds with the trusted dockerfile.unified; use --pr-dockerfile for the branch Dockerfile');
    if (opts['upgrade-from']) throw new Error('--upgrade-from is not supported with --tainted');
    if (opts.overrides) throw new Error('--overrides is not allowed with --tainted');
  }
  if (opts['pr-dockerfile'] && !opts.tainted) throw new Error('--pr-dockerfile only applies with --tainted');
  return opts;
}

/** Evidence dir for this run; refused inside any build context (the worktree or the harness). */
export function evidenceDir(opts) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const base = path.resolve(opts.evidence || process.env.E2E_EVIDENCE_DIR || path.join(os.tmpdir(), 'rmab-e2e-evidence'));
  const dir = path.join(base, `${opts.slug}-${opts.command}-${stamp}`);
  for (const ctx of [opts.worktree, E2E_DIR].filter(Boolean)) {
    if (isInside(ctx, dir)) throw new Error(`evidence dir ${dir} is inside build context ${ctx}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
