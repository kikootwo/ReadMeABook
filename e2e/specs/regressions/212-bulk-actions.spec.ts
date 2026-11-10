/**
 * Component: E2E regression #212 (select several requests in the admin table and act on them together)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * Run with --offline-fixtures --overrides abs-fake-metadata: every title on screen is made up.
 * A local reader gets a flood of 300 seeded requests (made-up books; awaiting approval, failed and
 * waiting for a search, interleaved). Slow releases: the admin's book X and the reader's book Y download.
 *   approve  5 picked on the waiting-for-approval list: confirm says it starts 5 searches; 5 leave
 *            awaiting_approval, 5 search_indexers and 5 request_approved notifications queued.
 *   deny     the header checkbox (100), paced by the browser; Stop mid-run: exactly the finished ones
 *            are denied, the rest stay selected; finishing them denies 100 in all, no notification.
 *   cancel   a mixed page (approve, deny, cancel and delete counts differ; shot at 1280 light and
 *            375 dark): X and Y stop downloading (torrents/delete with deleteFiles), the flood rows the
 *            cancel applies to are cancelled, the rest skipped.
 *   delete   new fast releases deliver the reader's B, the admin's A and C (in the library: folder,
 *            ABS item, torrent). A seeded cancelled request of the reader on A's book row (S) shares it;
 *            another (R) sits on a second book row of A's book with no folder or item.
 *            The reader's page selected: B and S are skipped, one flood DELETE fails in the browser
 *            ("no answer from RMAB"), the rest (R included) are deleted; A's library index rows stay.
 *            B, A and C keep their files, ABS items and torrents; a direct DELETE ?keepLibrary=1 on B
 *            answers 409 and changes nothing.
 * Fails before the change: the table has no checkboxes and no bar (the first locator times out).
 */

import crypto from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, snap } from '../../lib/harness';
import { CaseRun, psql, sqlStr } from './242-helpers';
import { loadScenario, qbitDeletes, lastSeq, waitAvailable } from './423-helpers';
import { cancelScenario, configureIndexers, registerReader, cancelRow, waitDownloading, torrentOf } from './506-helpers';
import { session } from './284-helpers';
import {
  seedFlood, floodCounts, floodRequestId, jobsFor, requestRow, libraryState, listPage, bar, openTable, statusLine, libraryIndexRows,
} from './212-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(Boolean(process.env.E2E_PHASE?.startsWith('upgrade')), 'stack runs only');

const DIR = '212';
const CANCELLABLE = ['pending', 'searching', 'downloading', 'awaiting_search', 'awaiting_approval', 'awaiting_release'];
const COMES_BACK = 'A watched author or series, or a synced shelf, requests them again unless you remove it first or cancel instead.';

const dialog = (page: Page) => page.getByRole('dialog');
const floodNumber = (label: string) => Number(/Made Up Flood Book (\d{3})/.exec(label)?.[1] ?? NaN);
const t0 = Date.now();
const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`;

test('212 bulk approve, deny, cancel and delete from the admin table', async ({ browser }) => {
  test.setTimeout(45 * 60_000);
  const c = new CaseRun('bulk-actions', DIR);
  const timings: Record<string, string> = {};

  // Setup: slow downloads for X (admin) and Y (reader), then the reader's flood
  const slow = cancelScenario('bulk-212-slow', [
    { id: 'x', book: 'artemis', completeMs: 900_000 },
    { id: 'y', book: 'phm', completeMs: 900_000 },
  ]);
  await loadScenario(slow);
  c.save('scenario-slow.json', slow);
  const books = await fakeArr.books();
  const admin = await Rmab.loginAdmin();
  await configureIndexers(admin, 1);
  const reader = await registerReader(admin, 'e2e-212-reader');
  const adminId = psql(`select id from users where role = 'admin' order by created_at limit 1`);
  const ids: Record<string, string> = {
    X: (await admin.requestBook(books.artemis)).request.id,
    Y: (await reader.session.requestBook(books.phm)).request.id,
  };
  await waitDownloading(ids.X);
  await waitDownloading(ids.Y);
  seedFlood(reader.userId);
  c.save('flood-seeded.json', floodCounts());
  c.check(`flood seeded: 120 waiting for approval, 60 failed, 120 waiting for a search (${JSON.stringify(floodCounts())})`,
    floodCounts().awaiting_approval === 120 && floodCounts().failed === 60, 'control');
  timings.setup = elapsed();

  const { ctx, page, settled } = await session(browser, 1280, 800, false);

  // approve: 5 picked by hand, oldest first
  {
    await openTable(page, 'status=awaiting_approval&pageSize=100&sortBy=createdAt&sortOrder=asc');
    const boxes = page.getByRole('checkbox', { name: /^Select Made Up Flood Book/ });
    const picked: string[] = [];
    for (let i = 0; i < 5; i++) {
      await boxes.nth(i).check();
      picked.push(floodRequestId(floodNumber((await boxes.nth(i).getAttribute('aria-label')) ?? '')));
    }
    await expect(statusLine(page)).toHaveText('5 selected');
    await bar(page).getByRole('button', { name: 'Approve 5', exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Approve 5 requests?' })).toBeVisible();
    await settled(DIR, 'approve-confirm-1280-light');
    const text = await dialog(page).innerText();
    c.save('approve-confirm.txt', `${text}\n`);
    c.check('approve confirm: title, count and the start line',
      text.includes('RMAB starts on each one now: a search, or the release its user picked. Unreleased ones wait for release day.'), 'control');
    await dialog(page).getByRole('button', { name: 'Approve 5', exact: true }).click();
    await expect(statusLine(page)).toHaveText(/^Approved 5\.$/, { timeout: 120_000 });
    const statuses = picked.map((id) => requestRow(id).split('|')[0]);
    c.check(`approve: the 5 picked left awaiting_approval (${statuses.join(', ')})`, statuses.every((s) => s !== 'awaiting_approval'), 'safety');
    const jobs = jobsFor(picked);
    c.save('approve-jobs.json', jobs);
    c.check(`approve: one search and one request_approved notification per request (${JSON.stringify(jobs)})`,
      jobs.search_indexers === 5 && jobs['send_notification:request_approved'] === 5, 'safety');
    c.check(`approve: nothing else approved (${floodCounts().awaiting_approval} still waiting)`, floodCounts().awaiting_approval === 115, 'safety');
    timings.approve = elapsed();
  }

  // deny: the header checkbox, Stop mid-run, then finish the rest
  {
    await openTable(page, 'status=awaiting_approval&pageSize=100&sortBy=createdAt&sortOrder=asc');
    const listed = (await listPage(admin, 'status=awaiting_approval&pageSize=100&sortBy=createdAt&sortOrder=asc')).requests.map((r) => r.requestId);
    await page.getByRole('checkbox', { name: 'Select all requests on this page' }).check();
    await expect(statusLine(page)).toHaveText('100 selected');
    // Pacing only: each approve/deny call waits 400 ms in the browser so Stop lands mid-run
    await page.route('**/api/admin/requests/*/approve', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await bar(page).getByRole('button', { name: 'Deny 100', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Deny 100', exact: true }).click();
    await expect(statusLine(page)).toHaveText(/^Denying ([4-9]|\d\d) of 100\.\.\.$/, { timeout: 60_000 });
    await expect(bar(page).getByRole('button', { name: 'Stop' })).toBeVisible();
    await snap(page, DIR, 'deny-run-stop-1280-light');
    await bar(page).getByRole('button', { name: 'Stop' }).click();
    await expect(statusLine(page)).toHaveText(/^Stopped: denied \d+, /, { timeout: 60_000 });
    const stoppedText = await statusLine(page).innerText();
    c.save('deny-stopped.txt', `${stoppedText}\n`);
    const k = Number(/^Stopped: denied (\d+),/.exec(stoppedText)?.[1]);
    const deniedAfterStop = listed.filter((id) => requestRow(id).startsWith('denied|')).length;
    c.check(`deny: Stop took effect after the current request (${k} finished, ${deniedAfterStop} denied)`, k > 0 && k < 100 && deniedAfterStop === k, 'safety');
    c.check(`deny: the stopped result says how many did not start (${stoppedText})`, stoppedText === `Stopped: denied ${k}, ${100 - k} not started (still selected).`, 'control');
    // In order: the first k of the list are the denied ones
    c.check('deny: one at a time, in list order', listed.slice(0, k).every((id) => requestRow(id).startsWith('denied|')), 'control');
    await page.unroute('**/api/admin/requests/*/approve');
    await bar(page).getByRole('button', { name: `Deny ${100 - k}`, exact: true }).click();
    await dialog(page).getByRole('button', { name: `Deny ${100 - k}`, exact: true }).click();
    await expect(statusLine(page)).toHaveText(`Denied ${100 - k}.`, { timeout: 120_000 });
    const denied = listed.filter((id) => requestRow(id).startsWith('denied|')).length;
    c.check(`deny: all 100 denied in the end (${denied}; ${JSON.stringify(floodCounts())})`, denied === 100 && floodCounts().denied === 100 && floodCounts().awaiting_approval === 15, 'safety');
    const jobs = jobsFor(listed);
    c.save('deny-jobs.json', jobs);
    c.check(`deny: no search and no notification queued (${JSON.stringify(jobs)})`, Object.keys(jobs).length === 0, 'safety');
    timings.deny = elapsed();
  }

  // cancel: a mixed page (all statuses, newest first), shot at 1280 light and 375 dark
  {
    const query = 'pageSize=100';
    const rows = (await listPage(admin, query)).requests;
    const expected = {
      approve: rows.filter((r) => r.status === 'awaiting_approval').length,
      cancel: rows.filter((r) => CANCELLABLE.includes(r.status)).length,
      delete: rows.filter((r) => !r.inLibrary).length,
    };
    c.save('mixed-page-statuses.json', rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}));
    const dark = await session(browser, 375, 812, true);
    for (const view of [{ p: page, s: settled, name: 'bar-mixed-1280-light' }, { p: dark.page, s: dark.settled, name: 'bar-mixed-375-dark' }]) {
      await openTable(view.p, query);
      const header = view.p.getByRole('checkbox', { name: 'Select all requests on this page' });
      await header.check();
      await expect(statusLine(view.p)).toHaveText('100 selected');
      const labels = await bar(view.p).getByRole('button').allInnerTexts();
      c.save(`${view.name}-buttons.json`, labels);
      c.check(`${view.name}: each button counts what it applies to (${labels.join(', ')}; expected ${JSON.stringify(expected)})`,
        labels.includes(`Approve ${expected.approve}`) && labels.includes(`Deny ${expected.approve}`) && labels.includes(`Cancel ${expected.cancel}`) && labels.includes(`Delete ${expected.delete}`), 'control');
      // The spacer under the page is at least as tall as the fixed bar (measured after it settles)
      const heights = async () => bar(view.p).evaluate((el) => ({ spacer: (el.previousElementSibling as HTMLElement).offsetHeight, bar: (el as HTMLElement).offsetHeight }));
      await expect.poll(async () => { const h = await heights(); return h.spacer >= h.bar; }, { timeout: 10_000 }).toBe(true);
      const measured = await heights();
      c.save(`${view.name}-spacer.json`, measured);
      c.check(`${view.name}: spacer ${measured.spacer}px, bar ${measured.bar}px`, measured.spacer >= measured.bar, 'control');
      await view.p.getByRole('checkbox', { name: /^Select Made Up Flood Book/ }).nth(3).scrollIntoViewIfNeeded();
      await view.s(DIR, view.name);
    }
    await dark.ctx.close();

    const tX = await torrentOf('x');
    const tY = await torrentOf('y');
    c.check(`X and Y downloading before the cancel (${tX?.progress}, ${tY?.progress})`, !!tX && !!tY && tX.progress < 1 && tY.progress < 1, 'control');
    const seq = await lastSeq();
    await bar(page).getByRole('button', { name: `Cancel ${expected.cancel}`, exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: `Cancel ${expected.cancel} requests?` })).toBeVisible();
    await settled(DIR, 'cancel-confirm-1280-light');
    const text = await dialog(page).innerText();
    c.save('cancel-confirm.txt', `${text}\n`);
    c.check('cancel confirm: the list line, the withdrawn, the skipped count and the buttons',
      text.includes('They stay in the list as Cancelled. Nothing in your library is touched.') && text.includes(`${expected.approve} waiting for approval are withdrawn.`)
        && text.includes(`${100 - expected.cancel} others can't be cancelled and are skipped.`) && await dialog(page).getByRole('button', { name: 'Keep them' }).isVisible(), 'control');
    await dialog(page).getByRole('button', { name: `Cancel ${expected.cancel}`, exact: true }).click();
    await expect(statusLine(page)).toHaveText(/^Cancelled \d+\./, { timeout: 180_000 });
    const result = await statusLine(page).innerText();
    c.save('cancel-result.txt', `${result}\n`);
    const targets = rows.filter((r) => CANCELLABLE.includes(r.status)).map((r) => r.requestId);
    const notCancelled = targets.filter((id) => !requestRow(id).startsWith('cancelled|'));
    c.check(`cancel: every request it applied to is cancelled (${notCancelled.length} not)`, notCancelled.length === 0, 'safety', notCancelled.join(','));
    const others = rows.filter((r) => !CANCELLABLE.includes(r.status)).filter((r) => requestRow(r.requestId).split('|')[0] !== r.status);
    c.check(`cancel: the skipped ones are unchanged (${others.length} changed)`, others.length === 0, 'safety');
    c.check(`cancel result: count and skipped (${result})`, result.startsWith(`Cancelled ${expected.cancel}. ${100 - expected.cancel} skipped.`), 'control');
    const deletes = await qbitDeletes(seq);
    c.save('cancel-qbit-deletes.json', deletes);
    for (const [name, t, id] of [['X', tX, ids.X], ['Y', tY, ids.Y]] as const) {
      const row = cancelRow(id);
      c.check(`cancel ${name}: torrents/delete with deleteFiles, gone, row removed, cancelled_at set (${JSON.stringify(row)})`,
        !!t && deletes.some((d) => d.hashes.includes(t.hash) && d.deleteFiles) && !(await torrentOf(name.toLowerCase())) && row.status === 'cancelled' && row.downloadStatus === 'removed' && !!row.cancelledAt, 'safety');
    }
    c.save('cancel-jobs.json', jobsFor(targets));
    timings.cancel = elapsed();
  }

  // deliver: fast releases; A (admin), B (reader) and C (admin, replaces X) land in the library
  const fast = cancelScenario('bulk-212-fast', [
    { id: 'a', book: 'martian', completeMs: 5_000 },
    { id: 'b', book: 'phm', completeMs: 5_000 },
    { id: 'c', book: 'artemis', completeMs: 5_000 },
  ]);
  await loadScenario(fast);
  c.save('scenario-fast.json', fast);
  ids.A = (await admin.requestBook(books.martian)).request.id;
  ids.B = (await reader.session.requestBook(books.phm)).request.id;
  ids.C = (await admin.requestBook(books.artemis)).request.id;
  await waitAvailable(admin, [
    { requestId: ids.A, title: books.martian.title },
    { requestId: ids.B, title: books.phm.title },
    { requestId: ids.C, title: books.artemis.title },
  ]);
  // S: the reader's cancelled request on A's book row (two requests, one book row)
  ids.S = crypto.randomUUID();
  psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, cancelled_at, created_at, updated_at)
     select ${sqlStr(ids.S)}, ${sqlStr(reader.userId)}, audiobook_id, 'audiobook', 'cancelled', 0, now(), now(), now() from requests where id = ${sqlStr(ids.A)}`
  );
  // R: the reader's cancelled request on a second book row of A's book (same ASIN, title and author,
  // no folder or item): in the library by another route, so a bulk delete passes it
  const [asinA, titleA, authorA] = psql(
    `select coalesce(a.audible_asin, '-') || '|' || a.title || '|' || a.author from audiobooks a join requests r on r.audiobook_id = a.id where r.id = ${sqlStr(ids.A)}`
  ).split('|');
  const bookR = crypto.randomUUID();
  ids.R = crypto.randomUUID();
  psql(`insert into audiobooks (id, audible_asin, title, author, status, created_at, updated_at)
        values (${sqlStr(bookR)}, ${sqlStr(asinA)}, ${sqlStr(titleA)}, ${sqlStr(authorA)}, 'requested', now(), now())`);
  psql(`insert into requests (id, user_id, audiobook_id, type, status, progress, cancelled_at, created_at, updated_at)
        values (${sqlStr(ids.R)}, ${sqlStr(reader.userId)}, ${sqlStr(bookR)}, 'audiobook', 'cancelled', 0, now(), now(), now())`);
  c.save('ids.json', ids);
  const before ={ A: await libraryState(ids.A, 'a'), B: await libraryState(ids.B, 'b'), C: await libraryState(ids.C, 'c') };
  c.save('library-before.json', before);
  for (const [name, s] of Object.entries(before)) {
    c.check(`${name} in the library before (folder, files, ABS item, torrent: ${JSON.stringify({ ...s, shas: s.shas.split('\n').length })})`,
      s.folder !== '-' && !!s.shas && s.absItemExists && s.torrentInClient, 'control');
  }
  timings.deliver = elapsed();

  // delete: the reader's page (titles A-Z): B and S are in the library, one flood DELETE fails
  {
    const query = `userId=${reader.userId}&sortBy=title&sortOrder=asc&pageSize=100`;
    const rows = (await listPage(admin, query)).requests;
    const inLibrary = rows.filter((r) => r.inLibrary).map((r) => r.requestId);
    c.save('delete-page.json', rows.map((r) => ({ id: r.requestId, status: r.status, inLibrary: r.inLibrary })));
    c.check(`delete page: B and S flagged inLibrary, A and C not on it (${inLibrary.length} flagged)`,
      inLibrary.includes(ids.B) && inLibrary.includes(ids.S) && !rows.some((r) => [ids.A, ids.C].includes(r.requestId)), 'control');
    const toDelete = rows.filter((r) => !r.inLibrary).map((r) => r.requestId);
    const indexBefore = libraryIndexRows(asinA, titleA, authorA);
    c.check(`R is on the page and not flagged; A's book has library index rows (${indexBefore})`,
      toDelete.includes(ids.R) && toDelete[toDelete.length - 1] !== ids.R && asinA !== '-' && indexBefore > 0, 'control');
    const failing = toDelete[toDelete.length - 1];
    await page.route((url) => url.pathname === `/api/admin/requests/${failing}`, (route) =>
      route.request().method() === 'DELETE' ? route.abort('failed') : route.continue());
    await openTable(page, query);
    await page.getByRole('checkbox', { name: 'Select all requests on this page' }).check();
    await expect(statusLine(page)).toHaveText(`${rows.length} selected`);
    await bar(page).getByRole('button', { name: `Delete ${toDelete.length}`, exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: `Delete ${toDelete.length} requests?` })).toBeVisible();
    await settled(DIR, 'delete-confirm-1280-light');
    const text = await dialog(page).innerText();
    c.save('delete-confirm.txt', `${text}\n`);
    c.check('delete confirm: downloads, nothing in the library touched with the books skipped, the comes-back line',
      text.includes(`Their downloads go too, unless still seeding or shared. Nothing in your library is touched: ${inLibrary.length} books already in it are skipped.`)
        && text.includes(COMES_BACK), 'control');
    await dialog(page).getByRole('button', { name: `Delete ${toDelete.length}`, exact: true }).click();
    await expect(statusLine(page)).toHaveText(/^Deleted \d+\./, { timeout: 300_000 });
    await bar(page).locator('summary', { hasText: 'Details' }).click();
    await settled(DIR, 'delete-result-1280-light');
    const result = await statusLine(page).innerText();
    const details = await bar(page).locator('details li').allInnerTexts();
    c.save('delete-result.txt', `${result}\n${details.join('\n')}\n`);
    c.check(`delete result: deleted, skipped and failed counts (${result})`,
      result === `Deleted ${toDelete.length - 1}. ${inLibrary.length} in your library skipped. 1 failed.`, 'control');
    c.check(`delete result: the failed one says RMAB did not answer (${details[0]})`, /: no answer from RMAB$/.test(details[0] ?? ''), 'control');
    const indexAfter = libraryIndexRows(asinA, titleA, authorA);
    c.check(`delete: R deleted, A's library index rows untouched (${indexBefore} before, ${indexAfter} after)`,
      requestRow(ids.R).endsWith(`|${adminId}`) && indexAfter === indexBefore, 'safety');
    const deleted = toDelete.filter((id) => requestRow(id).endsWith(`|${adminId}`)).length;
    c.check(`delete: every other request deleted by the admin (${deleted} of ${toDelete.length - 1})`, deleted === toDelete.length - 1, 'safety');
    c.check(`delete: the failed one is still there (${requestRow(failing)})`, requestRow(failing).split('|')[1] === '', 'safety');
    for (const name of ['B', 'S', 'A', 'C']) {
      c.check(`${name} not deleted (${requestRow(ids[name])})`, requestRow(ids[name]).split('|')[1] === '', 'safety');
    }
    timings.delete = elapsed();
  }

  // The library after: same folders and files, ABS items, torrents; B refused directly too
  const direct = await admin.raw('DELETE', `/api/admin/requests/${ids.B}?keepLibrary=1`);
  c.save('direct-delete-b.json', { status: direct.status, body: await direct.json().catch(() => null) });
  c.check(`DELETE ?keepLibrary=1 on B: 409 (${direct.status})`, direct.status === 409, 'safety');
  const after = { A: await libraryState(ids.A, 'a'), B: await libraryState(ids.B, 'b'), C: await libraryState(ids.C, 'c') };
  c.save('library-after.json', after);
  for (const name of ['A', 'B', 'C'] as const) {
    const b = before[name];
    const a = after[name];
    c.check(`${name}: folder, files (sha256), ABS item, torrent and book status unchanged`,
      a.folder === b.folder && a.shas === b.shas && a.absItemExists && a.absItemId === b.absItemId && a.torrentInClient && a.bookStatus === b.bookStatus, 'safety', JSON.stringify({ before: b.bookStatus, after: a.bookStatus }));
    c.check(`${name}: request still available (${requestRow(ids[name])})`, requestRow(ids[name]).startsWith('available||'), 'safety');
  }
  c.save('flood-end.json', floodCounts());
  c.save('timings.json', timings);
  await ctx.close();

  const failed = c.finish({ timings });
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);

});
