/**
 * Component: E2E regression #583 (the Library Scan is scheduled as soon as setup completes)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run first on a fresh stack, right after the harness bootstrap ran setup (no restart). The Library
 * Scan and Audible Data Refresh rows are created disabled at startup and enabled by setup; each must
 * then have exactly one Bull repeatable (`<type>:scheduled-<id>:::<cron>` in
 * `bull:audiobook-jobs:repeat`). Under `--stop-specs` every later phase (after a docker stop/start)
 * checks the app start added no second copy. Values read first, then `expect.soft`, so a run on main
 * records the missing entries. Evidence `583/scheduled-<phase>.txt`; exec bridge required.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, stackExecSync, writeEvidence } from '../../lib/harness';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const SETUP_JOBS = ['plex_library_scan', 'audible_refresh'];
const REPEAT_SET = 'bull:audiobook-jobs:repeat';
type Job = { id: string; name: string; type: string; schedule: string; enabled: boolean };

test('#583: setup schedules the jobs it enables, once', async () => {
  const phase = process.env.E2E_PHASE || 'stack';
  const rmab = await Rmab.loginAdmin();
  const { jobs } = await rmab.get<{ jobs: Job[] }>('/api/admin/jobs');
  // Not a TTY, so redis-cli prints one raw member per line (nothing for an empty set)
  const repeatables = stackExecSync('rmab', ['redis-cli', 'ZRANGE', REPEAT_SET, '0', '-1'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

  const rows = jobs.map((j) => `${j.name} | ${j.type} | ${j.schedule} | enabled=${j.enabled} | ${j.id}`).sort();
  writeEvidence(
    `583/scheduled-${phase}.txt`,
    [`# phase ${phase}: scheduled_jobs rows (GET /api/admin/jobs)`, ...rows, `# ${REPEAT_SET} (redis-cli ZRANGE)`, ...repeatables, ''].join('\n'),
  );

  for (const type of SETUP_JOBS) {
    const job = jobs.find((j) => j.type === type);
    expect(job, `scheduled job ${type}`).toBeTruthy();
    expect.soft(job!.enabled, `${type} enabled by setup`).toBe(true);
    const mine = repeatables.filter((key) => key.includes(`:scheduled-${job!.id}:`));
    expect.soft(mine, `${job!.name}: exactly one repeatable on its own cron`).toEqual([`${type}:scheduled-${job!.id}:::${job!.schedule}`]);
  }
  // No job of any kind registered twice
  const ids = repeatables.map((key) => key.split(':')[1]);
  expect.soft(ids.length, 'one repeatable per scheduled job').toBe(new Set(ids).size);
});
