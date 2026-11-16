/**
 * Component: E2E regression #558 across upgrade, downgrade and re-upgrade (the approval flag column)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * run.mjs --upgrade-from <tag> --downgrade-to <same tag> --upgrade-specs 558-token-legacy runs this
 * file in four phases on the same volumes (each reads E2E_PHASE):
 *   upgrade-seed   (release)  tokens T0 (no expiry) and T1 (90 days); three requests waiting for
 *                             approval (release date in the future: an approve starts no search)
 *   upgrade-verify (branch)   the column is boolean NOT NULL DEFAULT false and false on every row;
 *                             T0 on approve 403; switch on; T1 flagged in the database approves R1
 *   downgrade      (release)  the column is gone; T1 on approve 403 (allowlist); T1 still reads
 *                             /api/auth/me; the switch row is still 'true'
 *   reupgrade      (branch)   the column is back and T1's flag is false; T1 on approve 403 with the
 *                             switch row 'true'; a new flagged token approves R3. Then the column is
 *                             dropped on the running branch: every token lookup refuses (recorded),
 *                             and the column is added back.
 * run.mjs checks the row counts across upgrade-seed → upgrade-verify (no rows added or removed there).
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, writeEvidence, Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { seedRequest } from './231-footprint-helpers';
import {
  MSG, approvalColumnDefinition, approvalColumnPresent, approveWith, createToken, inDays, requestStatus, setApprovalSetting, settingRow,
} from './558-token-helpers';

const phase = process.env.E2E_PHASE ?? '';
const PHASES = ['upgrade-seed', 'upgrade-verify', 'downgrade', 'reupgrade'];
const STATE_KEY = 'e2e.558.legacy';
const DIR = '558-token-legacy';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(!PHASES.includes(phase), '558-token-legacy only runs via run.mjs --upgrade-from --downgrade-to --upgrade-specs');

interface State {
  t0: { id: string; secret: string };
  t1: { id: string; secret: string };
  requests: string[];
}

const loadState = (): State => JSON.parse(psql(`select value from configuration where key = ${sqlStr(STATE_KEY)}`));
const flagOf = (tokenId: string) => psql(`select can_approve_requests::text from api_tokens where id = ${sqlStr(tokenId)}`);
const flaggedRows = () => psql('select count(*) from api_tokens where can_approve_requests');

async function meStatus(client: Rmab) {
  return (await client.raw('GET', '/api/auth/me')).status;
}

test('558 legacy: the approval flag across upgrade, downgrade and re-upgrade', async () => {
  test.setTimeout(10 * 60_000);
  const admin = await Rmab.loginAdmin();
  const out: Record<string, unknown> = { phase, image: process.env.E2E_RMAB_IMAGE };
  const save = () => writeEvidence(`${DIR}/${phase}.json`, out);

  if (phase === 'upgrade-seed') {
    const adminId: string = (await admin.get('/api/auth/me')).user.id;
    out.columnOnRelease = approvalColumnPresent();
    const t0 = await createToken(admin, { name: 'e2e-558-legacy-t0', expiresAt: null });
    const t1 = await createToken(admin, { name: 'e2e-558-legacy-t1', expiresAt: inDays(90) });
    expect(t0.status, 'T0 created on the release').toBe(201);
    expect(t1.status, 'T1 created on the release').toBe(201);
    const requests = ['L1', 'L2', 'L3'].map((label) => seedRequest(adminId, label, 'awaiting_approval', { futureRelease: true }).requestId);
    const state: State = { t0: { id: t0.token!.id, secret: t0.token!.secret }, t1: { id: t1.token!.id, secret: t1.token!.secret }, requests };
    psql(`insert into configuration (id, key, value, encrypted, created_at, updated_at) values (gen_random_uuid(), ${sqlStr(STATE_KEY)}, ${sqlStr(JSON.stringify(state))}, false, now(), now())`);
    out.t1OnRelease = await approveWith(t1.token!.client, requests[0]);
    save();
    expect.soft(out.columnOnRelease, 'the release has no flag column').toBe(false);
    expect.soft(out.t1OnRelease).toMatchObject({ status: 403, message: MSG.allowlist });
    return;
  }

  const state = loadState();
  const t0 = new Rmab(state.t0.secret);
  const t1 = new Rmab(state.t1.secret);
  const [r1, r2, r3] = state.requests;

  if (phase === 'upgrade-verify') {
    out.column = approvalColumnDefinition();
    out.flaggedRows = flaggedRows();
    out.t0Approve = await approveWith(t0, r1);
    await setApprovalSetting(admin, true);
    psql(`update api_tokens set can_approve_requests = true where id = ${sqlStr(state.t1.id)}`);
    out.t1Approve = await approveWith(t1, r1);
    out.r1After = requestStatus(r1);
    save();
    expect(out.column, 'boolean, NOT NULL, default false').toBe('boolean|NO|false');
    expect.soft(out.flaggedRows, 'false on every existing row').toBe('0');
    expect.soft(out.t0Approve).toMatchObject({ status: 403, message: MSG.flag });
    expect.soft(out.t1Approve).toMatchObject({ status: 200, requestStatus: 'awaiting_release' });
    expect.soft(out.r1After).toBe('awaiting_release');
    return;
  }

  if (phase === 'downgrade') {
    out.columnPresent = approvalColumnPresent();
    out.t1Approve = await approveWith(t1, r2);
    out.r2After = requestStatus(r2);
    out.t1Me = await meStatus(t1);
    out.settingRow = settingRow();
    save();
    expect(out.columnPresent, 'the release dropped the column').toBe(false);
    expect.soft(out.t1Approve).toMatchObject({ status: 403, message: MSG.allowlist });
    expect.soft(out.r2After).toBe('awaiting_approval');
    expect.soft(out.t1Me, 'T1 still works on its allowlisted routes').toBe(200);
    expect.soft(out.settingRow).toBe('true');
    return;
  }

  // reupgrade
  out.column = approvalColumnDefinition();
  out.t1Flag = flagOf(state.t1.id);
  out.flaggedRows = flaggedRows();
  out.settingRow = settingRow();
  out.t1Approve = await approveWith(t1, r2);
  const fresh = await createToken(admin, { name: 'e2e-558-legacy-t2', canApproveRequests: true, expiresAt: inDays(90) });
  out.freshCreate = fresh.status;
  out.freshApprove = fresh.token ? await approveWith(fresh.token.client, r3) : null;

  // The column missing on a running branch: every token lookup must refuse
  psql('alter table api_tokens drop column can_approve_requests');
  try {
    out.missingColumn = {
      t1Approve: await approveWith(t1, r2),
      t0Me: await meStatus(t0),
      freshApprove: fresh.token ? (await approveWith(fresh.token.client, r2)).status : null,
      r2After: requestStatus(r2),
    };
  } finally {
    psql('alter table api_tokens add column if not exists can_approve_requests boolean not null default false');
  }
  out.columnRestored = approvalColumnDefinition();
  save();

  expect(out.column, 'the column is back').toBe('boolean|NO|false');
  expect.soft(out.t1Flag, "T1's flag came back false").toBe('false');
  expect.soft(out.flaggedRows).toBe('0');
  expect.soft(out.settingRow).toBe('true');
  expect.soft(out.t1Approve).toMatchObject({ status: 403, message: MSG.flag });
  expect.soft(out.freshCreate).toBe(201);
  expect.soft(out.freshApprove).toMatchObject({ status: 200, requestStatus: 'awaiting_release' });
  const missing = out.missingColumn as { t1Approve: { status: number }; t0Me: number; freshApprove: number | null; r2After: string };
  expect.soft(missing.t1Approve.status, 'no approve while the column is missing').not.toBe(200);
  expect.soft(missing.t0Me, 'no token lookup succeeds while the column is missing').not.toBe(200);
  expect.soft(missing.freshApprove, 'no approve while the column is missing').not.toBe(200);
  expect.soft(missing.r2After).toBe('awaiting_approval');
  expect.soft(out.columnRestored).toBe('boolean|NO|false');
});
