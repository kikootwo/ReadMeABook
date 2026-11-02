/**
 * Component: E2E regression #228 (cancelling a request stops its download and removes what it fetched)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Inline scenario: slow releases (indexer 1 torrents seed 1 minute; indexer 2 usenet). A local reader
 * (non-admin, own API token) is registered over the API.
 *   card  the request card's confirm text on the admin's usenet request (1280 light, 375 dark), kept.
 *   a     phm torrent, admin, cancelled from the admin table dialog mid-download: torrents/delete with
 *         deleteFiles, torrent gone, row removed, cancelled_at set, toast says it was removed.
 *   b     martian torrent, the reader's: cancelled with the reader's API token (POST /api/requests/:id/cancel):
 *         200 and removed. The token on the admin's request: 403 (request untouched); unknown id: 404;
 *         DELETE /api/requests/:id: 405.
 *   c     artemis usenet, admin, cancelled over the API: SABnzbd queue delete with del_files=1, row removed.
 *   d     phm torrent (new release), the reader's, cancelled by the admin while fake qBittorrent fails
 *         torrents/delete once: 200 with the retry message, the torrent completes, the cleanup keeps it
 *         while it seeds (row completed, sha256 = fixture), then removes it once it has seeded 60 s.
 * Fails before the fix: the cancel never touches the client (no torrents/delete, no SAB delete), the token
 * route is 404, the cleanup never looks at cancelled requests.
 */

import { test, expect, type Browser } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, snap, Rmab } from '../../lib/harness';
import { CaseRun, exists, requestState } from './242-helpers';
import { loadScenario, folderShas, fixtureShas, runCleanup, qbitDeletes, lastSeq, waitSeeded } from './423-helpers';
import {
  cancelScenario, configureIndexers, registerReader, cancelRow, waitDownloading, waitComplete, torrentOf, nzbOf, sabQueueDeletes, armDeleteFault, cleanupCounts,
} from './506-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.skip(Boolean(process.env.E2E_PHASE?.startsWith('upgrade')), 'stack runs only (506-cancel-legacy covers the upgrade)');

const DIR = '506';
const CONFIRM_TEXT =
  "RMAB stops this request's download and removes what it downloaded so far, unless another request still uses it. A download that already finished may stay in the download client to seed.";

async function session(browser: Browser, opts: { width: number; height: number; dark: boolean }) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  const page = await ctx.newPage();
  const settle = () =>
    page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
  return { ctx, page, settle };
}

const UUID_UNKNOWN = '00000000-0000-4000-8000-000000000506';

test('506 a cancel stops the download, removes what it fetched, and the cleanup finishes a failed removal', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const c = new CaseRun('cancel-stops', DIR);
  const def = cancelScenario('cancel-506', [
    { id: 'a', book: 'phm', completeMs: 300_000 },
    { id: 'b', book: 'martian', completeMs: 300_000 },
    { id: 'c', book: 'artemis', completeMs: 300_000, usenet: true },
  ]);
  await loadScenario(def);
  c.save('scenario-definition.json', def);
  const books = await fakeArr.books();
  const admin = await Rmab.loginAdmin();
  c.save('indexer-config.json', await configureIndexers(admin, 1));
  const reader = await registerReader(admin, 'e2e-506-reader');
  c.check(`the reader's token has the user role (${reader.tokenRole})`, reader.tokenRole === 'user', 'control');

  const ids = {
    a: (await admin.requestBook(books.phm)).request.id,
    c: (await admin.requestBook(books.artemis)).request.id,
    b: (await reader.session.requestBook(books.martian)).request.id,
    d: '',
  };
  for (const id of [ids.a, ids.b, ids.c]) await waitDownloading(id);
  c.save('ids.json', ids);

  // card: the request card's confirm text (admin's own usenet request), kept both times
  for (const view of [{ width: 1280, height: 800, dark: false, name: 'card-confirm-1280-light' }, { width: 375, height: 812, dark: true, name: 'card-confirm-375-dark' }]) {
    const { ctx, page, settle } = await session(browser, view);
    await page.goto('/requests');
    const card = page.locator('div.rounded-lg.shadow-md', { hasText: books.artemis.title }).filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) }).first();
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    const heading = page.getByRole('heading', { name: 'Cancel request' });
    await expect(heading).toBeVisible();
    const dialog = page.locator('div.fixed.inset-0.z-50', { has: heading });
    await settle();
    await snap(page, DIR, view.name);
    c.check(`${view.name}: confirm text`, (await dialog.innerText()).includes(CONFIRM_TEXT), 'control');
    await dialog.getByRole('button', { name: 'Keep request' }).click();
    await expect(heading).toBeHidden();
    await ctx.close();
  }
  c.check(`card: "Keep request" left the request downloading (${cancelRow(ids.c).status})`, cancelRow(ids.c).status === 'downloading', 'safety');

  // a: admin table dialog, mid-download
  {
    const tA = await torrentOf('a');
    c.check(`a: partial before the cancel (progress ${tA?.progress})`, !!tA && tA.progress < 1, 'control');
    const before = await lastSeq();
    const { ctx, page, settle } = await session(browser, { width: 1280, height: 800, dark: false });
    await page.goto('/admin');
    // The Request Management table (the active-downloads table above it lists the title too, without actions)
    const row = page.locator('tr', { hasText: books.phm.title }).filter({ has: page.getByTitle('Actions') }).first();
    await row.getByTitle('Actions').click();
    await page.getByRole('menuitem', { name: 'Cancel Request' }).click();
    const heading = page.getByRole('heading', { name: 'Cancel request' });
    await expect(heading).toBeVisible();
    const dialog = page.locator('div.fixed.inset-0.z-50', { has: heading });
    await settle();
    await snap(page, DIR, 'admin-cancel-dialog-1280-light');
    c.check('a: admin dialog text', (await dialog.innerText()).includes(`Cancel "${books.phm.title}"? ${CONFIRM_TEXT}`), 'control');
    await dialog.getByRole('button', { name: 'Cancel request' }).click();
    const toast = page.getByText(/^Request cancelled\. Its download was removed from .+\.$/);
    await expect(toast).toBeVisible({ timeout: 30_000 });
    // The toast slides in (a CSS animation): shoot once it has landed
    await toast.locator('xpath=ancestor-or-self::div[contains(@class, "animate-slide-in-right")][1]').evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
    await snap(page, DIR, 'admin-cancel-toast-1280-light');
    c.save('a-toast.txt', `${await toast.innerText()}\n`);
    await ctx.close();
    const deletes = await qbitDeletes(before);
    c.save('a-qbit-deletes.json', deletes);
    c.check('a: torrents/delete with deleteFiles for its hash', !!tA && deletes.some((d) => d.hashes.includes(tA.hash) && d.deleteFiles), 'safety', JSON.stringify(deletes));
    c.check('a: torrent gone from the client', !(await torrentOf('a')), 'safety');
    const rowA = cancelRow(ids.a);
    c.check(`a: request cancelled, row removed, cancelled_at set (${JSON.stringify(rowA)})`, rowA.status === 'cancelled' && rowA.downloadStatus === 'removed' && !!rowA.cancelledAt, 'safety');
  }

  // b: the reader's API token
  {
    const tB = await torrentOf('b');
    c.check(`b: partial before the cancel (progress ${tB?.progress})`, !!tB && tB.progress < 1, 'control');
    const forbidden = await reader.apiToken.raw('POST', `/api/requests/${ids.c}/cancel`);
    c.save('b-token-other-request.json', { status: forbidden.status, body: await forbidden.json().catch(() => null) });
    c.check(`token on the admin's request: 403 (${forbidden.status})`, forbidden.status === 403, 'safety');
    c.check(`the admin's request untouched (${cancelRow(ids.c).status})`, cancelRow(ids.c).status === 'downloading' && !cancelRow(ids.c).cancelledAt, 'safety');
    const unknown = await reader.apiToken.raw('POST', `/api/requests/${UUID_UNKNOWN}/cancel`);
    c.check(`token on an unknown id: 404 (${unknown.status})`, unknown.status === 404, 'control');
    const del = await admin.raw('DELETE', `/api/requests/${ids.c}`);
    c.check(`DELETE /api/requests/:id: 405 (${del.status})`, del.status === 405, 'safety');
    c.check(`DELETE left the admin's request downloading (${cancelRow(ids.c).status})`, cancelRow(ids.c).status === 'downloading', 'safety');

    const before = await lastSeq();
    const res = await reader.apiToken.raw('POST', `/api/requests/${ids.b}/cancel`);
    const body = await res.json().catch(() => null);
    c.save('b-token-cancel.json', { status: res.status, body });
    c.check(`b: token cancel of its own request: 200 (${res.status})`, res.status === 200, 'safety');
    c.check(`b: download removed (${body?.download})`, body?.download === 'removed', 'safety');
    c.check(`b: owner message names no client (${body?.message})`, body?.message === 'Request cancelled. Its download was removed from the download client.', 'control');
    const deletes = await qbitDeletes(before);
    c.check('b: torrents/delete with deleteFiles for its hash', !!tB && deletes.some((d) => d.hashes.includes(tB.hash) && d.deleteFiles), 'safety', JSON.stringify(deletes));
    c.check('b: torrent gone from the client', !(await torrentOf('b')), 'safety');
    const rowB = cancelRow(ids.b);
    c.check(`b: row removed, cancelled_at set (${JSON.stringify(rowB)})`, rowB.downloadStatus === 'removed' && !!rowB.cancelledAt, 'safety');
  }

  // c: usenet over the API
  {
    const nzoId = cancelRow(ids.c).nzbId;
    const job = await nzbOf(nzoId);
    c.check(`c: queued in SABnzbd before the cancel (${job?.status})`, !!job && !job.storage, 'control');
    const before = await lastSeq();
    const res = await admin.raw('PATCH', `/api/requests/${ids.c}`, { action: 'cancel' });
    const body = await res.json().catch(() => null);
    c.save('c-cancel.json', { status: res.status, body });
    c.check(`c: cancel 200, download removed (${res.status}, ${body?.download})`, res.ok && body?.download === 'removed', 'safety');
    const deletes = await sabQueueDeletes(before);
    c.save('c-sab-deletes.json', deletes);
    c.check('c: SABnzbd queue delete with del_files=1 for its job', deletes.some((r) => String(r.query.value).split(',').includes(nzoId) && r.query.del_files === '1'), 'safety', JSON.stringify(deletes.map((r) => r.query)));
    c.check('c: job gone from SABnzbd', !(await nzbOf(nzoId)), 'safety');
    const rowC = cancelRow(ids.c);
    c.check(`c: row removed, cancelled_at set (${JSON.stringify(rowC)})`, rowC.downloadStatus === 'removed' && !!rowC.cancelledAt, 'safety');
  }

  // d: the delete fails at cancel time; the cleanup keeps it while seeding, then removes it
  {
    const defD = cancelScenario('cancel-506-d', [{ id: 'd', book: 'phm', completeMs: 120_000 }]);
    await loadScenario(defD);
    ids.d = (await reader.session.requestBook(books.phm)).request.id;
    await waitDownloading(ids.d);
    const tD = await torrentOf('d');
    c.check(`d: partial before the cancel (progress ${tD?.progress})`, !!tD && tD.progress < 1, 'control');
    c.save('d-fault.json', await armDeleteFault(1, 500));
    const before = await lastSeq();
    const res = await admin.raw('PATCH', `/api/requests/${ids.d}`, { action: 'cancel' });
    const body = await res.json().catch(() => null);
    c.save('d-cancel.json', { status: res.status, body });
    c.check(`d: cancel 200 with the retry message (${res.status}, ${body?.download})`, res.ok && body?.download === 'retry_later' && /RMAB tries again on its next seeding cleanup\.$/.test(body?.message || ''), 'safety');
    const faulted = (await fakeArr.requests(before)).filter((r) => r.service === 'qbit' && r.path.endsWith('/torrents/delete'));
    c.check('d: the cancel tried torrents/delete once and got the fault', faulted.length === 1 && (faulted[0] as any).fault === 500, 'control', JSON.stringify(faulted.map((r) => (r as any).fault)));
    c.check(`d: cancelled, row not removed (${JSON.stringify(cancelRow(ids.d))})`, cancelRow(ids.d).status === 'cancelled' && cancelRow(ids.d).downloadStatus !== 'removed', 'safety');

    const done = await waitComplete('d');
    c.check(`d: the torrent completed in the client (${done.state}, ${done.progress})`, done.progress === 1, 'control');
    const fixture = fixtureShas('phm');
    const beforeFirst = await lastSeq();
    const first = await runCleanup(admin);
    c.save('d-cleanup-1.tsv', `${first}\n`);
    c.check(`d: first cleanup (seeding under 60 s) kept it (${JSON.stringify(cleanupCounts(first)?.cancelled)})`, cleanupCounts(first)?.cancelled?.keptSeeding === 1, 'control');
    c.check('d: first cleanup made no torrents/delete', (await qbitDeletes(beforeFirst)).length === 0, 'safety');
    c.check(`d: row completed (${cancelRow(ids.d).downloadStatus})`, cancelRow(ids.d).downloadStatus === 'completed', 'safety');
    c.check('d: files intact (sha256 = fixture)', !!fixture && folderShas(done.content_path) === fixture, 'safety');

    await waitSeeded(tD?.hash || '', 65);
    const beforeSecond = await lastSeq();
    const second = await runCleanup(admin);
    c.save('d-cleanup-2.tsv', `${second}\n`);
    const deletes = await qbitDeletes(beforeSecond);
    c.save('d-qbit-deletes.json', deletes);
    c.check(`d: second cleanup removed it (${JSON.stringify(cleanupCounts(second)?.cancelled)})`, cleanupCounts(second)?.cancelled?.removed === 1, 'control');
    c.check('d: torrents/delete with deleteFiles for its hash only', !!tD && deletes.length === 1 && deletes[0].hashes.includes(tD.hash) && deletes[0].deleteFiles, 'safety', JSON.stringify(deletes));
    c.check('d: torrent gone from the client', !(await torrentOf('d')), 'safety');
    c.check('d: files gone', !exists(done.content_path) && folderShas(done.content_path) === '', 'safety');
    c.check(`d: row removed (${cancelRow(ids.d).downloadStatus})`, cancelRow(ids.d).downloadStatus === 'removed', 'safety');
  }

  // The partial downloads cancelled earlier never reappeared (their completeMs has long passed)
  const torrents = (await fakeArr.state()).torrents;
  c.check('a and b never came back to the client', !torrents.some((t: any) => ['a', 'b'].includes(t.releaseId)), 'safety');
  c.save('request-states.tsv', `${Object.values(ids).map(requestState).join('\n')}\n`);
  c.save('fake-state-end.json', await fakeArr.state());

  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});
