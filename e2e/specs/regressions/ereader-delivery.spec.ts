/**
 * Component: E2E e-reader delivery (new ebooks emailed to requesters' e-readers through Audiobookshelf)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with `--overrides mail-catcher`: Audiobookshelf (real, 2.37.1) sends through a Mailpit service
 * on the stack network, and every check reads what Mailpit received. Nothing leaves the stack.
 *   setup (UI): Settings > E-book, "Send ebooks to e-readers" ticked and saved; Admin > Users >
 *     the admin's Permissions, the three ABS devices listed (the restricted one with its warning),
 *     "E2E Kindle" ticked (saved on change). Screenshots in ereader/setup/.
 *   same-library: an ebook organized by the app's own job (default layout: the audiobook library)
 *     is emailed once to the Kindle, as an .epub attachment; never to devices nobody enrolled.
 *   no-resend: organizing the same ebook again sends nothing more.
 *   late-requester: a second user who asks for an ebook already in the library
 *     (POST /api/audiobooks/[asin]/fetch-ebook, answered 409) gets it on their own device only.
 *     Needs RMAB's real Audible lookup for the fixture book; skipped (with a note) when unreachable.
 *   separate-library (#561 layout): ebooks under /media/ebooks in their own ABS library.
 *     S1 ebook library set in RMAB; S2 not set (ABS scans that library on its own; the spec asks ABS
 *     to, as its watcher would). Both are delivered from the ebook library's item.
 * In the preview (`run.mjs preview ... --specs ereader-delivery`), it also leaves a failed ebook
 * request with an .epub waiting in /downloads/manual/ereader-try, to try a Manual Import by hand.
 * Settings are changed over the real routes or SQL; the app's config cache holds a value up to 60 s,
 * so each change waits that out. Paths are restored at the end.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, env, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, snap, urls, waitFor } from '../../lib/harness';
import { PUID, PGID, sh, asApp, q, psql, sqlStr, setConfig, newBook, importEbook, organizeEbookInto, adminUserId, eventsSince, fmtEvents, type Case } from './library-delete-helpers';
import { markJobs } from './242-helpers';
import { epubBytes } from './550-epub';
import { attachments, DEVICES, inbox, MAILPIT, mailpitReady, Rec, sentTo, setUpAbsEmail, waitForMail, type MailSummary } from './ereader-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });
test.use({ storageState: evidencePath('storage-state.json') });

const SRC = '/downloads/manual/e2e-ereader';
const EBOOK_ROOT = '/media/ebooks';
const AUTHOR = 'E2E Ereader Author';
const CACHE_WAIT_MS = 62_000;
const PATH_KEYS = ['media_dir', 'audiobook_path_template', 'ebook_path_template', 'audiobookshelf.ebook_library_id', 'audiobookshelf.trigger_scan_after_import'];
const asCase = (r: Rec) => r as unknown as Case;
const cacheWait = () => new Promise((res) => setTimeout(res, CACHE_WAIT_MS));

let rmab: Rmab;
let abs: Abs;
const saved: Record<string, string | null> = {};
/** The same-library case's ebook request and book, reused by no-resend */
let first: { reqId: string; bookId: string } | null = null;

/** A small valid EPUB, owned by the app user. */
function genEpub(dir: string, title: string) {
  asApp(`mkdir -p ${q(dir)}
echo ${epubBytes(title).toString('base64')} | base64 -d > ${q(`${dir}/${title}.epub`)}`);
}

const sentDevices = (reqId: string): string[] => JSON.parse(psql(`select coalesce(ereader_sent_devices, '[]'::jsonb)::text from requests where id = ${sqlStr(reqId)}`) || '[]');

/** Wait for a send_to_ereader job event containing `text`, after `mark`. */
async function waitForSendLog(mark: ReturnType<typeof markJobs>, text: string, timeoutMs = 240_000) {
  return waitFor(`send job log "${text}"`, async () => eventsSince(mark).find((e) => e.message.includes(text)) || null, { timeoutMs, intervalMs: 3_000 });
}

/** Check one delivered email: one .epub attachment. Saves the email and its attachments. */
async function checkEmail(r: Rec, label: string, mail: MailSummary) {
  const files = await attachments(mail.ID);
  r.save(`${label}-email.json`, { ...mail, attachments: files });
  r.check(`${label}: subject "${mail.Subject}"`, true, 'control');
  r.check(`${label}: exactly one attachment (${files.map((f) => f.FileName).join(', ')})`, files.length === 1);
  r.check(`${label}: the attachment is the .epub (${files[0]?.FileName}, ${files[0]?.Size} bytes)`, !!files[0]?.FileName.endsWith('.epub') && files[0].Size > 0);
}

/** Mailpit's own page for an email (inbox list + the message), for the PR. */
async function shootEmail(page: import('@playwright/test').Page, dir: string, mail: MailSummary) {
  await page.setViewportSize({ width: 1280, height: 1000 }); // tall enough for the attachment's file name
  await page.goto(`${MAILPIT}/view/${mail.ID}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1_500);
  await snap(page, dir, 'mailpit-email');
}

/** An ebook request for a new book, organized by the app's own job. */
async function newEbook(r: Rec, title: string, asin: string, bookId = newBook(title, AUTHOR, asin)) {
  genEpub(`${SRC}/${asin}`, title);
  const mark = markJobs();
  const reqId = await importEbook(asCase(r), bookId, `${SRC}/${asin}`, title);
  return { reqId, bookId, mark };
}

test.beforeAll(async () => {
  test.skip(!(await mailpitReady()), 'needs --overrides mail-catcher (Mailpit on the stack network)');
  rmab = await Rmab.loginAdmin();
  abs = await Abs.login();
  for (const key of PATH_KEYS) saved[key] = psql(`select value from configuration where key = ${sqlStr(key)}`) || null;
  sh(`mkdir -p ${q(SRC)} ${q(EBOOK_ROOT)}\nchown ${PUID}:${PGID} /downloads/manual ${q(SRC)} ${q(EBOOK_ROOT)}`);
  setConfig('audiobookshelf.trigger_scan_after_import', 'true');
});

test.afterAll(() => {
  if (!rmab) return;
  for (const key of PATH_KEYS) setConfig(key, saved[key]);
  // The preview stays up for hands-on testing: keep the post-import scan on so a Manual Import is picked up
  if (process.env.E2E_PHASE === 'preview') setConfig('audiobookshelf.trigger_scan_after_import', 'true');
});

test('setup: e-reader delivery on, devices chosen in the admin UI', async ({ page }) => {
  test.setTimeout(240_000);
  const r = new Rec('setup');
  const absSetup = await setUpAbsEmail(abs);
  r.save('abs-email.json', { ...absSetup, settings: { ...absSetup.settings, settings: { ...absSetup.settings?.settings, pass: undefined } } });
  const absDevices: { name: string; availabilityOption: string }[] = absSetup.devices?.ereaderDevices ?? [];
  r.check('ABS has the three e2e devices', absDevices.length === 3, 'control');
  r.check('ABS kept the locked device restricted to specific users', absDevices.find((d) => d.name === DEVICES.locked.name)?.availabilityOption === 'specificUsers', 'control');

  // Settings > E-book: an ebook source on (the tab shows the rest only then), tick "Send ebooks to e-readers", save
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/settings?tab=ebook');
  const source = page.getByRole('checkbox', { name: 'Enable Indexer Search' });
  await expect(source).toBeVisible({ timeout: 30_000 });
  if (!(await source.isChecked())) await source.check();
  const toggle = page.locator('#ereader-auto-send-enabled');
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await toggle.scrollIntoViewIfNeeded();
  if (!(await toggle.isChecked())) await toggle.check();
  await snap(page, r.dir, 'settings-ebook-toggle');
  const saveRes = page.waitForResponse((res) => res.url().includes('/api/admin/settings/ebook') && res.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save E-book Sidecar Settings' }).click();
  r.check(`E-book settings saved (HTTP ${(await saveRes).status()})`, (await saveRes).status() === 200, 'control');
  r.check('ebook_ereader_auto_send_enabled = true', psql(`select value from configuration where key = 'ebook_ereader_auto_send_enabled'`) === 'true');

  // Admin > Users > the admin's Permissions: the ABS devices, the restricted one flagged
  await page.goto('/admin/users');
  const row = page.getByRole('row').filter({ hasText: env('E2E_ADMIN_USER') });
  await row.getByRole('button', { name: /Full Access/ }).click();
  const kindle = page.locator('label', { hasText: DEVICES.kindle.name });
  await expect(kindle).toBeVisible({ timeout: 30_000 });
  const locked = page.locator('label', { hasText: DEVICES.locked.name });
  r.check('the restricted device says ABS won\'t let RMAB send to it', (await locked.textContent())?.includes("won't let RMAB send") ?? false);
  const devRes = page.waitForResponse((res) => /\/api\/admin\/users\/[^/]+$/.test(res.url()) && res.request().method() === 'PUT');
  await kindle.locator('input[type=checkbox]').check();
  r.check(`devices saved on change (HTTP ${(await devRes).status()})`, (await devRes).status() === 200, 'control');
  await locked.scrollIntoViewIfNeeded(); // the whole device list, the restricted device's warning included
  await page.waitForTimeout(500);
  await snap(page, r.dir, 'user-devices');
  const enrolled = psql(`select coalesce(ereader_device_names, '[]'::jsonb)::text from users where id = ${sqlStr(adminUserId())}`);
  r.check(`admin enrolled in the Kindle (${enrolled})`, JSON.stringify(JSON.parse(enrolled)) === JSON.stringify([DEVICES.kindle.name]));

  await cacheWait(); // the job runner reads the toggle through the 60 s config cache
  expect(r.finish()).toEqual([]);
});

test('same-library: a new ebook is emailed once to the requester\'s Kindle', async ({ page }) => {
  test.setTimeout(480_000);
  const r = new Rec('same-library');
  const before = await inbox();
  const { reqId, bookId, mark } = await newEbook(r, 'Ereader Book One', 'B0EREAD001');
  first = { reqId, bookId };
  const mails = await waitForMail(DEVICES.kindle.email, sentTo(before, DEVICES.kindle.email).length).catch(() => []);
  r.save('events.log', `${fmtEvents(eventsSince(mark))}\n`);
  r.check(`one email to the Kindle (${mails.length})`, mails.length === 1);
  if (mails[0]) {
    await checkEmail(r, 'kindle', mails[0]);
    await shootEmail(page, r.dir, mails[0]);
  }
  const after = await inbox();
  r.check('nothing sent to the devices nobody enrolled', sentTo(after, DEVICES.kobo.email).length === sentTo(before, DEVICES.kobo.email).length && sentTo(after, DEVICES.locked.email).length === 0);
  r.check(`the request records the Kindle as sent (${JSON.stringify(sentDevices(reqId))})`, JSON.stringify(sentDevices(reqId)) === JSON.stringify([DEVICES.kindle.name]));
  expect(r.finish()).toEqual([]);
});

test('no-resend: organizing the same ebook again sends nothing more', async () => {
  test.setTimeout(360_000);
  test.skip(!first, 'needs the same-library case');
  const r = new Rec('no-resend');
  const before = sentTo(await inbox(), DEVICES.kindle.email).length;
  const mark = markJobs();
  await organizeEbookInto(asCase(r), first!.reqId, first!.bookId, `${SRC}/B0EREAD001`, 'again');
  const line = await waitForSendLog(mark, 'No e-reader devices to send to').catch(() => null);
  await new Promise((res) => setTimeout(res, 15_000));
  r.save('events.log', `${fmtEvents(eventsSince(mark))}\n`);
  r.check(`the send job ran and found every device already sent (${line?.message ?? 'no log line'})`, !!line);
  const after = sentTo(await inbox(), DEVICES.kindle.email).length;
  r.check(`no new email to the Kindle (${before} → ${after})`, after === before);
  expect(r.finish()).toEqual([]);
});

test('late-requester: a second user asking for an ebook already in the library gets it on their device', async ({ page }) => {
  test.setTimeout(480_000);
  const r = new Rec('late-requester');
  const book = (await fakeArr.books()).phm;
  // The preview seed already has this book available; a plain run creates it with an available audiobook request
  let bookId = psql(`select id from audiobooks where audible_asin = ${sqlStr(book.asin)} order by created_at limit 1`);
  if (!bookId) bookId = newBook(book.title, book.author, book.asin);
  if (!psql(`select id from requests where audiobook_id = ${sqlStr(bookId)} and type = 'audiobook' and status in ('downloaded','available') and deleted_at is null limit 1`)) {
    psql(`insert into requests (id, user_id, audiobook_id, type, status, progress, created_at, updated_at)
          values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(bookId)}, 'audiobook', 'available', 100, now(), now())`);
  }
  // The admin's ebook arrives first (to the Kindle)
  const kindleBefore = sentTo(await inbox(), DEVICES.kindle.email).length;
  genEpub(`${SRC}/late`, book.title);
  const ebookReq = await importEbook(asCase(r), bookId, `${SRC}/late`, 'admin-ebook');
  const adminMail = await waitForMail(DEVICES.kindle.email, kindleBefore).catch(() => []);
  r.check(`the admin's Kindle got the ebook first (${adminMail.length})`, adminMail.length === 1, 'control');

  // A second user, enrolled in the Kobo and (already sent) the Kindle
  const user = { username: `reader-${Date.now().toString(36)}`, password: 'e2e-reader-pass-0001' };
  await rmab.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false });
  const reg = await fetch(`${urls.rmab()}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) });
  const regBody = await reg.json();
  r.check(`second user registered (HTTP ${reg.status})`, reg.status === 200, 'control', JSON.stringify(regBody).slice(0, 200));
  const set = await rmab.raw('PUT', `/api/admin/users/${regBody.user.id}`, { role: 'user', ereaderDeviceNames: [DEVICES.kobo.name, DEVICES.kindle.name] });
  r.check(`second user's devices saved (HTTP ${set.status})`, set.status === 200, 'control');
  setConfig('ebook_indexer_search_enabled', 'true'); // the route needs an ebook source on (read uncached)

  const koboBefore = sentTo(await inbox(), DEVICES.kobo.email).length;
  const kindleMid = sentTo(await inbox(), DEVICES.kindle.email).length;
  const mark = markJobs();
  const res = await new Rmab(regBody.accessToken).raw('POST', `/api/audiobooks/${book.asin}/fetch-ebook`, {});
  const body = await res.json().catch(() => ({}));
  r.save('fetch-ebook.json', { status: res.status, body });
  if (res.status === 404 && /Audible/i.test(String(body.error))) {
    r.save('result.json', { case: r.id, result: 'SKIPPED', reason: 'RMAB could not reach Audible for the fixture book', response: body });
    test.skip(true, 'RMAB could not reach Audible for the fixture book (network); the late-requester path is unit-tested');
  }
  r.check(`fetch-ebook answers 409 "already exists" (HTTP ${res.status})`, res.status === 409 && String(body.message).includes('already exists'));
  const kobo = await waitForMail(DEVICES.kobo.email, koboBefore).catch(() => []);
  await new Promise((res2) => setTimeout(res2, 10_000));
  r.save('events.log', `${fmtEvents(eventsSince(mark))}\n`);
  r.check(`one email to the second user's Kobo (${kobo.length})`, kobo.length === 1);
  if (kobo[0]) {
    await checkEmail(r, 'kobo', kobo[0]);
    await shootEmail(page, r.dir, kobo[0]);
  }
  const kindleAfter = sentTo(await inbox(), DEVICES.kindle.email).length;
  r.check(`the Kindle (already sent) got nothing more (${kindleMid} → ${kindleAfter})`, kindleAfter === kindleMid);
  r.check(`the request records both devices (${JSON.stringify(sentDevices(ebookReq))})`, JSON.stringify(sentDevices(ebookReq).sort()) === JSON.stringify([DEVICES.kindle.name, DEVICES.kobo.name].sort()));
  expect(r.finish()).toEqual([]);
});

test('separate-library: ebooks in their own Audiobookshelf library are delivered from that library', async ({ page }) => {
  test.setTimeout(900_000);
  const r = new Rec('separate-library');
  const audioLib = authState().absLibraryId;
  setConfig('media_dir', '/media');
  setConfig('audiobook_path_template', 'audiobooks/{author}/{title}');
  setConfig('ebook_path_template', 'ebooks/{author}/{title}');
  const libs = await abs.req<{ libraries: { id: string; folders: { fullPath: string }[] }[] }>('GET', '/api/libraries');
  const ebookLib = libs.libraries.find((l) => l.folders.some((f) => f.fullPath === EBOOK_ROOT))?.id
    || (await abs.req<{ id: string }>('POST', '/api/libraries', { name: 'Ebooks', folders: [{ fullPath: EBOOK_ROOT }], icon: 'books', mediaType: 'book', provider: 'audible' })).id;
  r.save('abs-libraries.json', { audioLib, ebookLib });

  // S1: RMAB knows the ebook library (it scans it after the import)
  setConfig('audiobookshelf.ebook_library_id', ebookLib);
  await cacheWait();
  let before = sentTo(await inbox(), DEVICES.kindle.email).length;
  const s1 = await newEbook(r, 'Ereader Ebook Alpha', 'B0EREAD0A1');
  const s1Mail = await waitForMail(DEVICES.kindle.email, before).catch(() => []);
  r.save('S1-events.log', `${fmtEvents(eventsSince(s1.mark))}\n`);
  const s1Item = (await abs.libraryItems(ebookLib)).find((i) => i.path === `${EBOOK_ROOT}/${AUTHOR}/Ereader Ebook Alpha`);
  r.check(`S1: the ebook library has the item (${s1Item?.id})`, !!s1Item, 'control');
  r.check(`S1: one email to the Kindle (${s1Mail.length})`, s1Mail.length === 1);
  if (s1Mail[0]) {
    await checkEmail(r, 'S1', s1Mail[0]);
    await shootEmail(page, `${r.dir}/S1`, s1Mail[0]);
  }
  const s1Sent = eventsSince(s1.mark).find((e) => e.message.includes('Sent "Ereader Ebook Alpha"'))?.message ?? '';
  r.check(`S1: sent from the ebook library's item (${s1Sent})`, !!s1Item && s1Sent.includes(`item ${s1Item.id})`));

  // S2: RMAB was never told (setting empty); ABS scans its ebook library on its own (the spec asks it, as its watcher would)
  setConfig('audiobookshelf.ebook_library_id', null);
  await cacheWait();
  before = sentTo(await inbox(), DEVICES.kindle.email).length;
  const s2 = await newEbook(r, 'Ereader Ebook Bravo', 'B0EREAD0B1');
  await abs.req('POST', `/api/libraries/${ebookLib}/scan`).catch(() => undefined);
  const s2Mail = await waitForMail(DEVICES.kindle.email, before).catch(() => []);
  r.save('S2-events.log', `${fmtEvents(eventsSince(s2.mark))}\n`);
  const s2Item = (await abs.libraryItems(ebookLib)).find((i) => i.path === `${EBOOK_ROOT}/${AUTHOR}/Ereader Ebook Bravo`);
  const s2Sent = eventsSince(s2.mark).find((e) => e.message.includes('Sent "Ereader Ebook Bravo"'))?.message ?? '';
  r.check(`S2: one email to the Kindle (${s2Mail.length})`, s2Mail.length === 1);
  r.check(`S2: sent from the ebook library's item (${s2Sent})`, !!s2Item && s2Sent.includes(`item ${s2Item.id})`));
  if (s2Mail[0]) await checkEmail(r, 'S2', s2Mail[0]);

  expect(r.finish()).toEqual([]);
});

test('preview only: leave an ebook waiting for a hands-on Manual Import', async () => {
  test.skip(process.env.E2E_PHASE !== 'preview', 'preview only');
  for (const key of PATH_KEYS) setConfig(key, saved[key]);
  setConfig('audiobookshelf.trigger_scan_after_import', 'true');
  // A real Audible ASIN (Dune): Manual Import lives in the details window, which loads the book from
  // Audible first and shows no actions for an unknown ASIN. The automated cases keep fake ASINs.
  const bookId = newBook('Try It Yourself', AUTHOR, 'B002V1OF70');
  psql(`insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, created_at, updated_at)
        values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(bookId)}, 'ebook', 'failed', 0, 'No ebook found (e2e: import it by hand)', now(), now())`);
  genEpub('/downloads/manual/ereader-try', 'Try It Yourself');
  const r = new Rec('preview-try');
  r.save('hands-on.json', { book: 'Try It Yourself', author: AUTHOR, epub: '/downloads/manual/ereader-try/Try It Yourself.epub', inbox: MAILPIT });
});
