/**
 * Component: E2E harness self-check: exec bridge (untainted: works; tainted: absent, specs skip)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, stackExecSync, writeEvidence } from '../../lib/harness';

test('exec bridge runs commands in stack services (untainted runs only)', async () => {
  test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
  const one = stackExecSync('rmab', ['gosu', 'postgres', 'psql', '-d', 'readmeabook', '-At', '-c', 'select 1']).trim();
  expect(one).toBe('1');
  const uid = stackExecSync('rmab', ['sh', '-s'], { user: '1000:1000', input: 'id -u\n' }).trim();
  expect(uid).toBe('1000');
  const sha = stackExecSync('fake-arr', ['sh', '-s'], { input: 'printf abc | sha256sum\n' }).trim();
  expect(sha.startsWith('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBe(true);
  expect(() => stackExecSync('rmab', ['sh', '-c', 'exit 3'])).toThrow();
  writeEvidence('harness/exec-bridge.json', { psql: one, uid, sha: sha.slice(0, 16) });
});

test('tainted runs have no exec bridge', async () => {
  test.skip(process.env.E2E_TAINTED_RUN !== '1', 'tainted-only check');
  expect(execBridgeAvailable()).toBe(false);
  expect(() => stackExecSync('rmab', ['true'])).toThrow(/untainted runs/);
});
