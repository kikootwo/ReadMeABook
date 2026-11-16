/**
 * Component: E2E downgrade flow (release image again on the branch's volumes, then the branch again)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * --downgrade-to <tag> (needs --upgrade-from): after a passing upgrade flow (phases upgrade-seed and
 * upgrade-verify) the harness swaps the rmab container to the release image <tag> on the same volumes
 * (phase `downgrade`; the release's own `prisma db push --accept-data-loss` drops what it does not
 * know), then back to the branch image (phase `reupgrade`). The same --upgrade-specs run in both
 * phases and read E2E_PHASE. Row counts are recorded per phase in downgrade/, not compared: a
 * downgrade may drop columns and tables by design.
 */

import fs from 'node:fs';
import path from 'node:path';
import { compose } from './docker.mjs';
import { tableRowCounts } from './runner.mjs';

/** Swap the rmab service to `ref` (same volumes, image-generated secrets as in the upgrade flow). */
function swapTo(ctx, up, ref, docker) {
  docker.compose(ctx.project, ['stop', 'rmab'], ctx.env);
  docker.compose(ctx.project, ['rm', '-f', 'rmab'], ctx.env);
  up(ctx, ref, { generatedSecrets: true });
}

/**
 * Runs the `downgrade` and `reupgrade` phases; returns the worse of the two statuses (0 pass, 1 fail).
 * Harness errors (no bootstrap) throw from `playwright` as in the other flows. The upgrade-verify
 * container's log joins ctx.priorLogs, so the end-of-run canary scan covers the branch in that phase.
 * `docker` (compose, tableRowCounts) is replaceable for the selftest.
 */
export async function downgradeFlow(ctx, image, { up, playwright, saveLogs, specs, releaseRef, docker = { compose, tableRowCounts } }) {
  const dir = path.join(ctx.evidence, 'downgrade');
  fs.mkdirSync(dir, { recursive: true });
  ctx.summary.downgradeTo = releaseRef;
  const results = {};
  ctx.priorLogs.push(saveLogs(ctx, 'compose-phase2.log')); // the upgrade-verify container's log, before it is removed
  for (const [phase, ref] of [['downgrade', releaseRef], ['reupgrade', image]]) {
    swapTo(ctx, up, ref, docker);
    const status = await playwright(ctx, specs, phase);
    fs.writeFileSync(path.join(dir, `${phase}-counts.json`), JSON.stringify(docker.tableRowCounts(ctx), null, 2));
    if (phase === 'downgrade') saveLogs(ctx, 'compose-downgrade.log');
    results[phase] = status === 0 ? 'passed' : 'failed';
  }
  ctx.summary.downgrade = results;
  return Object.values(results).includes('failed') ? 1 : 0;
}
