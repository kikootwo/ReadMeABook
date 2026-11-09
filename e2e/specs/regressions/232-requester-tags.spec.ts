/**
 * Component: E2E regression #232 (tag the requester on the Audiobookshelf item)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata (real ABS; fake Audible/Audnexus answers;
 * generated audio). Schedules off (back on at the end). Local users registered with no approval:
 * alice, bob, john.smith, johnsmith, 李雷 (auto-approve), carol (approval required).
 * 1. Tagging on through the settings checkbox (amber box: 1280 light, 375 dark). alice's martian runs a
 *    real download to `downloaded`; the ABS scan adds the item; a manual ABS tag `keepme` is added before
 *    RMAB's first write; ONE recently-added check → the item holds `keepme` then `req:alice`.
 * 2. A real ABS match with overrideDetails, the fake Audnexus answering an Audible tag genre: precondition
 *    the Audible tag present and `req:alice` gone. ONE full scan → `req:alice` back, Audible tag kept. A
 *    match without override flags and an ABS `scan?force=1` keep it.
 * 3. john.smith's artemis (manual import of generated audio, unnamed) → available, no `req:johnsmith`;
 *    log `Not tagging with req:johnsmith`; the settings warnings list the shared tag and 李雷.
 * 4. Tagging off; bob's made-up book delivered (manual import) untagged. On → the backfill job tags it
 *    (`tagged` >= 1). Off and on again → `tagged` 0, `alreadyTagged` >= 2, the item's updatedAt unchanged.
 * 5. An ABS user limited to `req:alice` lists only alice's book; its filterdata lists every `req:` tag.
 * 6. carol (approval required) requests a made-up book, the admin denies it, then manual-imports that book
 *    without naming the request (POST /api/admin/manual-import): `available`, recorded
 *    `manual_import:denied`, no `req:carol` after the recently-added check, a full scan, or a backfill
 *    (`skippedUnapproved` >= 1).
 * Values read first, then expect.soft; exec bridge required.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackLogsSync, urls, waitFor, writeEvidence } from '../../lib/harness';
import { dbNow, markJobs, psql, sqlStr, waitOrganized } from './242-helpers';
import { disableSchedules, FAKE_PROXY, printenv, session, waitStartupSettled, type FixtureBook } from './284-helpers';
import {
  absItemFor, backfillAfter, bypassMark, importGenerated, itemTags, madeUpBook, registerUser, requestStatus, runJob,
  setAudibleTags, setTagging, waitSettled,
} from './232-tag-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '232-tags';
const AUDIBLE_TAG = 'E2E Audible Tag';
const disabledJobs: string[] = [];
let martianAsin = '';

test.afterAll(async () => {
  const rmab = await Rmab.loginAdmin();
  for (const id of disabledJobs.splice(0)) await rmab.raw('PUT', `/api/admin/jobs/${id}`, { enabled: true });
  await setTagging(rmab, false).catch(() => undefined);
  if (martianAsin) await setAudibleTags(martianAsin, []).catch(() => undefined);
});

test('#232: the requester is tagged on the Audiobookshelf item, and only when the request was approved', async ({ browser }) => {
  test.setTimeout(2_400_000);
  for (const service of ['abs', 'rmab']) expect(printenv(service, 'HTTPS_PROXY'), `${service} needs --overrides abs-fake-metadata`).toBe(FAKE_PROXY);
  const books = await fakeArr.books();
  const martian = books.martian as FixtureBook & typeof books.martian;
  martianAsin = martian.asin;
  expect(martian.title, 'run with --offline-fixtures').toMatch(/^Fixture Book /);

  const admin = await Rmab.loginAdmin();
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  await disableSchedules(admin, disabledJobs);
  await waitStartupSettled();

  // 0. Users
  expect((await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false })).status).toBe(200);
  const alice = await registerUser(admin, 'alice', true);
  const bob = await registerUser(admin, 'bob', true);
  const js1 = await registerUser(admin, 'john.smith', true);
  await registerUser(admin, 'johnsmith', true);
  await registerUser(admin, '李雷', true);
  const carol = await registerUser(admin, 'carol', false);

  // 1a. Tagging on through the checkbox; the amber box at 1280 light and 375 dark
  const ui: Record<string, unknown> = {};
  {
    const { ctx, page, settled } = await session(browser, 1280, 900, false);
    await page.goto('/admin/settings');
    const box = page.getByRole('checkbox', { name: /Tag items with the requester's username/ });
    await expect(box).toBeVisible({ timeout: 30_000 });
    ui.checkedBefore = await box.isChecked();
    await page.getByRole('button', { name: 'Test Connection' }).click();
    await expect(page.getByText(/Connected to Audiobookshelf/).first()).toBeVisible({ timeout: 30_000 });
    await box.check();
    const warnings = page.getByTestId('requester-tag-warnings');
    await expect(warnings).toBeVisible();
    ui.warningText = (await warnings.textContent())?.replace(/\s+/g, ' ');
    await box.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    await settled(DIR, 'setting-1280-light');
    const putP = page.waitForRequest((r) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/admin/settings/audiobookshelf');
    const resP = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/admin/settings/audiobookshelf');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    ui.putTagRequester = (await putP).postDataJSON().tagRequester;
    ui.putStatus = (await resP).status();
    await ctx.close();
  }
  {
    const { ctx, page, settled } = await session(browser, 375, 812, true);
    await page.goto('/admin/settings');
    const box = page.getByRole('checkbox', { name: /Tag items with the requester's username/ });
    await expect(box).toBeChecked({ timeout: 30_000 });
    await page.getByTestId('requester-tag-warnings').scrollIntoViewIfNeeded();
    await settled(DIR, 'setting-375-dark');
    ui.overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await ctx.close();
  }
  const settingsAfterUi = (await admin.get<{ audiobookshelf: Record<string, unknown> }>('/api/admin/settings')).audiobookshelf;
  writeEvidence(`${DIR}/step1-setting.json`, { ui, tagRequester: settingsAfterUi.tagRequester, warnings: settingsAfterUi.requesterTagWarnings });

  // 1b. alice's martian: real download → downloaded → ABS item → manual tag keepme → recently-added check
  const def = {
    name: 'requester-tags-232', description: 'One mp3 torrent for book martian (generated tones).', book: 'martian',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [{ id: 'good', title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]', sizeMB: 420, seeders: 60, fixture: 'martian-mp3' }],
  };
  expect((await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) })).status).toBe(200);
  const idx = await admin.get<{ indexers: unknown[]; flagConfigs: unknown[] }>('/api/admin/settings/prowlarr/indexers');
  expect((await admin.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers: idx.indexers, flagConfigs: idx.flagConfigs })).ok).toBe(true);
  const since = markJobs();
  const aliceReq = (await alice.rmab.requestBook(martian)).request.id;
  await waitFor('alice: downloaded', async () => ['downloaded', 'available', 'failed'].includes(requestStatus(aliceReq)), { timeoutMs: 420_000, intervalMs: 3_000 });
  await waitOrganized(since, aliceReq);
  const aliceStatusBefore = requestStatus(aliceReq);
  const aliceItem = await absItemFor(abs, psql(`select a.file_path from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(aliceReq)}`));
  await abs.req('PATCH', `/api/items/${aliceItem.id}/media`, { tags: ['keepme'] });
  const s1Before = await itemTags(abs, aliceItem.id);
  const s1Job = await runJob(admin, 'plex_recently_added_check');
  const s1 = { status: requestStatus(aliceReq), job: s1Job, ...(await itemTags(abs, aliceItem.id)) };
  const taggedLog = stackLogsSync('rmab').match(new RegExp(`Tagged "[^"]*" \\(Audiobookshelf item ${aliceItem.id}\\) with req:alice`, 'g')) || [];
  writeEvidence(`${DIR}/step1-delivery.json`, { aliceReq, aliceStatusBefore, itemId: aliceItem.id, before: s1Before, after: s1, taggedLog });

  // 2. ABS re-match with override drops the tag; one full scan puts it back
  await setAudibleTags(martian.asin, [AUDIBLE_TAG]);
  await abs.req('POST', `/api/items/${aliceItem.id}/match`, { provider: 'audible', asin: martian.asin, overrideDetails: true });
  const s2Matched = await itemTags(abs, aliceItem.id);
  const s2Job = await runJob(admin, 'plex_library_scan');
  const s2Repaired = await itemTags(abs, aliceItem.id);
  await abs.req('POST', `/api/items/${aliceItem.id}/match`, { provider: 'audible', asin: martian.asin });
  const s2Plain = await itemTags(abs, aliceItem.id);
  const forced = await fetch(`${urls.abs()}/api/libraries/${libraryId}/scan?force=1`, { method: 'POST', headers: { Authorization: `Bearer ${abs.token}` } });
  await waitFor('ABS forced scan saved the item', async () => ((await itemTags(abs, aliceItem.id)).updatedAt > s2Plain.updatedAt ? true : null), { timeoutMs: 120_000, intervalMs: 2_000 }).catch(() => undefined);
  const s2Forced = { scanStatus: forced.status, ...(await itemTags(abs, aliceItem.id)) };
  writeEvidence(`${DIR}/step2-rematch.json`, { matched: s2Matched, fullScan: s2Job, repaired: s2Repaired, plainMatch: s2Plain, forcedScan: s2Forced });

  // 3. john.smith and johnsmith share req:johnsmith: neither is tagged
  const jsReq = (await js1.rmab.requestBook(books.artemis)).request.id;
  const jsSettled = await waitSettled(jsReq);
  const jsItem = await absItemFor(abs, await importGenerated(admin, jsReq, 'johnsmith'));
  const s3Job = await runJob(admin, 'plex_recently_added_check');
  const s3 = { settled: jsSettled, status: requestStatus(jsReq), job: s3Job, ...(await itemTags(abs, jsItem.id)) };
  const sharedLog = stackLogsSync('rmab').match(/Not tagging with req:johnsmith: shared by [^\n]*/g) || [];
  const s3Warnings = (await admin.get<{ audiobookshelf: Record<string, unknown> }>('/api/admin/settings')).audiobookshelf.requesterTagWarnings;
  writeEvidence(`${DIR}/step3-shared.json`, { jsReq, itemId: jsItem.id, item: s3, sharedLog, warnings: s3Warnings });

  // 4. Backfill: bob's book delivered while off, then on (tags it), then off/on again (writes nothing)
  await setTagging(admin, false);
  const bobReq = (await bob.rmab.requestBook(madeUpBook('B0E2E232B1', 'Bobwords'))).request.id;
  const bobSettled = await waitSettled(bobReq);
  const bobItem = await absItemFor(abs, await importGenerated(admin, bobReq, 'bob'));
  await runJob(admin, 'plex_recently_added_check');
  const s4Off = { settled: bobSettled, status: requestStatus(bobReq), ...(await itemTags(abs, bobItem.id)) };
  let t0 = dbNow();
  await setTagging(admin, true);
  const backfill1 = await backfillAfter(t0);
  const s4On = await itemTags(abs, bobItem.id);
  await setTagging(admin, false);
  t0 = dbNow();
  await setTagging(admin, true);
  const backfill2 = await backfillAfter(t0);
  const s4Again = await itemTags(abs, bobItem.id);
  writeEvidence(`${DIR}/step4-backfill.json`, { bobReq, itemId: bobItem.id, off: s4Off, backfill1, on: s4On, backfill2, again: s4Again });

  // 5. Exposure: a user limited to req:alice sees only alice's book; filterdata lists every req: tag
  const absUser = { username: 'reader232', password: 'e2e-reader-232-pass' };
  await abs.req('POST', '/api/users', {
    ...absUser, type: 'user', isActive: true,
    permissions: { download: true, update: false, delete: false, upload: false, accessAllLibraries: true, accessAllTags: false, accessExplicitContent: true },
    librariesAccessible: [], itemTagsSelected: ['req:alice'],
  });
  const login = await (await fetch(`${urls.abs()}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(absUser) })).json();
  const reader = new Abs(login.user.accessToken || login.user.token);
  const readerItems = (await reader.libraryItems(libraryId)).map((i) => i.id);
  const asReader = (p: string) => fetch(`${urls.abs()}${p}`, { headers: { Authorization: `Bearer ${reader.token}` } });
  const fd = await asReader(`/api/libraries/${libraryId}/filterdata`);
  const filterTags: string[] = fd.ok
    ? ((await fd.json()).tags ?? [])
    : ((await (await asReader(`/api/libraries/${libraryId}?include=filterdata`)).json()).filterdata?.tags ?? []);
  writeEvidence(`${DIR}/step5-exposure.json`, { readerItems, aliceItem: aliceItem.id, filterTags });

  // 6. carol's denied request, imported by the admin without naming it: never tagged
  const carolReq = (await carol.rmab.requestBook(madeUpBook('B0E2E232C6', 'Carolwords'))).request.id;
  const carolWaiting = await waitSettled(carolReq, ['awaiting_approval']);
  const deny = await admin.post<{ success: boolean }>(`/api/admin/requests/${carolReq}/approve`, { action: 'deny' });
  const carolDenied = requestStatus(carolReq);
  const carolItem = await absItemFor(abs, await importGenerated(admin, carolReq, 'carol'));
  const s6Job = await runJob(admin, 'plex_recently_added_check');
  const s6Delivered = { status: requestStatus(carolReq), mark: bypassMark(carolReq), job: s6Job, ...(await itemTags(abs, carolItem.id)) };
  await runJob(admin, 'plex_library_scan');
  const s6Scan = await itemTags(abs, carolItem.id);
  await setTagging(admin, false);
  t0 = dbNow();
  await setTagging(admin, true);
  const backfill3 = await backfillAfter(t0);
  const s6Backfill = await itemTags(abs, carolItem.id);
  writeEvidence(`${DIR}/step6-unapproved.json`, { carolReq, carolWaiting, deny, carolDenied, itemId: carolItem.id, delivered: s6Delivered, fullScan: s6Scan, backfill3, afterBackfill: s6Backfill });

  // Checks
  expect.soft(ui.checkedBefore, 'off by default').toBe(false);
  expect.soft(ui.putTagRequester, 'the page sends tagRequester').toBe(true);
  expect.soft(ui.putStatus).toBe(200);
  expect.soft(String(ui.warningText), 'amber box: shared tag').toContain('req:johnsmith is shared by "john.smith", "johnsmith"');
  expect.soft(String(ui.warningText), 'amber box: untaggable').toContain('"李雷" has no letters or digits');
  expect.soft(ui.overflowX, '375: no horizontal overflow').toBe(0);
  expect.soft(settingsAfterUi.tagRequester, 'saved').toBe(true);
  expect.soft(aliceStatusBefore, 'precondition: delivered, not yet available').toBe('downloaded');
  expect.soft(s1Before.tags, 'precondition: the manual tag is on the item before RMAB writes').toEqual(['keepme']);
  expect.soft(s1, 'step 1: available, keepme kept, req:alice added').toMatchObject({ status: 'available', job: 'completed', tags: ['keepme', 'req:alice'] });
  expect.soft(taggedLog.length, 'step 1: one Tagged log line').toBe(1);
  expect.soft(s2Matched.tags, 'step 2 precondition: the override match brought the Audible tag').toContain(AUDIBLE_TAG);
  expect.soft(s2Matched.tags, 'step 2 precondition: and dropped req:alice').not.toContain('req:alice');
  expect.soft(s2Repaired.tags, 'step 2: the full scan put req:alice back').toEqual(expect.arrayContaining([AUDIBLE_TAG, 'req:alice']));
  expect.soft(s2Plain.tags, 'step 2: a plain match keeps it').toContain('req:alice');
  expect.soft(s2Forced.tags, 'step 2: a forced ABS scan keeps it').toContain('req:alice');
  expect.soft(s3.status, 'step 3: delivered').toBe('available');
  expect.soft(s3.tags, 'step 3: no shared tag written').not.toContain('req:johnsmith');
  expect.soft(sharedLog.length, 'step 3: the shared-tag warning').toBeGreaterThanOrEqual(1);
  expect.soft(s4Off, 'step 4: delivered while off, untagged').toMatchObject({ status: 'available' });
  expect.soft(s4Off.tags, 'step 4: no tag while off').not.toContain('req:bob');
  expect.soft(backfill1.status).toBe('completed');
  expect.soft(Number(backfill1.result?.tagged), 'step 4: the backfill tagged bob\'s book').toBeGreaterThanOrEqual(1);
  expect.soft(s4On.tags, 'step 4: req:bob').toContain('req:bob');
  expect.soft(backfill2.result, 'step 4: a second backfill writes nothing').toMatchObject({ tagged: 0 });
  expect.soft(Number(backfill2.result?.alreadyTagged), 'step 4: alice and bob already tagged').toBeGreaterThanOrEqual(2);
  expect.soft(s4Again.updatedAt, 'step 4: the item was not saved again').toBe(s4On.updatedAt);
  expect.soft(readerItems, 'step 5: the limited user lists only alice\'s book').toEqual([aliceItem.id]);
  expect.soft(filterTags, 'step 5: filterdata lists every req: tag').toEqual(expect.arrayContaining(['req:alice', 'req:bob']));
  expect.soft([carolWaiting, deny.success, carolDenied], 'step 6 precondition: denied').toEqual(['awaiting_approval', true, 'denied']);
  expect.soft(s6Delivered, 'step 6: delivered, recorded').toMatchObject({ status: 'available', mark: 'manual_import:denied' });
  expect.soft(s6Delivered.tags, 'step 6: no req:carol on delivery').not.toContain('req:carol');
  expect.soft(s6Scan.tags, 'step 6: none after a full scan').not.toContain('req:carol');
  expect.soft(Number(backfill3.result?.skippedUnapproved), 'step 6: the backfill counts it').toBeGreaterThanOrEqual(1);
  expect.soft(s6Backfill.tags, 'step 6: none after the backfill').not.toContain('req:carol');
});
