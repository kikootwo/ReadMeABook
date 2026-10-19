/**
 * Component: E2E exec bridge request validation + tainted refusal (node:test, host-run, no Docker)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateExec, startExecBridge } from '../exec-bridge.mjs';

test('only exec/logs on rmab, fake-arr, abs; user and argv are constrained', () => {
  assert.deepEqual(validateExec({ op: 'logs', service: 'rmab', argv: ['ignored'] }), { op: 'logs', service: 'rmab' });
  assert.equal(validateExec({ service: 'fake-arr', argv: ['true'], user: '1000:1000' }).service, 'fake-arr');
  for (const bad of [
    { service: 'egress-proxy', argv: ['true'] },
    { service: 'host', argv: ['true'] },
    { service: 'rmab', argv: [] },
    { service: 'rmab', argv: 'sh -c id' },
    { service: 'rmab', argv: ['true'], user: 'root;rm' },
    { service: 'rmab', argv: ['true'], op: 'cp' },
    { service: 'rmab', argv: ['true'], input: 42 },
    { service: 'rmab', argv: ['sh', '-c', 'id\u0000; rm -rf /'] },
  ]) {
    assert.throws(() => validateExec(bad), undefined, JSON.stringify(bad));
  }
});

test('the bridge refuses to start for a tainted run', async () => {
  await assert.rejects(startExecBridge({ project: 'rmab-e2e-x', env: { E2E_TAINTED: '1' } }), /tainted/);
});

test('the bridge listens on loopback only and rejects missing/wrong tokens', async () => {
  const bridge = await startExecBridge({ project: 'rmab-e2e-x', env: { E2E_TAINTED: '0' } });
  try {
    const base = `http://127.0.0.1:${bridge.port}`;
    assert.equal((await fetch(`${base}/exec`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/exec`, { method: 'POST', headers: { 'x-exec-token': 'x'.repeat(48) }, body: '{}' })).status, 401);
    const bad = await fetch(`${base}/exec`, { method: 'POST', headers: { 'x-exec-token': bridge.token }, body: JSON.stringify({ service: 'host', argv: ['id'] }) });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/other`, { method: 'POST', headers: { 'x-exec-token': bridge.token } })).status, 404);
  } finally {
    await bridge.close();
  }
});

test('F8: a NUL in argv is a 400 and the bridge keeps serving', async () => {
  const bridge = await startExecBridge({ project: 'rmab-e2e-x', env: { E2E_TAINTED: '0' } });
  try {
    const post = (body) => fetch(`http://127.0.0.1:${bridge.port}/exec`, { method: 'POST', headers: { 'x-exec-token': bridge.token }, body: JSON.stringify(body) });
    const res = await post({ service: 'rmab', argv: ['echo', 'a\u0000b'] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /NUL/);
    assert.equal((await post({ service: 'host', argv: ['id'] })).status, 400, 'still serving after the rejected request');
  } finally {
    await bridge.close();
  }
});
