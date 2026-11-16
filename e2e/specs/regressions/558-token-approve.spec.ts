/**
 * Component: E2E regression #558 (admin API tokens that can approve requests)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * With the Settings → API switch on: a flagged 90-day admin token approves a seeded request with a
 * stored pick (the download starts and the pick is cleared, as for a session). A token and a session
 * approve one released request at the same moment: one 200, one 400 InvalidStatus, one search job.
 * A token whose expiry is moved into the past is 401; one whose lifetime is stretched past 90 days in
 * the database is 403. Create refusals over HTTP: no expiry, 1 year, a non-admin session, another
 * user, the switch off. Screenshots at 1280 light and 375 dark: the switch off and on, the Profile
 * create form ticked (30/90 days only), the list badge and the /api-docs Opt-in badge.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, urls, waitFor, writeEvidence, snap, Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { VIEWPORTS, adminPage, answer, seedRequest, settle } from './231-footprint-helpers';
import { MSG, approveWith, createToken, inDays, requestStatus, setApprovalSetting, type CreatedToken } from './558-token-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '558-token-approve';
const stamp = Date.now().toString(36);
const USER = { username: `t558${stamp}`, password: 'e2e-token-558-pass' };
const PICK = { title: 'E2E 558 Stored Pick [M4B]', downloadUrl: 'magnet:?xt=urn:btih:5580558055805580558055805580558055805580&dn=E2E%20558%20Pick', size: 1000, seeders: 5, indexer: 'E2E Torrents' };

async function registerUser(admin: Rmab) {
  const settings = await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false });
  expect(settings.status, 'registration turned on').toBe(200);
  const res = await fetch(`${urls.rmab()}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(USER) });
  const body = await res.json();
  expect(res.status, `register: ${JSON.stringify(body)}`).toBe(200);
  return { id: body.user.id as string, rmab: new Rmab(body.accessToken) };
}

const searchJobs = (requestId: string) => psql(`select count(*) from jobs where type = 'search_indexers' and request_id = ${sqlStr(requestId)}`);

test('558: a flagged admin token approves; race, expiry, lifetime and create refusals; screenshots', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const admin = await Rmab.loginAdmin();
  const adminId: string = (await admin.get('/api/auth/me')).user.id;
  const user = await registerUser(admin);
  const tokens: CreatedToken[] = [];
  const seeded: string[] = [];
  const answers: Record<string, unknown> = {};
  const flagged = async (label: string) => {
    const made = await createToken(admin, { name: `e2e-558-${label}-${stamp}`, canApproveRequests: true, expiresAt: inDays(90) });
    expect(made.status, `${label} token created: ${made.error}`).toBe(201);
    tokens.push(made.token!);
    return made.token!;
  };

  try {
    // Create refusals (the switch is off at first)
    answers.createSettingOff = (await createToken(admin, { name: `e2e-558-off-${stamp}`, canApproveRequests: true, expiresAt: inDays(30) })).answer;
    await setApprovalSetting(admin, true);
    answers.createNoExpiry = (await createToken(admin, { name: `e2e-558-ne-${stamp}`, canApproveRequests: true, expiresAt: null })).answer;
    answers.createOneYear = (await createToken(admin, { name: `e2e-558-1y-${stamp}`, canApproveRequests: true, expiresAt: inDays(365) })).answer;
    answers.createNonAdmin = (await createToken(user.rmab, { name: `e2e-558-user-${stamp}`, canApproveRequests: true, expiresAt: inDays(30) })).answer;
    answers.createOtherUser = (await createToken(admin, { name: `e2e-558-other-${stamp}`, canApproveRequests: true, expiresAt: inDays(30), userId: user.id }, '/api/admin/api-tokens')).answer;
    expect.soft(answers.createSettingOff).toEqual({ status: 403, error: 'Turn on "Allow API tokens to approve requests" in Settings → API first.' });
    expect.soft(answers.createNoExpiry).toEqual({ status: 400, error: MSG.createExpiry });
    expect.soft(answers.createOneYear).toEqual({ status: 400, error: MSG.createExpiry });
    expect.soft(answers.createNonAdmin).toEqual({ status: 403, error: MSG.createRole });
    expect.soft(answers.createOtherUser).toEqual({ status: 403, error: MSG.createOtherUser });
    answers.refusedRows = psql(`select count(*) from api_tokens where name like ${sqlStr(`e2e-558-%-${stamp}`)}`);
    expect.soft(answers.refusedRows, 'no refused create stored a token').toBe('0');

    // Stored pick: the download starts and the pick is cleared, as for a session
    const approver = await flagged('approver');
    const stored = seedRequest(user.id, `S${stamp}`.slice(0, 4), 'awaiting_approval');
    seeded.push(stored.bookId);
    psql(`update requests set selected_torrent = ${sqlStr(JSON.stringify(PICK))}::jsonb where id = ${sqlStr(stored.requestId)}`);
    answers.storedPick = await approveWith(approver.client, stored.requestId);
    answers.storedPickAfter = psql(`select concat_ws('|', status, coalesce(selected_torrent::text, 'sql-null')) from requests where id = ${sqlStr(stored.requestId)}`);
    expect(answers.storedPick).toEqual({ status: 200, error: null, message: 'Request approved and download started with pre-selected torrent', requestStatus: 'downloading' });
    expect.soft(answers.storedPickAfter, 'pick cleared (JSON null, as for a session on main)').toBe('downloading|null');

    // Token and session at the same moment on one released request
    const race = seedRequest(user.id, `Q${stamp}`.slice(0, 4), 'awaiting_approval');
    seeded.push(race.bookId);
    const both = await Promise.all([
      approver.client.raw('POST', `/api/admin/requests/${race.requestId}/approve`, { action: 'approve' }).then(answer),
      admin.raw('POST', `/api/admin/requests/${race.requestId}/approve`, { action: 'approve' }).then(answer),
    ]);
    answers.race = both;
    answers.raceCodes = both.map((a) => `${a.status}:${a.error ?? 'ok'}`).sort();
    await waitFor('the search job row', async () => searchJobs(race.requestId) !== '0', { timeoutMs: 30_000 });
    await new Promise((r) => setTimeout(r, 5_000));
    answers.raceSearchJobs = searchJobs(race.requestId);
    expect.soft(answers.raceCodes, 'exactly one approve wins').toEqual(['200:ok', '400:InvalidStatus']);
    expect.soft(answers.raceSearchJobs, 'exactly one search job').toBe('1');

    // Expired (moved into the past) and a stretched lifetime (edited in the database)
    const target = seedRequest(user.id, `E${stamp}`.slice(0, 4), 'awaiting_approval');
    seeded.push(target.bookId);
    const expired = await flagged('expired');
    psql(`update api_tokens set expires_at = now() - interval '1 minute' where id = ${sqlStr(expired.id)}`);
    answers.expired = await approveWith(expired.client, target.requestId);
    const stretched = await flagged('stretched');
    psql(`update api_tokens set expires_at = created_at + interval '120 days' where id = ${sqlStr(stretched.id)}`);
    answers.stretched = await approveWith(stretched.client, target.requestId);
    answers.targetAfter = requestStatus(target.requestId);
    expect.soft(answers.expired).toMatchObject({ status: 401, message: 'Invalid or expired API token' });
    expect.soft(answers.stretched).toMatchObject({ status: 403, message: MSG.lifetime });
    expect.soft(answers.targetAfter).toBe('awaiting_approval');

    // Screenshots
    await setApprovalSetting(admin, false);
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await adminPage(browser, vp);
      await page.goto('/admin/settings?tab=api');
      const toggle = page.getByRole('switch', { name: 'Allow API tokens to approve requests' });
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await toggle.scrollIntoViewIfNeeded();
      await settle(page);
      await snap(page, DIR, `settings-switch-off-${vp.name}`);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await settle(page);
      await snap(page, DIR, `settings-switch-on-${vp.name}`);

      await page.goto('/profile');
      const badgeRow = page.getByText(`e2e-558-approver-${stamp}`).first();
      await expect(badgeRow).toBeVisible({ timeout: 30_000 });
      await badgeRow.scrollIntoViewIfNeeded();
      await settle(page);
      await snap(page, DIR, `profile-list-badge-${vp.name}`);
      await page.getByRole('button', { name: 'Create New Token' }).click();
      const box = page.getByRole('checkbox', { name: /Can approve requests/ });
      await box.check();
      const expiry = page.locator('select', { has: page.locator('option[value="90d"]') }).first();
      answers[`profileExpiry-${vp.name}`] = await expiry.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      await box.scrollIntoViewIfNeeded();
      await settle(page);
      await snap(page, DIR, `profile-create-ticked-${vp.name}`);

      await page.goto('/api-docs');
      const card = page.getByRole('heading', { name: /^Approve request/ });
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.scrollIntoViewIfNeeded();
      await settle(page);
      answers[`docsOptIn-${vp.name}`] = await card.getByText('Opt-in', { exact: true }).count();
      await snap(page, DIR, `api-docs-opt-in-${vp.name}`);
      await ctx.close();
      await setApprovalSetting(admin, false);
    }
    for (const vp of VIEWPORTS) {
      expect.soft(answers[`profileExpiry-${vp.name}`], `ticked expiry options at ${vp.name}`).toEqual(['30d', '90d']);
      expect.soft(answers[`docsOptIn-${vp.name}`], `Opt-in badge at ${vp.name}`).toBe(1);
    }
    answers.settingRowAfterShots = psql("select coalesce(value, 'sql-null') from configuration where key = 'api_tokens.allow_request_approval'");
  } finally {
    writeEvidence(`${DIR}/answers.json`, { image: process.env.E2E_RMAB_IMAGE, adminId, answers });
    await admin.raw('PATCH', '/api/admin/settings/api-tokens', { allowRequestApproval: false }).catch(() => null);
    for (const t of tokens) await admin.raw('DELETE', `/api/user/api-tokens/${t.id}`).catch(() => null);
    for (const id of seeded) psql(`update requests set status = 'cancelled', deleted_at = now() where audiobook_id = ${sqlStr(id)}`);
  }
});
