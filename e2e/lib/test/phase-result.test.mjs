/**
 * Component: E2E runner phase result tests (node:test, host-run)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { phaseResult, readReport, skippedSpecFiles } from '../phase-result.mjs';

/** A Playwright JSON report: one top-level suite per file, tests nested in describes */
const report = (files) => ({
  suites: Object.entries(files).map(([file, statuses]) => ({
    title: file,
    file,
    specs: [],
    suites: [{ title: 'describe', specs: statuses.map((status, i) => ({ title: `t${i}`, tests: [{ status }] })) }],
  })),
  stats: {},
});

test('phaseResult: a phase whose only spec skipped is reported as skipped, not pass', () => {
  const outcome = phaseResult(0, report({ 'regressions/signin-limits.spec.ts': ['skipped'] }));
  assert.deepEqual(outcome, { result: 'skipped', skipped: ['regressions/signin-limits.spec.ts'] });
});

test('phaseResult: one fully skipped file among files that ran makes the phase skipped', () => {
  const outcome = phaseResult(0, report({ 'b.spec.ts': ['expected'], 'a.spec.ts': ['skipped', 'skipped'], 'c.spec.ts': ['skipped'] }));
  assert.deepEqual(outcome, { result: 'skipped', skipped: ['a.spec.ts', 'c.spec.ts'] });
});

test('phaseResult: a file with some skipped tests and some that ran is a pass', () => {
  assert.deepEqual(phaseResult(0, report({ 'a.spec.ts': ['skipped', 'expected', 'flaky'] })), { result: 'pass', skipped: [] });
});

test('phaseResult: a non-zero status fails whatever the report says', () => {
  assert.equal(phaseResult(1, report({ 'a.spec.ts': ['skipped'] })).result, 'fail');
  assert.equal(phaseResult(1, null).result, 'fail');
});

test('phaseResult: no report and status 0 is a pass with nothing known to be skipped', () => {
  assert.deepEqual(phaseResult(0, null), { result: 'pass', skipped: [] });
});

test('skippedSpecFiles: tests directly on the file suite count too', () => {
  const direct = { suites: [{ title: 'x', file: 'x.spec.ts', specs: [{ title: 't', tests: [{ status: 'skipped' }] }] }] };
  assert.deepEqual(skippedSpecFiles(direct), ['x.spec.ts']);
  assert.deepEqual(skippedSpecFiles({}), []);
});

test('readReport: parses a report file; a missing or broken one is null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-e2e-phase-'));
  try {
    const good = path.join(dir, 'results-stack.json');
    fs.writeFileSync(good, JSON.stringify(report({ 'a.spec.ts': ['expected'] })));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{');
    assert.equal(readReport(good).suites[0].file, 'a.spec.ts');
    assert.equal(readReport(path.join(dir, 'broken.json')), null);
    assert.equal(readReport(path.join(dir, 'missing.json')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
