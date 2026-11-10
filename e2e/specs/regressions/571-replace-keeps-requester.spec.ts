/**
 * Component: E2E regression #571 (replacing a book from a reported issue keeps its requester)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Audiobookshelf backend, no flags (fixture book martian, real ABS). Schedules off (back on at the end),
 * requester tags on through the settings API. A local user alice<r> (auto-approve) is registered.
 * 1. alice requests martian: a real download of release "good" → organize → ABS item → recently-added
 *    check → `available`, the item tagged `req:alice<r>`.
 * 2. alice reports an issue (POST /api/audiobooks/:asin/report-issue).
 * 3. The admin opens /admin, Reported Issues → Replace, picks the release "Replacement Copy" in the search
 *    modal (Get → Download); the replace route answers 200 (shots `571/`).
 * 4. The old request is soft-deleted; the new one is alice's, `approval_bypassed_by` NULL; its download
 *    → organize → a new ABS item → recently-added check → `available`, the item carries `req:alice<r>` and
 *    not the admin's tag (log `Tagged ... with req:alice<r>`); the `request_available` notification names
 *    alice; alice's requests list holds it; the issue is `replaced`, resolved by the admin.
 * Values read first, then expect.soft; exec bridge required.
 */

import { test, expect } from '@playwright/test';
import { Abs, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackLogsSync, waitFor, writeEvidence } from '../../lib/harness';
import { markJobs, psql, sqlStr, waitOrganized } from './242-helpers';
import { disableSchedules, session, waitStartupSettled, type FixtureBook } from './284-helpers';
import { absItemFor, clearEarlierRun, itemTags, registerUser, requestStatus, runJob, setTagging } from './232-tag-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '571';
const RUN = Date.now().toString(36).slice(-5);
const ALICE = `alice${RUN}`;
const REPLACEMENT = 'Replacement Copy';
const disabledJobs: string[] = [];

test.afterAll(async () => {
  const rmab = await Rmab.loginAdmin();
  for (const id of disabledJobs.splice(0)) await rmab.raw('PUT', `/api/admin/jobs/${id}`, { enabled: true });
  await setTagging(rmab, false).catch(() => undefined);
});

const bookPath = (requestId: string) =>
  psql(`select coalesce(a.file_path, '') from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(requestId)}`);
/** The `send_notification` jobs of a request: event and the user they name. */
const notifications = (requestId: string) =>
  psql(`select concat_ws('|', payload->>'event', payload->>'userName') from jobs where type = 'send_notification' and request_id = ${sqlStr(requestId)} order by created_at`)
    .split('\n').filter(Boolean).map((row) => { const [event, userName] = row.split('|'); return { event, userName }; });

test('#571: a reported-issue Replace keeps the original requester', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const books = await fakeArr.books();
  const martian = books.martian as FixtureBook & typeof books.martian;
  const admin = await Rmab.loginAdmin();
  const abs = await Abs.login();
  await disableSchedules(admin, disabledJobs);
  await waitStartupSettled();
  const cleared = await clearEarlierRun(abs, [martian.asin]);

  expect((await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false })).status).toBe(200);
  const alice = await registerUser(admin, ALICE, true);
  await setTagging(admin, true);
  const adminRow = psql(`select concat_ws('|', id, plex_username) from users where role = 'admin' and deleted_at is null order by created_at limit 1`).split('|');
  const [adminId, adminName] = adminRow;
  const adminTag = `req:${adminName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '')}`;
  writeEvidence(`${DIR}/step0-run.json`, { run: RUN, alice: { id: alice.id, name: ALICE }, admin: { id: adminId, name: adminName, tag: adminTag }, cleared });

  // Two releases: "good" ranks first for alice's automatic search; the admin picks the replacement by hand
  const def = {
    name: 'replace-keeps-requester-571', description: 'Two mp3 torrents for book martian (generated tones).', book: 'martian',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [
      { id: 'good', title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]', sizeMB: 420, seeders: 60, fixture: 'martian-mp3' },
      { id: 'replacement', title: `{{author}} - {{title}} [MP3 128kbps] ${REPLACEMENT}`, sizeMB: 400, seeders: 4, fixture: 'martian-mp3-128' },
    ],
  };
  expect((await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) })).status).toBe(200);
  const idx = await admin.get<{ indexers: unknown[]; flagConfigs: unknown[] }>('/api/admin/settings/prowlarr/indexers');
  expect((await admin.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers: idx.indexers, flagConfigs: idx.flagConfigs })).ok).toBe(true);

  // 1. alice's book delivered and tagged
  let since = markJobs();
  const oldReq = (await alice.rmab.requestBook(martian)).request.id;
  await waitFor('alice: downloaded', async () => ['downloaded', 'available', 'failed'].includes(requestStatus(oldReq)), { timeoutMs: 420_000, intervalMs: 3_000 });
  await waitOrganized(since, oldReq);
  const oldItem = await absItemFor(abs, bookPath(oldReq));
  const s1Job = await runJob(admin, 'plex_recently_added_check');
  const s1 = { request: oldReq, status: requestStatus(oldReq), job: s1Job, itemId: oldItem.id, ...(await itemTags(abs, oldItem.id)) };
  writeEvidence(`${DIR}/step1-delivered.json`, s1);
  expect(s1.status, 'alice: book available before the report').toBe('available');

  // 2. alice reports an issue
  const report = await alice.rmab.raw('POST', `/api/audiobooks/${martian.asin}/report-issue`, { reason: 'Audio skips in chapter 2', title: martian.title, author: martian.author });
  const reportBody = await report.json();
  writeEvidence(`${DIR}/step2-report.json`, { status: report.status, body: reportBody });
  expect(report.status, JSON.stringify(reportBody)).toBe(201);
  const issueId: string = reportBody.issue.id;

  // 3. The admin replaces it from /admin with a release picked in the search modal
  since = markJobs();
  const ui: Record<string, unknown> = {};
  {
    const { ctx, page, settled } = await session(browser, 1280, 900, false);
    await page.goto('/admin');
    const replaceButton = page.getByRole('button', { name: 'Replace', exact: true });
    await expect(replaceButton).toBeVisible({ timeout: 60_000 });
    await settled(DIR, 'reported-issue-1280');
    await replaceButton.click();
    const row = page.locator('div').filter({ hasText: REPLACEMENT }).filter({ has: page.getByRole('button', { name: 'Get', exact: true }) }).last();
    await expect(row).toBeVisible({ timeout: 120_000 });
    await settled(DIR, 'replace-search-1280');
    await row.getByRole('button', { name: 'Get', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Download', exact: true });
    await expect(confirm).toBeVisible();
    await settled(DIR, 'replace-confirm-1280');
    const resP = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/admin/reported-issues/${issueId}/replace`);
    await confirm.click();
    const res = await resP;
    ui.replaceStatus = res.status();
    ui.pickedTitle = res.request().postDataJSON()?.torrent?.title;
    await expect(page.getByText('Replacement download started')).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
    ui.toast = await page.getByText('Replacement download started').count();
    await settled(DIR, 'replaced-1280');
    await ctx.close();
  }
  writeEvidence(`${DIR}/step3-replace-ui.json`, ui);
  expect(ui.replaceStatus, 'replace route').toBe(200);

  // 4. The replacement is alice's: downloaded, delivered, tagged for her, notified with her name
  const bookId = psql(`select audiobook_id from requests where id = ${sqlStr(oldReq)}`);
  const newReq = await waitFor('replacement request', async () =>
    psql(`select id from requests where audiobook_id = ${sqlStr(bookId)} and type = 'audiobook' and deleted_at is null and id <> ${sqlStr(oldReq)}`) || null, { timeoutMs: 60_000 });
  const created = psql(`select concat_ws('|', user_id, coalesce(approval_bypassed_by, 'NULL'), status) from requests where id = ${sqlStr(newReq)}`).split('|');
  const oldDeleted = psql(`select concat_ws('|', deleted_at is not null, coalesce(deleted_by, '')) from requests where id = ${sqlStr(oldReq)}`);
  await waitFor('replacement: downloaded', async () => ['downloaded', 'available', 'failed'].includes(requestStatus(newReq)), { timeoutMs: 420_000, intervalMs: 3_000 });
  await waitOrganized(since, newReq);
  const newItem = await absItemFor(abs, bookPath(newReq));
  const s4Job = await runJob(admin, 'plex_recently_added_check');
  const tags = await itemTags(abs, newItem.id);
  const taggedLog = stackLogsSync('rmab').match(new RegExp(`Tagged "[^"]*" \\(Audiobookshelf item ${newItem.id}\\) with req:${ALICE}`, 'g')) || [];
  const aliceList = (await alice.rmab.get<{ requests: { id: string }[] }>('/api/requests?limit=100')).requests.map((r) => r.id);
  const issue = psql(`select concat_ws('|', status, coalesce(resolved_by_id, '')) from reported_issues where id = ${sqlStr(issueId)}`).split('|');
  const s4 = {
    newReq, userId: created[0], approvalBypassedBy: created[1], statusAtCreate: created[2], oldDeleted,
    status: requestStatus(newReq), job: s4Job, oldItemId: oldItem.id, newItemId: newItem.id, tags: tags.tags,
    taggedLog, notifications: notifications(newReq), inAliceList: aliceList.includes(newReq), oldInAliceList: aliceList.includes(oldReq), issue,
  };
  writeEvidence(`${DIR}/step4-replacement.json`, s4);

  expect.soft(s4.userId, 'replacement belongs to alice').toBe(alice.id);
  expect.soft(s4.approvalBypassedBy, 'replacement unmarked').toBe('NULL');
  expect.soft(s4.oldDeleted, 'old request soft-deleted by the admin').toBe(`t|${adminId}`);
  expect.soft(s4.status, 'replacement delivered').toBe('available');
  expect.soft(s4.newItemId, 'a new ABS item (the old one went with its files)').not.toBe(oldItem.id);
  expect.soft(s4.tags, 'new item tagged for alice').toContain(`req:${ALICE}`);
  expect.soft(s4.tags, 'new item not tagged for the admin').not.toContain(adminTag);
  expect.soft(taggedLog.length, 'tag written this run').toBeGreaterThan(0);
  expect.soft(s4.notifications, 'request_available names alice').toContainEqual({ event: 'request_available', userName: ALICE });
  expect.soft(s4.notifications.filter((n) => n.userName !== ALICE), 'no notification names anyone else').toEqual([]);
  expect.soft(s4.inAliceList, "replacement in alice's requests").toBe(true);
  expect.soft(s4.issue, 'issue replaced by the admin').toEqual(['replaced', adminId]);
});
