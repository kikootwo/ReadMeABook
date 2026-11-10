/**
 * Component: E2E regression #232 (tag the requester on the Audiobookshelf item)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata (real ABS; fake Audible/Audnexus answers;
 * generated audio). Schedules off (back on at the end). Every name and made-up ASIN carries this run's
 * suffix <r>, and a fixture book an earlier run delivered is taken back out first, so the spec can run
 * again on the same stack. Local users registered with no approval: alice<r>, bob<r>, john.smith<r>,
 * johnsmith<r>, three CJK letters (auto-approve), carol<r> (approval required).
 * 1. Tagging on through the settings checkbox (shots: 1280 light, 375 dark with the checkbox, its text and
 *    the amber box). alice's martian runs a real download to `downloaded`; the ABS scan adds the item; a
 *    manual ABS tag `keepme` is added before RMAB's first write; ONE recently-added check → the item holds
 *    `keepme` then `req:alice<r>`.
 * 2. A real ABS match with overrideDetails, the fake Audnexus answering an Audible tag genre: precondition
 *    the Audible tag present and the tag gone. ONE full scan → the tag back, Audible tag kept. A match
 *    without override flags and a finished ABS `scan?force=1` leave it (whether either saved the item is
 *    recorded: in practice neither does).
 * 3. john.smith<r>'s artemis (manual import of generated audio, unnamed) → available, no shared tag;
 *    log `Not tagging with req:johnsmith<r>`; the settings warnings list the shared tag and the CJK name.
 * 4. Tagging off; bob's made-up book delivered (manual import) untagged. On → the backfill job tags it
 *    (`tagged` >= 1). Off and on again → `tagged` 0, `alreadyTagged` >= 2, the item's updatedAt unchanged.
 * 5. An ABS user limited to alice's tag lists only alice's book; the filterdata endpoint answers it (200).
 *    Not covered: `req:` tags in the filterdata tag list (ABS caches it per library for 30 min from the
 *    first scan, so within a run both users get the list built before any tag existed; recorded only).
 * 6. carol (approval required) requests a made-up book, the admin denies it, then manual-imports that book
 *    without naming the request (POST /api/admin/manual-import): `available`, recorded
 *    `manual_import:denied`, no `req:carol<r>` after the recently-added check, a full scan, or a backfill
 *    (`skippedUnapproved` >= 1).
 * 7. The admin manual-imports a made-up book nobody requested (its book row inserted first: offline RMAB
 *    can't fetch a book by ASIN): the import creates the admin's own request (no download record) →
 *    `available`, no `req:` tag after the recently-added check, a full scan, or a backfill
 *    (`skippedImported` >= 1).
 * Values read first, then expect.soft; exec bridge required.
 */

import { test, expect, type Locator } from '@playwright/test';
import { Abs, authState, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackLogsSync, urls, waitFor, writeEvidence } from '../../lib/harness';
import { dbNow, markJobs, psql, sqlStr, waitOrganized } from './242-helpers';
import { disableSchedules, FAKE_PROXY, printenv, session, waitStartupSettled, type FixtureBook } from './284-helpers';
import {
  absItemFor, absLastScan, backfillAfter, bypassMark, clearEarlierRun, importGenerated, importUnrequested, itemTags, madeUpBook,
  registerUser, requestStatus, runJob, setAudibleTags, setTagging, waitSettled,
} from './232-tag-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '232-tags';
const AUDIBLE_TAG = 'E2E Audible Tag';
// This run's suffix: names, made-up ASINs and titles differ from any earlier run on the stack
const RUN = Date.now().toString(36).slice(-5);
const NAME = {
  alice: `alice${RUN}`, bob: `bob${RUN}`, js1: `john.smith${RUN}`, js2: `johnsmith${RUN}`, carol: `carol${RUN}`,
  // CJK letters only: a name that leaves no tag
  cjk: [...RUN].map((c) => String.fromCodePoint(0x4e00 + parseInt(c, 36) * 37 + 11)).join(''),
};
const tag = (name: string) => `req:${name}`;
const SHARED = tag(`johnsmith${RUN}`);
const madeUpAsin = (end: string) => `B0E${RUN.toUpperCase()}${end}`;

/**
 * Scroll the setting to the top of the view, just below the sticky page header (the checkbox must be
 * what a point on it hits, not the header), and report whether the checkbox and all its text are visible.
 */
async function showBelowHeader(box: Locator) {
  return box.evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -16);
    // The checkbox's centre and the top edge of its title must both be the page itself, not the header
    const label = document.querySelector(`label[for="${el.id}"]`);
    let header: Element | null = document.elementFromPoint(window.innerWidth / 2, 2);
    while (header && !['sticky', 'fixed'].includes(getComputedStyle(header).position)) header = header.parentElement;
    const clear = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && !(header && header.contains(hit));
    };
    const hits = () => {
      const r = el.getBoundingClientRect();
      const t = label?.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el && !!t && clear(t.left + 4, t.top - 6);
    };
    for (let i = 0; i < 60 && !hits(); i++) window.scrollBy(0, -8);
    const help = document.getElementById(el.getAttribute('aria-describedby') || '')?.getBoundingClientRect();
    return { checkboxTop: el.getBoundingClientRect().top, notCovered: hits(), helpBottom: help?.bottom ?? null, viewport: window.innerHeight };
  });
}
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

  // 0. A rerun on this stack: take the fixture books an earlier run delivered back out; users
  const cleared = await clearEarlierRun(abs, [martian.asin, books.artemis.asin]);
  writeEvidence(`${DIR}/step0-run.json`, { run: RUN, names: NAME, clearedFromEarlierRun: cleared });
  expect((await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false })).status).toBe(200);
  const alice = await registerUser(admin, NAME.alice, true);
  const bob = await registerUser(admin, NAME.bob, true);
  const js1 = await registerUser(admin, NAME.js1, true);
  await registerUser(admin, NAME.js2, true);
  await registerUser(admin, NAME.cjk, true);
  const carol = await registerUser(admin, NAME.carol, false);

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
    ui.inView1280 = await showBelowHeader(box);
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
    // The checkbox, its title and text at the top of the shot, the amber box below
    ui.inView375 = await showBelowHeader(box);
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
  const taggedLog = stackLogsSync('rmab').match(new RegExp(`Tagged "[^"]*" \\(Audiobookshelf item ${aliceItem.id}\\) with ${tag(NAME.alice)}`, 'g')) || [];
  writeEvidence(`${DIR}/step1-delivery.json`, { aliceReq, aliceStatusBefore, itemId: aliceItem.id, before: s1Before, after: s1, taggedLog });

  // 2. ABS re-match with override drops the tag; one full scan puts it back
  await setAudibleTags(martian.asin, [AUDIBLE_TAG]);
  await abs.req('POST', `/api/items/${aliceItem.id}/match`, { provider: 'audible', asin: martian.asin, overrideDetails: true });
  const s2Matched = await itemTags(abs, aliceItem.id);
  const s2Job = await runJob(admin, 'plex_library_scan');
  const s2Repaired = await itemTags(abs, aliceItem.id);
  await abs.req('POST', `/api/items/${aliceItem.id}/match`, { provider: 'audible', asin: martian.asin });
  const s2Plain = { itemSaved: false, ...(await itemTags(abs, aliceItem.id)) };
  s2Plain.itemSaved = s2Plain.updatedAt !== s2Repaired.updatedAt;
  // A forced scan is done when the library's lastScan moves (the item itself may not be saved)
  const lastScanBefore = await absLastScan(abs, libraryId);
  const forced = await fetch(`${urls.abs()}/api/libraries/${libraryId}/scan?force=1`, { method: 'POST', headers: { Authorization: `Bearer ${abs.token}` } });
  const lastScanAfter = await waitFor('ABS forced scan finished', async () => {
    const t = await absLastScan(abs, libraryId);
    return t !== null && t !== lastScanBefore ? t : null;
  }, { timeoutMs: 120_000, intervalMs: 2_000 }).catch(() => null);
  const s2ForcedTags = await itemTags(abs, aliceItem.id);
  const s2Forced = { scanStatus: forced.status, lastScanBefore, lastScanAfter, itemSaved: s2ForcedTags.updatedAt !== s2Plain.updatedAt, ...s2ForcedTags };
  writeEvidence(`${DIR}/step2-rematch.json`, { matched: s2Matched, fullScan: s2Job, repaired: s2Repaired, plainMatch: s2Plain, forcedScan: s2Forced });

  // 3. john.smith<r> and johnsmith<r> share one tag: neither is tagged
  const jsReq = (await js1.rmab.requestBook(books.artemis)).request.id;
  const jsSettled = await waitSettled(jsReq);
  const jsItem = await absItemFor(abs, await importGenerated(admin, jsReq, 'johnsmith'));
  const s3Job = await runJob(admin, 'plex_recently_added_check');
  const s3 = { settled: jsSettled, status: requestStatus(jsReq), job: s3Job, ...(await itemTags(abs, jsItem.id)) };
  const sharedLog = stackLogsSync('rmab').match(new RegExp(`Not tagging with ${SHARED}: shared by [^\\n]*`, 'g')) || [];
  const s3Warnings = (await admin.get<{ audiobookshelf: Record<string, unknown> }>('/api/admin/settings')).audiobookshelf.requesterTagWarnings;
  writeEvidence(`${DIR}/step3-shared.json`, { jsReq, itemId: jsItem.id, item: s3, sharedLog, warnings: s3Warnings });

  // 4. Backfill: bob's book delivered while off, then on (tags it), then off/on again (writes nothing)
  await setTagging(admin, false);
  const bobReq = (await bob.rmab.requestBook(madeUpBook(madeUpAsin('B1'), `Bobwords${RUN}`))).request.id;
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

  // 5. Exposure: a user limited to alice's tag sees only alice's book; the filterdata endpoint answers it
  const absUser = { username: `reader${RUN}`, password: 'e2e-reader-232-pass' };
  await abs.req('POST', '/api/users', {
    ...absUser, type: 'user', isActive: true,
    permissions: { download: true, update: false, delete: false, upload: false, accessAllLibraries: true, accessAllTags: false, accessExplicitContent: true },
    librariesAccessible: [], itemTagsSelected: [tag(NAME.alice)],
  });
  const login = await (await fetch(`${urls.abs()}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(absUser) })).json();
  const reader = new Abs(login.user.accessToken || login.user.token);
  const readerItems = (await reader.libraryItems(libraryId)).map((i) => i.id);
  // ABS 2.37.1 builds filterdata per library (no user argument) and caches it for 30 minutes from the
  // first scan; tags written through the API join it only when that cache is rebuilt. Recorded, not
  // asserted: within one run the reader and root both see the cache built before any req: tag existed.
  const fdOf = async (token: string) => {
    const res = await fetch(`${urls.abs()}/api/libraries/${libraryId}/filterdata`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, tags: res.ok ? ((await res.json()).tags ?? null) : null };
  };
  const readerFilter = await fdOf(reader.token);
  const rootFilter = await fdOf(abs.token);
  test.info().annotations.push({ type: 'not covered', description: 'step 5: req: tags in the filterdata tag list (ABS caches it per library for 30 min); both lists recorded, not checked' });
  writeEvidence(`${DIR}/step5-exposure.json`, { readerItems, aliceItem: aliceItem.id, readerFilter, rootFilter });

  // 6. carol's denied request, imported by the admin without naming it: never tagged
  const carolReq = (await carol.rmab.requestBook(madeUpBook(madeUpAsin('C6'), `Carolwords${RUN}`))).request.id;
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

  // 7. A made-up book nobody requested (book row seeded), imported by the admin by book id: the import's own admin request is never tagged
  const unrequested = await importUnrequested(admin, madeUpBook(madeUpAsin('A7'), `Adminwords${RUN}`));
  const owner = psql(`select concat_ws('|', u.role, (select count(*) from download_history d where d.request_id = r.id)) from requests r join users u on u.id = r.user_id where r.id = ${sqlStr(unrequested.requestId)}`);
  const adminItem = await absItemFor(abs, unrequested.filePath);
  const s7Job = await runJob(admin, 'plex_recently_added_check');
  const s7Delivered = { status: requestStatus(unrequested.requestId), owner, job: s7Job, ...(await itemTags(abs, adminItem.id)) };
  await runJob(admin, 'plex_library_scan');
  const s7Scan = await itemTags(abs, adminItem.id);
  await setTagging(admin, false);
  t0 = dbNow();
  await setTagging(admin, true);
  const backfill4 = await backfillAfter(t0);
  const s7Backfill = await itemTags(abs, adminItem.id);
  writeEvidence(`${DIR}/step7-admin-import.json`, { requestId: unrequested.requestId, itemId: adminItem.id, delivered: s7Delivered, fullScan: s7Scan, backfill4, afterBackfill: s7Backfill });
  const reqTags = (tags: string[]) => tags.filter((t) => t.startsWith('req:'));

  // Checks
  const ALICE = tag(NAME.alice);
  expect.soft(ui.checkedBefore, 'off by default').toBe(false);
  expect.soft(ui.putTagRequester, 'the page sends tagRequester').toBe(true);
  expect.soft(ui.putStatus).toBe(200);
  expect.soft(String(ui.warningText), 'amber box: shared tag, two names').toContain(`${SHARED} is shared by "${NAME.js1}", "${NAME.js2}": neither is tagged.`);
  expect.soft(String(ui.warningText), 'amber box: untaggable').toContain(`"${NAME.cjk}" can't be turned into a tag`);
  expect.soft(String(ui.warningText), 'amber box: a tag of your own, not the shared one').toContain('a tag of your own in Audiobookshelf, not the shared one');
  expect.soft(ui.overflowX, '375: no horizontal overflow').toBe(0);
  for (const [label, seen] of [['1280', ui.inView1280], ['375', ui.inView375]] as const) {
    const v = seen as { notCovered: boolean; helpBottom: number | null; viewport: number };
    expect.soft(v.notCovered && v.helpBottom !== null && v.helpBottom <= v.viewport, `${label}: the checkbox (not under the header) and its text in the shot ${JSON.stringify(v)}`).toBe(true);
  }
  expect.soft(settingsAfterUi.tagRequester, 'saved').toBe(true);
  expect.soft(aliceStatusBefore, 'precondition: delivered, not yet available').toBe('downloaded');
  expect.soft(s1Before.tags, 'precondition: the manual tag is on the item before RMAB writes').toEqual(['keepme']);
  expect.soft(s1, 'step 1: available, keepme kept, alice tagged').toMatchObject({ status: 'available', job: 'completed', tags: ['keepme', ALICE] });
  expect.soft(taggedLog.length, 'step 1: one Tagged log line').toBe(1);
  expect.soft(s2Matched.tags, 'step 2 precondition: the override match brought the Audible tag').toContain(AUDIBLE_TAG);
  expect.soft(s2Matched.tags, 'step 2 precondition: and dropped alice\'s tag').not.toContain(ALICE);
  expect.soft(s2Repaired.tags, 'step 2: the full scan put alice\'s tag back').toEqual(expect.arrayContaining([AUDIBLE_TAG, ALICE]));
  expect.soft(s2Plain.tags, 'step 2: the tag is still there after a plain match').toContain(ALICE);
  expect.soft(s2Forced.lastScanAfter, 'step 2: the forced ABS scan finished').not.toBeNull();
  expect.soft(s2Forced.tags, 'step 2: the tag is still there after the forced scan').toContain(ALICE);
  expect.soft(s3.status, 'step 3: delivered').toBe('available');
  expect.soft(s3.tags, 'step 3: no shared tag written').not.toContain(SHARED);
  expect.soft(sharedLog.length, 'step 3: the shared-tag warning').toBeGreaterThanOrEqual(1);
  expect.soft(s4Off, 'step 4: delivered while off, untagged').toMatchObject({ status: 'available' });
  expect.soft(s4Off.tags, 'step 4: no tag while off').not.toContain(tag(NAME.bob));
  expect.soft(backfill1.status).toBe('completed');
  expect.soft(Number(backfill1.result?.tagged), 'step 4: the backfill tagged bob\'s book').toBeGreaterThanOrEqual(1);
  expect.soft(s4On.tags, 'step 4: bob tagged').toContain(tag(NAME.bob));
  expect.soft(backfill2.result, 'step 4: a second backfill writes nothing').toMatchObject({ tagged: 0 });
  expect.soft(Number(backfill2.result?.alreadyTagged), 'step 4: alice and bob already tagged').toBeGreaterThanOrEqual(2);
  expect.soft(s4Again.updatedAt, 'step 4: the item was not saved again').toBe(s4On.updatedAt);
  expect.soft(readerItems, 'step 5: the limited user lists only alice\'s book').toEqual([aliceItem.id]);
  expect.soft(readerFilter.status, 'step 5: the filterdata endpoint answers the limited user').toBe(200);
  expect.soft([carolWaiting, deny.success, carolDenied], 'step 6 precondition: denied').toEqual(['awaiting_approval', true, 'denied']);
  expect.soft(s6Delivered, 'step 6: delivered, recorded').toMatchObject({ status: 'available', mark: 'manual_import:denied' });
  expect.soft(s6Delivered.tags, 'step 6: no carol tag on delivery').not.toContain(tag(NAME.carol));
  expect.soft(s6Scan.tags, 'step 6: none after a full scan').not.toContain(tag(NAME.carol));
  expect.soft(Number(backfill3.result?.skippedUnapproved), 'step 6: the backfill counts it').toBeGreaterThanOrEqual(1);
  expect.soft(s6Backfill.tags, 'step 6: none after the backfill').not.toContain(tag(NAME.carol));
  expect.soft(s7Delivered, 'step 7 precondition: delivered; the admin\'s request, no download record').toMatchObject({ status: 'available', owner: 'admin|0' });
  expect.soft(reqTags(s7Delivered.tags), 'step 7: no req: tag on delivery').toEqual([]);
  expect.soft(reqTags(s7Scan.tags), 'step 7: none after a full scan').toEqual([]);
  expect.soft(Number(backfill4.result?.skippedImported), 'step 7: the backfill counts it').toBeGreaterThanOrEqual(1);
  expect.soft(reqTags(s7Backfill.tags), 'step 7: none after the backfill').toEqual([]);
});
