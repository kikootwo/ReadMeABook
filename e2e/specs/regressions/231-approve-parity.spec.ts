/**
 * Component: E2E regression #231 PR 4 (web approve and deny answer as before, with the bot off)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run against the main image and the branch image; the answers are saved for comparison. A local
 * user whose requests need approval requests two fixture books: the admin approves one on the
 * dashboard (the search runs and the download starts) and denies the other there. A seeded request
 * with a stored pick is approved through the API (download starts, the stored pick is cleared).
 * Then: a second decision on a decided request, an unknown request, a bad action. Every answer is
 * reduced to code, error, message and the request's new status. With the bot off nothing writes
 * requests.discord_cards (NULL on every row wherever the column exists). Two approves of one
 * request at the same moment are recorded (on the branch exactly one wins). Cleanup cancels the
 * download and the seeded rows.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, urls, waitFor, writeEvidence, snap, Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { VIEWPORTS, adminPage, answer, seedRequest } from './231-footprint-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '231-approve-parity';
const stamp = Date.now().toString(36);
const USER = { username: `p231${stamp}`, password: 'e2e-parity-231-pass' };
const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=E2E%20231%20Parity';

async function registerUser(admin: Rmab): Promise<{ id: string; rmab: Rmab }> {
  const settings = await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false });
  expect(settings.status, 'registration turned on').toBe(200);
  const res = await fetch(`${urls.rmab()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(USER),
  });
  const body = await res.json();
  expect(res.status, `register: ${JSON.stringify(body)}`).toBe(200);
  const set = await admin.raw('PUT', `/api/admin/users/${body.user.id}`, { role: 'user', autoApproveRequests: false, interactiveSearchAccess: true });
  expect(set.status, 'approval required for the user').toBe(200);
  return { id: body.user.id, rmab: new Rmab(body.accessToken) };
}

const statusOf = (requestId: string) => psql(`select status from requests where id = ${sqlStr(requestId)}`);

test('231 parity: web approve and deny answer as before; the bot off writes no Discord cards', async ({ browser }) => {
  await fakeArr.scenario('preview');
  const books = await fakeArr.books();
  const admin = await Rmab.loginAdmin();
  const user = await registerUser(admin);
  const seeded: string[] = [];
  const answers: Record<string, unknown> = {};

  try {
    const approveUi = await user.rmab.requestBook(books.martian);
    const denyUi = await user.rmab.requestBook(books.artemis);
    answers.created = [approveUi.request.status, denyUi.request.status];
    const stored = seedRequest(user.id, `P${stamp}`.slice(0, 4), 'awaiting_approval');
    const race = seedRequest(user.id, `R${stamp}`.slice(0, 4), 'awaiting_approval', { futureRelease: true });
    seeded.push(stored.bookId, race.bookId);
    psql(`update requests set selected_torrent = ${sqlStr(JSON.stringify({ title: 'E2E 231 Parity [M4B]', downloadUrl: MAGNET, size: 1000, seeders: 5, indexer: 'E2E Torrents' }))}::jsonb where id = ${sqlStr(stored.requestId)}`);

    // Dashboard: Approve on one card, Deny on the other (the dashboard's own calls)
    {
      const { ctx, page } = await adminPage(browser, VIEWPORTS[0]);
      await page.goto('/admin');
      for (const [key, request, button] of [['approveUi', approveUi, 'Approve'], ['denyUi', denyUi, 'Deny']] as const) {
        const book = key === 'approveUi' ? books.martian : books.artemis;
        const card = page.locator('div.relative', { has: page.getByRole('heading', { name: book.title, exact: true }) });
        await expect(card, `${book.title} card on the dashboard`).toBeVisible({ timeout: 30_000 });
        const [res] = await Promise.all([
          page.waitForResponse((r) => r.url().endsWith(`/api/admin/requests/${request.request.id}/approve`)),
          card.getByRole('button', { name: button }).click(),
        ]);
        const body = await res.json().catch(() => null);
        answers[key] = { status: res.status(), error: body?.error ?? null, message: body?.message ?? null, requestStatus: body?.request?.status ?? null };
        await expect(page.getByText(button === 'Approve' ? 'Request approved' : 'Request denied').first()).toBeVisible();
      }
      await snap(page, DIR, 'dashboard-after-decisions');
      await ctx.close();
    }
    await waitFor('the approved request downloads', async () => statusOf(approveUi.request.id) === 'downloading', { timeoutMs: 180_000, intervalMs: 3_000 });
    answers.approvedDownloads = statusOf(approveUi.request.id);
    answers.deniedRow = statusOf(denyUi.request.id);

    // Stored pick: download starts and the pick is cleared exactly as main does
    answers.storedPick = await answer(await admin.raw('POST', `/api/admin/requests/${stored.requestId}/approve`, { action: 'approve' }));
    answers.storedPickAfter = psql(`select concat_ws('|', status, (selected_torrent is null)::text, coalesce(selected_torrent::text, 'sql-null')) from requests where id = ${sqlStr(stored.requestId)}`);

    // Decided, unknown, malformed
    answers.denyAgain = await answer(await admin.raw('POST', `/api/admin/requests/${denyUi.request.id}/approve`, { action: 'approve' }));
    const approveAgain = await answer(await admin.raw('POST', `/api/admin/requests/${approveUi.request.id}/approve`, { action: 'deny' }));
    answers.approveAgain = { ...approveAgain, message: String(approveAgain.message).replace(/\(current status: \w+\)/, '(current status: <moving>)') };
    answers.unknown = await answer(await admin.raw('POST', '/api/admin/requests/00000000-0000-4000-8000-000000000000/approve', { action: 'approve' }));
    answers.badAction = await answer(await admin.raw('POST', `/api/admin/requests/${race.requestId}/approve`, { action: 'maybe' }));

    // Two approves at once (recorded; the branch lets exactly one through)
    const both = await Promise.all([1, 2].map(() => admin.raw('POST', `/api/admin/requests/${race.requestId}/approve`, { action: 'approve' }).then(answer)));
    const raceAnswers = both.map((a) => `${a.status}:${a.error ?? a.requestStatus}`).sort();

    // discord_cards: NULL on every row (the column exists on the branch image only)
    const column = psql("select count(*) from information_schema.columns where table_name = 'requests' and column_name = 'discord_cards'");
    const cardsSet = column === '1' ? psql('select count(*) from requests where discord_cards is not null') : 'no column';

    writeEvidence(`${DIR}/answers.json`, { image: process.env.E2E_RMAB_IMAGE, answers, race: raceAnswers, discordCards: { column, set: cardsSet } });

    expect.soft(answers.created, 'both requests wait for approval').toEqual(['awaiting_approval', 'awaiting_approval']);
    expect.soft(answers.approveUi).toEqual({ status: 200, error: null, message: 'Request approved and search job triggered', requestStatus: 'pending' });
    expect.soft(answers.denyUi).toEqual({ status: 200, error: null, message: 'Request denied', requestStatus: 'denied' });
    expect.soft(answers.approvedDownloads).toBe('downloading');
    expect.soft(answers.deniedRow).toBe('denied');
    expect.soft(answers.storedPick).toEqual({ status: 200, error: null, message: 'Request approved and download started with pre-selected torrent', requestStatus: 'downloading' });
    expect.soft(answers.denyAgain).toEqual({ status: 400, error: 'InvalidStatus', message: 'Request is not awaiting approval (current status: denied)', requestStatus: null });
    expect.soft(answers.approveAgain).toMatchObject({ status: 400, error: 'InvalidStatus', message: 'Request is not awaiting approval (current status: <moving>)' });
    expect.soft(answers.unknown).toEqual({ status: 404, error: 'NotFound', message: 'Request not found', requestStatus: null });
    expect.soft(answers.badAction).toMatchObject({ status: 400, error: 'ValidationError' });
    if (column === '1') {
      expect.soft(cardsSet, 'discord_cards NULL on every row with the bot off').toBe('0');
      expect.soft(raceAnswers, 'two approves at once: exactly one wins').toEqual(['200:awaiting_release', '400:InvalidStatus']);
    }
  } finally {
    await admin.raw('POST', `/api/requests/${(await user.rmab.findRequest(books.martian.asin))?.id}/cancel`).catch(() => null);
    // Seeded rows: cancelled and soft-deleted (a started download may reference them)
    for (const id of seeded) psql(`update requests set status = 'cancelled', deleted_at = now() where audiobook_id = ${sqlStr(id)}`);
  }
});
