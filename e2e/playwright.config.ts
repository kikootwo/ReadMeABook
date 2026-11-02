/**
 * Component: E2E Playwright configuration (Chromium only, traces + screenshots always on)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Launched by e2e/run.mjs, which sets E2E_BASE_URL, E2E_CONTROL_URL, E2E_ABS_URL and
 * E2E_EVIDENCE_DIR (always outside any Docker build context).
 */

import path from 'node:path';
import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';

const evidence = process.env.E2E_EVIDENCE_DIR || path.join(os.tmpdir(), 'rmab-e2e-evidence', 'adhoc');
// Upgrade runs invoke Playwright twice; keep each phase's traces and reports.
const phase = process.env.E2E_PHASE ? `-${process.env.E2E_PHASE}` : '';

export default defineConfig({
  testDir: path.join(__dirname, 'specs'),
  globalSetup: path.join(__dirname, 'bootstrap.ts'),
  outputDir: path.join(evidence, `test-results${phase}`),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(evidence, `results${phase}.json`) }],
    ['html', { outputFolder: path.join(evidence, `report${phase}`), open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'on',
    // Evidence screenshots are explicit JPEGs (lib/harness.ts snap); traces carry the rest.
    screenshot: 'off',
    video: 'off',
    // Chromium's own sandbox (needs the Playwright seccomp profile); off = the runner container is the boundary.
    launchOptions: { chromiumSandbox: process.env.E2E_CHROMIUM_SANDBOX === '1' },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
