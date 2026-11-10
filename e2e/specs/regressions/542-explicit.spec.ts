/**
 * Component: E2E regression #542 (a request marked Explicit marks the Audiobookshelf item explicit)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata (real ABS; fake Audible/Audnexus answers;
 * generated audio). Schedules off (back on at the end). Names and made-up ASINs carry this run's suffix <r>.
 * 0. The Explicit mark setting (542-setting-leg.ts): off on the fresh stack, so no control anywhere (details
 *    modal, My Requests, admin table and menu), explicit on create ignored, a direct PUT refused (403); the
 *    admin turns it on in Settings (switch shots); its request Z is deleted. Legs 1-8 run with it on.
 * 1. Requester tagging OFF (the default). eve<r> (local, auto-approve) opens book A (fixture phm) from
 *    Search (search and details answers replayed in the browser: the proxy refuses RMAB's catalog calls):
 *    the Explicit row and its confirm at 375 dark; at 1280 light the tick asks first (confirm shot), then
 *    Request sends explicit: true to the real route. B (made up) is requested unmarked through the API.
 * 2. Both delivered (A by the stack scenario's real download, or generated audio when nothing is found;
 *    B by manual import of generated audio), a manual ABS tag `keepme` on each, ONE
 *    recently-added check: A explicit in ABS with title, authors, ASIN and tags as before; B untouched
 *    (explicit false, not saved again).
 * 3. ABS filters: a "user" without explicit access lists B but not A, and reads A as 403.
 * 4. My Requests (eve): 1280 light; 375 dark with A disabled and its reason in view; eve ticks B (confirm)
 *    and B is explicit in ABS at once, no scan between. eve's PUT {explicit:false} → 403.
 * 5. Admin dashboard 1280 light (and the pills in dark): B's menu "Remove explicit mark" → the toast says to
 *    change it in ABS if marked there; RMAB false, ABS still true.
 * 5b. D (made up), marked by eve: her card at 375 dark with the box beside Cancel; her request then failed
 *    (set in the database) and the admin's own marked request of D; clearing eve's mark counts the other.
 * 6. Re-match A with overrideDetails (fake Audnexus gives an Audible tag): positive control the tags were
 *    replaced; explicit still true. Tagging on (backfill), ONE full scan: req:eve<r> back, A still
 *    available and in RMAB's library.
 * 7. Repair: explicit turned off in ABS, ONE full scan turns it back on.
 * 8. Guard: RMAB on an API key whose ABS user can update items but can't see explicit books. C, marked at
 *    request time, delivered: not flagged, still listed and readable through that key, one warning in the
 *    log; A (flagged) is 403 through it. The admin's re-mark shows the failure toast and an admin's repeat
 *    PUT says the same; eve's repeat PUT is a plain 200; eve marking B gets the requester's line. Explicit
 *    access on → ONE recently-added check flags C.
 * Leaves the stack as found: the original ABS key goes back (its stored value, then the 1-minute config
 * cache runs out), and the ABS users and keys made here are removed.
 * Values read first, then expect.soft; exec bridge required.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackLogsSync, waitFor, writeEvidence } from '../../lib/harness';
import { dbNow, psql, sqlStr } from './242-helpers';
import { disableSchedules, FAKE_PROXY, printenv, waitStartupSettled } from './284-helpers';
import { absItemFor, backfillAfter, clearEarlierRun, importGenerated, madeUpBook, requestStatus, runJob, setAudibleTags, setTagging, waitSettled } from './232-tag-helpers';
import { absApiKey, absUser, browse, itemState, putExplicit, readStatus, registerSession, setAbsKey, userPermissions } from './542-helpers';
import { expectSettingLeg, setExplicitMark, settingLeg } from './542-setting-leg';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '542-explicit';
const AUDIBLE_TAG = 'E2E Audible Tag 542';
const RUN = Date.now().toString(36).slice(-5);
const madeUpAsin = (end: string) => `B0X${RUN.toUpperCase()}${end}`;
const ADMIN_STORAGE = () => evidencePath('storage-state.json');
const marked = (id: string) => psql(`select "explicit"::text from requests where id = ${sqlStr(id)}`);
const logCount = (re: RegExp) => (stackLogsSync('rmab').match(re) || []).length;
const GUARD_MSG = "Saved. Audiobookshelf wasn't updated: its API user can't see explicit content.";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const disabledJobs: string[] = [];
const absUserIds: string[] = [];
const KEY_ROW = "select value from configuration where key = 'audiobookshelf.api_token'";
let originalKeyRow = '';
let keySwitched = false;
let phmAsin = '';

/** Back to the key bootstrap configured: its stored (encrypted) value, then past the config cache's minute. */
async function restoreOriginalKey() {
  if (!keySwitched || !originalKeyRow) return;
  psql(`update configuration set value = ${sqlStr(originalKeyRow)} where key = 'audiobookshelf.api_token'`);
  keySwitched = false;
  await new Promise((r) => setTimeout(r, 61_000));
}

/** The ABS API keys this spec made (by name). */
const leftKeys = async (abs: Abs) =>
  ((await abs.req<{ apiKeys?: { id: string; name: string }[] }>('GET', '/api/api-keys').catch(() => ({ apiKeys: [] }))).apiKeys ?? [])
    .filter((k) => k.name.startsWith('rmab-e2e-542-'));

test.afterAll(async () => {
  const admin = await Rmab.loginAdmin();
  await restoreOriginalKey().catch(() => undefined);
  const abs = await Abs.login();
  for (const id of absUserIds.splice(0)) await abs.req('DELETE', `/api/users/${id}`).catch(() => undefined);
  for (const k of await leftKeys(abs)) await abs.req('DELETE', `/api/api-keys/${k.id}`).catch(() => undefined);
  writeEvidence(`${DIR}/cleanup.json`, { keyRowRestored: !!originalKeyRow && psql(KEY_ROW) === originalKeyRow, absKeysLeft: (await leftKeys(abs)).length });
  for (const id of disabledJobs.splice(0)) await admin.raw('PUT', `/api/admin/jobs/${id}`, { enabled: true });
  await setTagging(admin, false).catch(() => undefined);
  await setExplicitMark(admin, false).catch(() => undefined);
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
  const D = madeUpBook(madeUpAsin('D4'), `Otherwords${RUN}`);

  const admin = await Rmab.loginAdmin();
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  await disableSchedules(admin, disabledJobs);
  await waitStartupSettled();
  const cleared = await clearEarlierRun(abs, [A.asin]);
  await setTagging(admin, false);
  originalKeyRow = psql(KEY_ROW);
  expect(originalKeyRow, 'the configured ABS key is stored').toBeTruthy();
  expect((await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false })).status).toBe(200);
  const eve = await registerSession(admin, `eve${RUN}`);
  writeEvidence(`${DIR}/step0-run.json`, { run: RUN, A: A.asin, B: B.asin, C: C.asin, eve: eve.name, clearedFromEarlierRun: cleared });

  // Replayed in the browser (page.route): with the fake-metadata proxy RMAB can't reach the catalog
  const shown = { asin: A.asin, title: A.title, author: A.author, narrator: A.narrator, durationMinutes: A.runtimeMin ?? undefined, language: 'english' };
  const openDetailsOfA = async (page: import('@playwright/test').Page) => {
    await page.route((url) => url.pathname === '/api/audiobooks/search', (route) =>
      route.fulfill({ json: { success: true, results: [shown], totalResults: 1, page: 1, hasMore: false } }));
    await page.route((url) => url.pathname === `/api/audiobooks/${A.asin}`, (route) =>
      route.fulfill({ json: { success: true, audiobook: shown, audibleBaseUrl: 'https://www.audible.com' } }));
    await page.goto('/search');
    await page.getByPlaceholder('Search by title, author, or narrator...').fill(A.title);
    const card = page.getByRole('button', { name: `View details for ${A.title} by ${A.author}` }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    // The title, not the card's centre: the centre can be the card's own Request button
    await card.getByRole('heading', { name: A.title }).click();
  };

  // 0. The setting: off on the fresh stack (nothing anywhere, PUT refused), then on through Settings
  const Z = madeUpBook(madeUpAsin('Z6'), `Zerowords${RUN}`);
  const s0 = await settingLeg({ browser, admin, adminStorage: ADMIN_STORAGE(), eve, book: Z, dir: DIR, openDetails: openDetailsOfA });
  writeEvidence(`${DIR}/step0-setting.json`, s0);

  // 1. The details modal: the Explicit row at 375 dark; at 1280 light the tick asks first, then Request
  const ui: Record<string, unknown> = {};
  const openA = async (page: import('@playwright/test').Page) => {
    await openDetailsOfA(page);
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
    await page.getByRole('checkbox', { name: /^Explicit/ }).click();
    await expect(page.getByRole('heading', { name: 'Mark as explicit?' })).toBeVisible();
    await shot(DIR, 'modal-confirm-375-dark');
    ui.confirmOverflow375 = await overflowX();
    await page.getByRole('button', { name: 'Cancel' }).click();
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
    ui.untickableBeforeRequest = await box.isEnabled();
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
  // A is a fixture book: the stack's scenario may download it for real (organized → downloaded);
  // when the search finds nothing it gets generated audio like B
  const aSettled = await waitFor('A settled', async () => {
    const s = requestStatus(aReq);
    return ['downloaded', 'awaiting_search', 'failed'].includes(s) ? s : null;
  }, { timeoutMs: 420_000, intervalMs: 3_000 });
  const settled = { a: aSettled, b: await waitSettled(bReq) };
  const aPath = aSettled === 'downloaded'
    ? psql(`select a.file_path from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(aReq)}`)
    : await importGenerated(admin, aReq, 'a542');
  const itemA = (await absItemFor(abs, aPath)).id;
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
  absUserIds.push(kid.id);
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
    const item = page.getByRole('menuitem', { name: 'Remove explicit mark' });
    await expect(item).toBeVisible();
    await shot(DIR, 'admin-menu-1280-light');
    await item.click();
    const toast = page.getByText('Mark removed. If the book is marked explicit in Audiobookshelf, change it there.');
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await shot(DIR, 'admin-clear-toast-1280-light');
    await ctx.close();
  }
  {
    const { ctx, page, shot } = await browse(browser, ADMIN_STORAGE(), 1280, 900, true);
    await page.goto('/admin');
    const rowA = page.locator('tr', { has: page.getByText(A.title) });
    await expect(rowA).toBeVisible({ timeout: 30_000 });
    await rowA.scrollIntoViewIfNeeded();
    s5.pillsDark = await page.locator('tr span', { hasText: /^Explicit$/ }).count();
    await shot(DIR, 'admin-pill-1280-dark');
    await ctx.close();
  }
  s5.bMarked = marked(bReq);
  s5.bAbs = (await itemState(abs, itemB)).explicit;
  writeEvidence(`${DIR}/step5-admin.json`, s5);

  // 5b. Another marked request of the same book: eve's card beside Cancel, then the clear counts the other
  const dShown = { asin: D.asin, title: D.title, author: D.author, narrator: D.narrator };
  const dPost = await eve.rmab.raw('POST', '/api/requests', { audiobook: dShown, explicit: true });
  const dReq = ((await dPost.json()).request?.id) as string;
  const s5b: Record<string, unknown> = { dPostStatus: dPost.status, dSettled: await waitSettled(dReq) };
  {
    const { ctx, page, shot, overflowX } = await browse(browser, eve.storage, 375, 812, true);
    await page.goto('/requests');
    await expect(page.getByText(D.title).first()).toBeVisible({ timeout: 30_000 });
    // The smallest block holding D's title and a Cancel button: D's card
    const card = page.locator('div', { hasText: D.title, has: page.getByRole('button', { name: /^Cancel/ }) }).last();
    await card.getByRole('button', { name: /^Cancel/ }).scrollIntoViewIfNeeded();
    s5b.cardBoxLocked = await card.getByRole('checkbox', { name: /^Explicit/, disabled: true }).count();
    await shot(DIR, 'pending-card-375-dark');
    s5b.overflow375 = await overflowX();
    await ctx.close();
  }
  psql(`update requests set status = 'failed' where id = ${sqlStr(dReq)}`);
  const adminD = await admin.raw('POST', '/api/requests', { audiobook: dShown, explicit: true });
  s5b.adminDStatus = adminD.status;
  {
    const { ctx, page, shot } = await browse(browser, ADMIN_STORAGE(), 1280, 900, false);
    await page.goto('/admin');
    const rowD = page.locator('tr', { has: page.getByText(D.title) }).filter({ hasText: eve.name });
    await expect(rowD).toBeVisible({ timeout: 30_000 });
    await rowD.getByTitle('Actions').click();
    await page.getByRole('menuitem', { name: 'Remove explicit mark' }).click();
    const others = page.getByText('1 other request for this book is still marked; remove that mark too, or ReadMeABook marks the book explicit again once delivered.');
    await expect(others).toBeVisible({ timeout: 15_000 });
    s5b.othersToast = true;
    await shot(DIR, 'admin-clear-others-1280-light');
    await ctx.close();
  }
  s5b.dMarked = marked(dReq);
  writeEvidence(`${DIR}/step5b-others.json`, s5b);

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
  absUserIds.push(limited.id);
  const limitedKey = await absApiKey(abs, limited.id, `rmab-e2e-542-limited-${RUN}`);
  const keyClient = new Abs(limitedKey);
  keySwitched = true;
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
    await page.getByRole('menuitem', { name: 'Remove explicit mark' }).click();
    // C is available, so the clear answers with the "change it in Audiobookshelf" message
    await expect(page.getByText(/^Mark removed\. If the book is marked explicit in Audiobookshelf/)).toBeVisible({ timeout: 15_000 });
    await rowC.getByTitle('Actions').click();
    const putP = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/requests/${cReq}/explicit`);
    await page.getByRole('menuitem', { name: 'Mark explicit' }).click();
    s8.adminRemark = await (await putP).json();
    await expect(page.getByText(GUARD_MSG)).toBeVisible({ timeout: 15_000 });
    await shot(DIR, 'failure-toast-1280-light');
    await ctx.close();
  }
  s8.repeatPut = await putExplicit(eve.rmab, cReq, true);
  s8.adminRepeatPut = await putExplicit(admin, cReq, true);
  s8.requesterMarkB = await putExplicit(eve.rmab, bReq, true);
  await abs.req('PATCH', `/api/users/${limited.id}`, { permissions: userPermissions(true, true) });
  s8.keyMe = await keyClient.req<{ permissions: Record<string, unknown> }>('GET', '/api/me').then((m) => m.permissions?.accessExplicitContent).catch(() => 'error');
  s8.jobAfterAccess = await runJob(admin, 'plex_recently_added_check');
  s8.absCAfterAccess = (await itemState(abs, itemC)).explicit;
  writeEvidence(`${DIR}/step8-guard.json`, s8);
  await restoreOriginalKey();

  // Checks
  expectSettingLeg(s0);
  const before = s2Before.a;
  expect.soft(ui.checkedAtOpen, 'step 1: the box starts unticked').toBe(false);
  expect.soft(ui.checkedWhileAsking, 'step 1: not ticked until confirmed').toBe(false);
  expect.soft(ui.untickableBeforeRequest, 'step 1: nothing saved yet, so the tick can be undone before Request').toBe(true);
  expect.soft(String(ui.confirmText), 'step 1: the confirm sentence').toContain('only an admin can remove the mark');
  expect.soft([ui.postExplicit, ui.postStatus], 'step 1: Request sent explicit').toEqual([true, 201]);
  expect.soft([ui.modalOverflow375, ui.confirmOverflow375], '375: no horizontal overflow (modal, confirm)').toEqual([0, 0]);
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
  expect.soft(Number(s5.pillsDark), 'step 5: pills in dark').toBeGreaterThanOrEqual(1);
  expect.soft([s5b.dPostStatus, s5b.cardBoxLocked, s5b.overflow375], 'step 5b: D marked; its locked box beside Cancel at 375').toEqual([201, 1, 0]);
  expect.soft([s5b.adminDStatus, s5b.othersToast, s5b.dMarked], "step 5b: the clear counts the admin's marked request").toEqual([201, true, 'false']);
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
  expect.soft(s8.repeatPut, "step 8: eve's repeat mark is a plain 200, no Audiobookshelf call").toEqual({ status: 200, body: { success: true, request: { id: cReq, explicit: true } } });
  expect.soft((s8.adminRepeatPut as { body: Record<string, unknown> }).body, "step 8: an admin's repeat mark retries and says why").toMatchObject({ absUpdated: false, message: GUARD_MSG });
  expect.soft((s8.requesterMarkB as { body: Record<string, unknown> }).body, "step 8: a requester's failed write gets the short line").toMatchObject({ absUpdated: false, message: "Saved. Audiobookshelf wasn't updated; an admin needs to check it." });
  expect.soft(s8.keyMe, 'step 8: access turned on').toBe(true);
  expect.soft(s8.absCAfterAccess, 'step 8: one recently-added check flags C').toBe(true);
});
