/**
 * Component: E2E regression #542 (a request marked Explicit marks the Audiobookshelf item explicit)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata (real ABS; fake Audible/Audnexus answers;
 * generated audio). Schedules off (back on at the end). Names and made-up ASINs carry this run's suffix <r>.
 * 1. Requester tagging OFF (the default). eve<r> (local, auto-approve) opens book A (fixture phm) from
 *    Search: the Explicit row at 375 dark; at 1280 light the tick asks first (confirm shot), then Request
 *    sends explicit: true. B (made up) is requested unmarked through the API.
 * 2. Both delivered (manual import of generated audio), a manual ABS tag `keepme` on each, ONE
 *    recently-added check: A explicit in ABS with title, authors, ASIN and tags as before; B untouched
 *    (explicit false, not saved again).
 * 3. ABS filters: a "user" without explicit access lists B but not A, and reads A as 403.
 * 4. My Requests (eve): 1280 light; 375 dark with A disabled and its reason in view; eve ticks B (confirm)
 *    and B is explicit in ABS at once, no scan between. eve's PUT {explicit:false} → 403.
 * 5. Admin dashboard 1280 light: the Explicit pills; B's menu "Remove explicit mark" → the toast says ABS
 *    still marks it; RMAB false, ABS still true.
 * 6. Re-match A with overrideDetails (fake Audnexus gives an Audible tag): positive control the tags were
 *    replaced; explicit still true. Tagging on (backfill), ONE full scan: req:eve<r> back, A still
 *    available and in RMAB's library.
 * 7. Repair: explicit turned off in ABS, ONE full scan turns it back on.
 * 8. Guard: RMAB on an API key whose ABS user can update items but can't see explicit books. C, marked at
 *    request time, delivered: not flagged, still listed and readable through that key, one warning in the
 *    log; A (flagged) is 403 through it. The admin's re-mark shows the failure toast; a repeat PUT says the
 *    same. Explicit access on → ONE recently-added check flags C. The original key is restored.
 * Values read first, then expect.soft; exec bridge required.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackLogsSync, writeEvidence } from '../../lib/harness';
import { dbNow, psql, sqlStr } from './242-helpers';
import { disableSchedules, FAKE_PROXY, printenv, waitStartupSettled } from './284-helpers';
import { absItemFor, backfillAfter, clearEarlierRun, importGenerated, madeUpBook, requestStatus, runJob, setAudibleTags, setTagging, waitSettled } from './232-tag-helpers';
import { absApiKey, absUser, browse, itemState, putExplicit, readStatus, registerSession, setAbsKey, userPermissions } from './542-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '542-explicit';
const AUDIBLE_TAG = 'E2E Audible Tag 542';
const RUN = Date.now().toString(36).slice(-5);
const madeUpAsin = (end: string) => `B0X${RUN.toUpperCase()}${end}`;
const ADMIN_STORAGE = () => evidencePath('storage-state.json');
const marked = (id: string) => psql(`select "explicit"::text from requests where id = ${sqlStr(id)}`);
const logCount = (re: RegExp) => (stackLogsSync('rmab').match(re) || []).length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const disabledJobs: string[] = [];
let restoreKey = '';
let phmAsin = '';

test.afterAll(async () => {
  const admin = await Rmab.loginAdmin();
  if (restoreKey) await setAbsKey(admin, restoreKey).catch(() => undefined);
  for (const id of disabledJobs.splice(0)) await admin.raw('PUT', `/api/admin/jobs/${id}`, { enabled: true });
  await setTagging(admin, false).catch(() => undefined);
  if (phmAsin) await setAudibleTags(phmAsin, []).catch(() => undefined);
});

test('#542: a request marked Explicit marks the Audiobookshelf item explicit', async ({ browser }) => {
  test.setTimeout(2_400_000);
  for (const service of ['abs', 'rmab']) expect(printenv(service, 'HTTPS_PROXY'), `${service} needs --overrides abs-fake-metadata`).toBe(FAKE_PROXY);
  const books = await fakeArr.books();
  const A = books.phm;
  phmAsin = A.asin;
  expect(A.title, 'run with --offline-fixtures').toMatch(/^Fixture Book /);
  const B = madeUpBook(madeUpAsin('B2'), `Plainwords${RUN}`);
  const C = madeUpBook(madeUpAsin('C8'), `Guardwords${RUN}`);

  const admin = await Rmab.loginAdmin();
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  await disableSchedules(admin, disabledJobs);
  await waitStartupSettled();
  const cleared = await clearEarlierRun(abs, [A.asin]);
  await setTagging(admin, false);
  const rootId = (await abs.req<{ id: string }>('GET', '/api/me')).id;
  restoreKey = await absApiKey(abs, rootId, `rmab-e2e-542-restore-${RUN}`);
  expect((await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false })).status).toBe(200);
  const eve = await registerSession(admin, `eve${RUN}`);
  writeEvidence(`${DIR}/step0-run.json`, { run: RUN, A: A.asin, B: B.asin, C: C.asin, eve: eve.name, clearedFromEarlierRun: cleared });

  // 1. The details modal: the Explicit row at 375 dark; at 1280 light the tick asks first, then Request
  const ui: Record<string, unknown> = {};
  const openA = async (page: import('@playwright/test').Page) => {
    await page.goto(`/search?q=${encodeURIComponent(A.title)}`);
    await page.getByRole('button', { name: `View details for ${A.title} by ${A.author}` }).first().click();
    const box = page.getByRole('checkbox', { name: /^Explicit/ });
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.scrollIntoViewIfNeeded();
    return box;
  };
  {
    const { ctx, page, shot, overflowX } = await browse(browser, eve.storage, 375, 812, true);
    await openA(page);
    await shot(DIR, 'modal-375-dark');
    ui.modalOverflow375 = await overflowX();
    await ctx.close();
  }
  {
    const { ctx, page, shot } = await browse(browser, eve.storage, 1280, 900, false);
    const box = await openA(page);
    ui.checkedAtOpen = await box.isChecked();
    await box.click();
    const confirm = page.getByRole('heading', { name: 'Mark as explicit?' });
    await expect(confirm).toBeVisible();
    ui.confirmText = (await page.getByText(/Audiobookshelf will hide this book/).textContent())?.trim();
    ui.checkedWhileAsking = await box.isChecked();
    await shot(DIR, 'confirm-1280-light');
    await page.getByRole('button', { name: 'Mark explicit' }).click();
    await expect(box).toBeChecked();
    await shot(DIR, 'modal-1280-light');
    const postP = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/requests');
    const resP = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/requests');
    await page.getByRole('button', { name: 'Request Audiobook' }).click();
    ui.postExplicit = (await postP).postDataJSON().explicit;
    ui.postStatus = (await resP).status();
    await ctx.close();
  }
  const aReq = (await eve.rmab.findRequest(A.asin))?.id as string;
  const bReq = (await eve.rmab.requestBook(B)).request.id;
  const s1 = { aMarked: marked(aReq), bMarked: marked(bReq) };
  writeEvidence(`${DIR}/step1-modal.json`, { ui, aReq, bReq, ...s1 });

  // 2. Delivery with tagging off: A flagged, other metadata and tags kept; B untouched
  const settled = { a: await waitSettled(aReq), b: await waitSettled(bReq) };
  const itemA = (await absItemFor(abs, await importGenerated(admin, aReq, 'a542'))).id;
  const itemB = (await absItemFor(abs, await importGenerated(admin, bReq, 'b542'))).id;
  for (const id of [itemA, itemB]) await abs.req('PATCH', `/api/items/${id}/media`, { tags: ['keepme'] });
  const s2Before = { a: await itemState(abs, itemA), b: await itemState(abs, itemB), statusA: requestStatus(aReq), statusB: requestStatus(bReq) };
  const s2Job = await runJob(admin, 'plex_recently_added_check');
  const s2 = { job: s2Job, a: await itemState(abs, itemA), b: await itemState(abs, itemB), statusA: requestStatus(aReq), statusB: requestStatus(bReq) };
  const markedLogA = new RegExp(`Marked "[^"]*" \\(Audiobookshelf item ${itemA}\\) explicit`, 'g');
  const s2Log = logCount(markedLogA);
  writeEvidence(`${DIR}/step2-delivery.json`, { settled, itemA, itemB, before: s2Before, after: s2, markedLogLines: s2Log });

  // 3. What ABS filters: a user without explicit access lists B, not A
  const kid = await absUser(abs, `kid${RUN}`, false);
  const s3 = { kidItems: (await kid.client.libraryItems(libraryId)).map((i) => i.id), kidReadA: await readStatus(kid.client, itemA), kidReadB: await readStatus(kid.client, itemB) };
  writeEvidence(`${DIR}/step3-abs-filter.json`, s3);

  // 4. My Requests: A disabled with its reason; eve ticks B (confirm) and ABS has it at once
  {
    const { ctx, page, shot } = await browse(browser, eve.storage, 1280, 900, false);
    await page.goto('/requests');
    await expect(page.getByText('Only an admin can remove this')).toBeVisible({ timeout: 30_000 });
    await shot(DIR, 'my-requests-1280-light');
    await ctx.close();
  }
  const s4: Record<string, unknown> = {};
  {
    const { ctx, page, shot, overflowX } = await browse(browser, eve.storage, 375, 812, true);
    await page.goto('/requests');
    const reason = page.getByText('Only an admin can remove this');
    await expect(reason).toBeVisible({ timeout: 30_000 });
    await reason.scrollIntoViewIfNeeded();
    s4.reasonInView = await reason.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0; });
    s4.lockedDisabled = await page.getByRole('checkbox', { name: /^Explicit/, disabled: true }).count();
    await shot(DIR, 'my-requests-disabled-375-dark');
    s4.overflow375 = await overflowX();
    const open = page.getByRole('checkbox', { name: /^Explicit/, disabled: false });
    s4.openBoxes = await open.count();
    await open.first().scrollIntoViewIfNeeded();
    await open.first().click();
    await expect(page.getByRole('heading', { name: 'Mark as explicit?' })).toBeVisible();
    await shot(DIR, 'my-requests-confirm-375-dark');
    const putP = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/requests/${bReq}/explicit`);
    await page.getByRole('button', { name: 'Mark explicit' }).click();
    const put = await putP;
    s4.putStatus = put.status();
    s4.putBody = await put.json();
    await expect(page.getByText('Only an admin can remove this')).toHaveCount(2);
    await shot(DIR, 'my-requests-marked-375-dark');
    await ctx.close();
  }
  s4.bNow = await itemState(abs, itemB);
  s4.bMarked = marked(bReq);
  s4.ownerClear = await putExplicit(eve.rmab, bReq, false);
  writeEvidence(`${DIR}/step4-my-requests.json`, s4);

  // 5. Admin: pills, B's menu item, the clear toast; ABS keeps the flag
  const s5: Record<string, unknown> = {};
  {
    const { ctx, page, shot } = await browse(browser, ADMIN_STORAGE(), 1280, 900, false);
    await page.goto('/admin');
    const rowB = page.locator('tr', { has: page.getByText(B.title) });
    await expect(rowB).toBeVisible({ timeout: 30_000 });
    await rowB.scrollIntoViewIfNeeded();
    s5.pills = await page.locator('tr span', { hasText: /^Explicit$/ }).count();
    await shot(DIR, 'admin-pill-1280-light');
    await rowB.getByTitle('Actions').click();
    const item = page.getByRole('button', { name: 'Remove explicit mark' });
    await expect(item).toBeVisible();
    await shot(DIR, 'admin-menu-1280-light');
    await item.click();
    const toast = page.getByText('Mark removed. Audiobookshelf still marks this book explicit; change it there.');
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await shot(DIR, 'admin-clear-toast-1280-light');
    await ctx.close();
  }
  s5.bMarked = marked(bReq);
  s5.bAbs = (await itemState(abs, itemB)).explicit;
  writeEvidence(`${DIR}/step5-admin.json`, s5);

  // 6. Re-match A with override (positive control: tags replaced), then tagging on and one full scan
  await setAudibleTags(A.asin, [AUDIBLE_TAG]);
  await abs.req('POST', `/api/items/${itemA}/match`, { provider: 'audible', asin: A.asin, overrideDetails: true });
  const s6Matched = await itemState(abs, itemA);
  const t6 = dbNow();
  await setTagging(admin, true);
  const backfill = await backfillAfter(t6);
  const s6Job = await runJob(admin, 'plex_library_scan');
  const s6 = { matched: s6Matched, backfill, job: s6Job, after: await itemState(abs, itemA), statusA: requestStatus(aReq),
    inRmabLibrary: psql(`select count(*) from plex_library where plex_guid = ${sqlStr(itemA)}`) };
  writeEvidence(`${DIR}/step6-rematch.json`, s6);

  // 7. Repair: explicit turned off in ABS comes back after one full scan
  await abs.req('PATCH', `/api/items/${itemA}/media`, { metadata: { explicit: false } });
  const s7Before = (await itemState(abs, itemA)).explicit;
  const s7Job = await runJob(admin, 'plex_library_scan');
  const s7 = { before: s7Before, job: s7Job, after: await itemState(abs, itemA), markedLogLines: logCount(markedLogA) };
  writeEvidence(`${DIR}/step7-repair.json`, s7);

  // 8. Guard: a key whose user can't see explicit books
  const limited = await absUser(abs, `rmabkey${RUN}`, false, true);
  const limitedKey = await absApiKey(abs, limited.id, `rmab-e2e-542-limited-${RUN}`);
  const keyClient = new Abs(limitedKey);
  await setAbsKey(admin, limitedKey);
  const cPost = await eve.rmab.raw('POST', '/api/requests', { audiobook: { asin: C.asin, title: C.title, author: C.author, narrator: C.narrator }, explicit: true });
  const cReq = ((await cPost.json()).request?.id) as string;
  const cSettled = await waitSettled(cReq);
  const itemC = (await absItemFor(abs, await importGenerated(admin, cReq, 'c542'))).id;
  const warnRe = new RegExp(`Not marking [^\\n]*"${esc(C.title)}"[^\\n]*explicit: the Audiobookshelf API key's user can't see explicit books`, 'g');
  const s8Job = await runJob(admin, 'plex_recently_added_check');
  const s8: Record<string, unknown> = {
    cPostStatus: cPost.status, cSettled, cMarked: marked(cReq), itemC, job: s8Job, status: requestStatus(cReq),
    absC: (await itemState(abs, itemC)).explicit,
    keyListsC: (await keyClient.libraryItems(libraryId)).some((i) => i.id === itemC),
    keyReadC: await readStatus(keyClient, itemC), keyReadA: await readStatus(keyClient, itemA), warningLines: logCount(warnRe),
  };
  {
    const { ctx, page, shot } = await browse(browser, ADMIN_STORAGE(), 1280, 900, false);
    await page.goto('/admin');
    const rowC = page.locator('tr', { has: page.getByText(C.title) });
    await expect(rowC).toBeVisible({ timeout: 30_000 });
    await rowC.getByTitle('Actions').click();
    await page.getByRole('button', { name: 'Remove explicit mark' }).click();
    await expect(page.getByText('Explicit mark removed')).toBeVisible({ timeout: 15_000 });
    await rowC.getByTitle('Actions').click();
    const putP = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/requests/${cReq}/explicit`);
    await page.getByRole('button', { name: 'Mark explicit' }).click();
    s8.adminRemark = await (await putP).json();
    await expect(page.getByText(/^Saved\. Audiobookshelf wasn't updated:/)).toBeVisible({ timeout: 15_000 });
    await shot(DIR, 'failure-toast-1280-light');
    await ctx.close();
  }
  s8.repeatPut = await putExplicit(eve.rmab, cReq, true);
  await abs.req('PATCH', `/api/users/${limited.id}`, { permissions: userPermissions(true, true) });
  s8.keyMe = await keyClient.req<{ permissions: Record<string, unknown> }>('GET', '/api/me').then((m) => m.permissions?.accessExplicitContent).catch(() => 'error');
  s8.jobAfterAccess = await runJob(admin, 'plex_recently_added_check');
  s8.absCAfterAccess = (await itemState(abs, itemC)).explicit;
  await setAbsKey(admin, restoreKey);
  writeEvidence(`${DIR}/step8-guard.json`, s8);

  // Checks
  const before = s2Before.a;
  expect.soft(ui.checkedAtOpen, 'step 1: the box starts unticked').toBe(false);
  expect.soft(ui.checkedWhileAsking, 'step 1: not ticked until confirmed').toBe(false);
  expect.soft(String(ui.confirmText), 'step 1: the confirm sentence').toContain('only an admin can remove the mark');
  expect.soft([ui.postExplicit, ui.postStatus], 'step 1: Request sent explicit').toEqual([true, 201]);
  expect.soft(ui.modalOverflow375, '375: no horizontal overflow').toBe(0);
  expect.soft(s1, 'step 1: A stored marked, B not').toEqual({ aMarked: 'true', bMarked: 'false' });
  expect.soft([s2Before.statusA, s2Before.statusB, before.explicit === true], 'step 2 precondition: delivered, not yet flagged').toEqual(['downloaded', 'downloaded', false]);
  expect.soft([s2.statusA, s2.statusB], 'step 2: both available').toEqual(['available', 'available']);
  expect.soft(s2.a.explicit, 'step 2: A explicit in ABS').toBe(true);
  expect.soft({ title: s2.a.title, authors: s2.a.authors, asin: s2.a.asin, tags: s2.a.tags }, 'step 2: other metadata and tags kept, no req: tag with tagging off')
    .toEqual({ title: before.title, authors: before.authors, asin: before.asin, tags: ['keepme'] });
  expect.soft(s2Log, 'step 2: one Marked log line').toBe(1);
  expect.soft(s2.b.explicit === true, 'step 2: B not flagged').toBe(false);
  expect.soft(s2.b.updatedAt, 'step 2: B not saved again').toBe(s2Before.b.updatedAt);
  expect.soft(s3.kidItems, 'step 3: listed without explicit access: B').toContain(itemB);
  expect.soft(s3.kidItems, 'step 3: not A').not.toContain(itemA);
  expect.soft([s3.kidReadA, s3.kidReadB], 'step 3: A 403, B readable').toEqual([403, 200]);
  expect.soft([s4.reasonInView, s4.lockedDisabled, s4.overflow375], 'step 4: A disabled with its reason in view at 375').toEqual([true, 1, 0]);
  expect.soft(s4.putStatus, 'step 4: eve marks B').toBe(200);
  expect.soft(s4.putBody, 'step 4: written at once').toMatchObject({ success: true, absUpdated: true });
  expect.soft((s4.bNow as { explicit: unknown }).explicit, 'step 4: B explicit in ABS with no scan between').toBe(true);
  expect.soft((s4.ownerClear as { status: number }).status, 'step 4: the requester cannot clear').toBe(403);
  expect.soft(Number(s5.pills), 'step 5: pills on A and B').toBeGreaterThanOrEqual(2);
  expect.soft([s5.bMarked, s5.bAbs], 'step 5: cleared in RMAB, ABS keeps the flag').toEqual(['false', true]);
  expect.soft(s6Matched.tags, 'step 6 positive control: the override replaced the tags').toContain(AUDIBLE_TAG);
  expect.soft(s6Matched.tags, 'step 6 positive control: keepme gone').not.toContain('keepme');
  expect.soft(s6Matched.explicit, 'step 6: explicit survives the override match').toBe(true);
  expect.soft(s6.after.tags, 'step 6: req tag and Audible tag').toEqual(expect.arrayContaining([AUDIBLE_TAG, `req:${eve.name}`]));
  expect.soft([s6.after.explicit, s6.statusA, s6.inRmabLibrary], 'step 6: still explicit, available, in RMAB\'s library').toEqual([true, 'available', '1']);
  expect.soft([s7.before, s7.after.explicit], 'step 7: repaired').toEqual([false, true]);
  expect.soft([s8.cPostStatus, s8.cMarked, s8.status], 'step 8 precondition: C marked and delivered').toEqual([201, 'true', 'available']);
  expect.soft(s8.absC === true, 'step 8: C not flagged through a key that cannot see explicit books').toBe(false);
  expect.soft([s8.keyListsC, s8.keyReadC], 'step 8: C still listed and readable through the key').toEqual([true, 200]);
  expect.soft(s8.keyReadA, 'step 8: a flagged book is hidden from that key').toBe(403);
  expect.soft(Number(s8.warningLines), 'step 8: the warning names C').toBeGreaterThanOrEqual(1);
  expect.soft(s8.adminRemark, 'step 8: the re-mark saved, ABS not updated').toMatchObject({ success: true, absUpdated: false });
  expect.soft((s8.repeatPut as { body: Record<string, unknown> }).body, 'step 8: a repeat mark retries and says why').toMatchObject({ absUpdated: false, message: expect.stringContaining("can't see explicit books") });
  expect.soft(s8.keyMe, 'step 8: access turned on').toBe(true);
  expect.soft(s8.absCAfterAccess, 'step 8: one recently-added check flags C').toBe(true);
});
