/**
 * Component: E2E downgrade flow tests (node:test, host-run): the phases run in order and every
 * branch container log reaches the canary scan
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downgradeFlow } from '../downgrade-flow.mjs';

function fakeRun({ failPhase = null } = {}) {
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-downgrade-flow-'));
  const steps = [];
  const ctx = { project: 'p', env: {}, evidence, summary: {}, priorLogs: ['phase1 log'] };
  const deps = {
    specs: ['spec.ts'],
    releaseRef: 'release:1.0.0',
    saveLogs: (_ctx, file) => {
      steps.push(`save ${file}`);
      return `log of ${file}`;
    },
    up: (_ctx, ref) => steps.push(`up ${ref}`),
    playwright: async (_ctx, _specs, phase) => {
      steps.push(`playwright ${phase}`);
      return phase === failPhase ? 1 : 0;
    },
    docker: {
      compose: (_project, args) => steps.push(`compose ${args.join(' ')}`),
      tableRowCounts: () => ({ requests: 1 }),
    },
  };
  return { ctx, deps, steps, evidence };
}

test('the upgrade-verify log is saved before the swap and joins priorLogs for the canary scan', async () => {
  const { ctx, deps, steps, evidence } = fakeRun();
  try {
    const status = await downgradeFlow(ctx, 'branch:image', deps);

    assert.equal(status, 0);
    assert.deepEqual(ctx.priorLogs, ['phase1 log', 'log of compose-phase2.log']);
    assert.deepEqual(steps, [
      'save compose-phase2.log',
      'compose stop rmab', 'compose rm -f rmab', 'up release:1.0.0', 'playwright downgrade', 'save compose-downgrade.log',
      'compose stop rmab', 'compose rm -f rmab', 'up branch:image', 'playwright reupgrade',
    ]);
    assert.deepEqual(ctx.summary, { downgradeTo: 'release:1.0.0', downgrade: { downgrade: 'passed', reupgrade: 'passed' } });
    assert.ok(fs.existsSync(path.join(evidence, 'downgrade', 'reupgrade-counts.json')));
  } finally {
    fs.rmSync(evidence, { recursive: true, force: true });
  }
});

test('a failing phase fails the flow and the other phase still runs', async () => {
  const { ctx, deps, evidence } = fakeRun({ failPhase: 'downgrade' });
  try {
    assert.equal(await downgradeFlow(ctx, 'branch:image', deps), 1);
    assert.deepEqual(ctx.summary.downgrade, { downgrade: 'failed', reupgrade: 'passed' });
  } finally {
    fs.rmSync(evidence, { recursive: true, force: true });
  }
});
