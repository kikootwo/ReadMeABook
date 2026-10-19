/**
 * Component: E2E runner argument/safety checks tests (node:test, host-run)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isInside, isReservedSlug, parseArgs, trustedRoot, TAINT_MARKER, TAINTED_MODE_ENABLED } from '../args.mjs';
import { REPO } from '../docker.mjs';

const stack = (...extra) => ['--slug', 'x', '--port', '3401', ...extra];

/** A throwaway "worktree" inside the trusted root (cleaned up by the caller). */
function fakeWorktree({ marked = false } = {}) {
  const dir = path.join(trustedRoot(), '.claude', 'worktrees', `.e2e-selftest-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  if (marked) fs.writeFileSync(path.join(dir, TAINT_MARKER), '');
  return dir;
}

test('isInside: path.relative based, no prefix confusion', () => {
  const root = path.resolve('/x/ReadMeABook-maint');
  assert.equal(isInside(root, path.join(root, '.claude', 'worktrees', 'a')), true);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, path.resolve('/x/ReadMeABook')), false);
  assert.equal(isInside(path.resolve('/x/ReadMeABook'), root), false, 'ReadMeABook-maint is not inside ReadMeABook');
  assert.equal(isInside(root, path.resolve('/x/ReadMeABook-maint/../other')), false);
});

test('reserved slugs need --force-reserved', () => {
  assert.equal(isReservedSlug('preview'), true);
  assert.equal(isReservedSlug('t2-unit'), true);
  assert.equal(isReservedSlug('t2'), false);
  assert.throws(() => parseArgs(['down', '--slug', 'preview']), /reserved/);
  assert.equal(parseArgs(['down', '--slug', 'preview', '--force-reserved']).slug, 'preview');
  assert.throws(() => parseArgs(['--slug', 'x-unit', '--port', '3401', '--image', 'y']), /reserved/);
  assert.throws(() => parseArgs(['preview', '--slug', 'other', '--image', 'y']), /reserved slug "preview"/);
});

test('C2: unknown options and missing values are rejected (not silently accepted)', () => {
  assert.throws(() => parseArgs(stack('--image', 'y', '--imgae', 'z')), /unknown option --imgae/);
  assert.throws(() => parseArgs(stack('--image', 'y', '--no-cleanup')), /unknown option --no-cleanup/);
  assert.throws(() => parseArgs(stack('--image')), /--image needs a value/);
  assert.throws(() => parseArgs(stack('--image', 'y', 'stray')), /bad argument stray/);
  assert.equal(parseArgs(stack('--image', 'y', '--specs', 'a,b')).specs, 'a,b');
});

test('C2: every --worktree run declares --trusted or --tainted (fail closed)', () => {
  const dir = fakeWorktree();
  try {
    assert.throws(() => parseArgs(stack('--worktree', dir)), /exactly one trust declaration/);
    assert.throws(() => parseArgs(stack('--worktree', dir, '--trusted', '--tainted')), /exactly one trust declaration/);
    assert.throws(() => parseArgs(['unit', '--slug', 'x', '--worktree', dir]), /exactly one trust declaration/);
    assert.equal(parseArgs(stack('--worktree', dir, '--trusted')).trusted, true);
    assert.equal(parseArgs(['unit', '--slug', 'x', '--worktree', dir, '--trusted']).worktree, fs.realpathSync.native(dir));
    assert.throws(() => parseArgs(stack('--image', 'y', '--trusted')), /only apply to --worktree runs/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C2: a .rmab-e2e-tainted marker refuses --trusted', () => {
  const dir = fakeWorktree({ marked: true });
  try {
    assert.throws(() => parseArgs(stack('--worktree', dir, '--trusted')), /marked tainted.*--trusted is refused/);
    assert.throws(() => parseArgs(['unit', '--slug', 'x', '--worktree', dir, '--trusted']), /--trusted is refused/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C1: --tainted and --pr-dockerfile are disabled until build-time isolation lands', () => {
  assert.equal(TAINTED_MODE_ENABLED, false);
  const dir = fakeWorktree({ marked: true });
  try {
    assert.throws(() => parseArgs(stack('--worktree', dir, '--tainted')), /tainted mode is disabled until build-time isolation lands; see .*e2e-harness\.md/);
    assert.throws(() => parseArgs(stack('--worktree', dir, '--tainted', '--pr-dockerfile')), /tainted mode is disabled/);
    assert.throws(() => parseArgs(['unit', '--slug', 'x', '--worktree', dir, '--tainted']), /tainted mode is disabled/);
    assert.throws(() => parseArgs(stack('--image', 'y', '--pr-dockerfile')), /tainted mode is disabled/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('worktrees outside the trusted root are refused; the trusted checkout itself is allowed', () => {
  const outside = path.resolve(trustedRoot(), '..');
  assert.throws(() => parseArgs(stack('--worktree', outside, '--trusted')), /outside/);
  assert.equal(parseArgs(stack('--worktree', REPO, '--trusted')).trusted, true);
  assert.throws(() => parseArgs(['--slug', 'x', '--port', '3400', '--image', 'y']), /3401-3499/);
});
