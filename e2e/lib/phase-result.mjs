/**
 * Component: E2E runner phase result (pass / fail / skipped) from Playwright's JSON report
 * Documentation: documentation/testing/e2e-harness.md
 *
 * A phase whose exit status is 0 still did not run a spec file when every test in that file
 * skipped (a file-level `test.skip`). Such a phase is reported as `skipped`, never `pass`.
 */

import fs from 'node:fs';

/** Spec files in a Playwright JSON report whose tests all skipped, sorted */
export function skippedSpecFiles(report) {
  const files = new Map();
  const walk = (suite, file) => {
    const current = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const counts = files.get(current) ?? { ran: 0, skipped: 0 };
        if (t.status === 'skipped') counts.skipped += 1;
        else counts.ran += 1;
        files.set(current, counts);
      }
    }
    for (const child of suite.suites ?? []) walk(child, current);
  };
  for (const suite of report?.suites ?? []) walk(suite, suite.file);
  return [...files]
    .filter(([, counts]) => counts.ran === 0 && counts.skipped > 0)
    .map(([file]) => file)
    .sort();
}

/**
 * Result of one runner phase: 'fail' on a non-zero status; 'skipped' when a spec file of the
 * phase did not run; otherwise 'pass'. `report` is the parsed JSON report, or null when missing.
 */
export function phaseResult(status, report) {
  if (status !== 0) return { result: 'fail', skipped: [] };
  const skipped = skippedSpecFiles(report);
  return { result: skipped.length ? 'skipped' : 'pass', skipped };
}

/** Read a phase's JSON report; null when it is missing or unreadable */
export function readReport(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
