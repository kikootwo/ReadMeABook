/**
 * Component: E2E regression #325a / #284 part B (a delivered request follows the library's current ASIN)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata (ABS gets fake Audible/Audnexus answers;
 * RMAB's own provider calls are refused; every title is made up). Schedules off, as in 284-library-link,
 * and back on at the end. Covers are generated images uploaded to ABS.
 * 1. Deliver martian X (B082BHJMFF), real ABS scan, real ABS rematch to artemis Y (B072R1CY4P) + cover A,
 *    ONE plex_library_scan: `available`, library_asin Y, the requested fields unchanged in SQL; the request
 *    list and detail show artemis with `audibleAsin` X, `libraryAsin` Y and cover A from the library cache;
 *    the admin list and /recent keep the requested title with artemis as `displayTitle`. Screenshots.
 *    The card's details modal asks for X. "Get ebook" (X), with an ebook source on, creates no audiobooks
 *    row (reported as not reached when RMAB cannot load X's details offline).
 * 2. Rematch to phm Z (B08G9PRS1K) + cover B, one scan: library_asin Z, the API title is phm, and the cover
 *    URL changed to a file holding B (the old URL is gone).
 * 3. Ownership: POST /api/requests X and Z → 409; request-with-torrent X → 409 AlreadyAvailable.
 * 4. Rematch back to X, one scan: library_asin null. Then a new request's POST response has no
 *    `libraryAsin` (the client omits the stored column).
 * After each scan: audiobook request count and search jobs unchanged. Values read first, then expect.soft,
 * so a run on main (no column) shows every value.
 */

import crypto from 'node:crypto';
import { test, expect, type Browser } from '@playwright/test';
import { Abs, authState, ctl, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, snap, stackExecSync, stackLogsSync, urls, waitFor, writeEvidence } from '../../lib/harness';
import { dbNow, markJobs, MEDIA, psql, sqlStr, waitOrganized } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const SCHEDULES = ['plex_recently_added_check', 'plex_library_scan', 'audible_refresh'];
const SCAN_TYPES = `('scan_plex','plex_library_scan')`;
const FAKE_PROXY = 'http://fake-arr:9898';
const DIR = '284b';
const EBOOK_KEY = 'ebook_indexer_search_enabled';

type FixtureBook = { asin: string; title: string; author: string; narrator: string };

/** Schedules this spec turned off; afterAll turns them back on for later specs in the stack. */
const disabledJobs: string[] = [];
test.afterAll(async () => {
  if (disabledJobs.length === 0) return;
  const rmab = await Rmab.loginAdmin();
  for (const id of disabledJobs.splice(0)) await rmab.raw('PUT', `/api/admin/jobs/${id}`, { enabled: true });
});

const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

const sha256 = (data: ArrayBuffer | Buffer) => crypto.createHash('sha256').update(Buffer.from(data as ArrayBuffer)).digest('hex');

/** psql trims, so multi-column reads join with '|' (an empty first column would shift a tab split). */
const bookRow = (requestId: string) => {
  const [status, absItemId, libraryAsin, audibleAsin, title, author, narrator, series, year, filePath] = psql(
    `select concat_ws('|', r.status, coalesce(a.abs_item_id,''), coalesce(a.library_asin,''), coalesce(a.audible_asin,''), a.title, a.author, coalesce(a.narrator,''), coalesce(a.series,''), coalesce(a.year::text,''), coalesce(a.file_path,'')) from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(requestId)}`
  ).split('|');
  return { status, absItemId, libraryAsin, audibleAsin, title, author, narrator, series, year, filePath };
};
const counts = () => ({
  audiobookRequests: Number(psql(`select count(*) from requests where type = 'audiobook' and deleted_at is null`)),
  audiobooks: Number(psql('select count(*) from audiobooks')),
  searchJobs: Number(psql(`select count(*) from jobs where type = 'search_indexers'`)),
});

async function session(browser: Browser, width: number, height: number, dark: boolean) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL, viewport: { width, height }, colorScheme: dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  const page = await ctx.newPage();
  /** Shots wait for finite CSS transitions/animations (the cards fade in) and images to finish. */
  const settled = async (dir: string, name: string) => {
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)
      && Array.from(document.images).every((i) => i.complete));
    await page.waitForTimeout(300);
    await snap(page, dir, name);
  };
  return { ctx, page, settled };
}

/** A generated square cover: a colour field with a big letter (no real artwork). */
async function generatedCover(browser: Browser, color: string, label: string): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.setContent(`<body style="margin:0;width:400px;height:400px;background:${color};display:flex;align-items:center;justify-content:center;font:bold 220px sans-serif;color:#fff">${label}</body>`);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 90 });
  await page.close();
  return jpeg;
}

test('#325a: a delivered request follows the ASIN Audiobookshelf holds now', async ({ browser }) => {
  test.setTimeout(1_500_000);
  for (const service of ['abs', 'rmab']) {
    expect(printenv(service, 'HTTPS_PROXY'), `${service} must run with --overrides abs-fake-metadata`).toBe(FAKE_PROXY);
  }
  const index = JSON.parse(stackExecSync('fake-arr', ['cat', '/fixtures/index.json']));
  const [martian, artemis, phm] = (['martian', 'artemis', 'phm'] as const).map((k) => index.books[k] as FixtureBook);
  expect(martian.asin).toBe('B082BHJMFF');
  expect(artemis.asin).toBe('B072R1CY4P');
  expect(phm.asin).toBe('B08G9PRS1K');
  expect(martian.title, 'run with --offline-fixtures').toMatch(/^Fixture Book /);

  // 0. Schedules off (back on in afterAll); wait out the boot burst (as 284-library-link).
  const rmab = await Rmab.loginAdmin();
  const { jobs } = await rmab.get<{ jobs: { id: string; type: string }[] }>('/api/admin/jobs');
  for (const type of SCHEDULES) {
    const job = jobs.find((j) => j.type === type);
    expect((await rmab.raw('PUT', `/api/admin/jobs/${job!.id}`, { enabled: false })).status, `disable ${type}`).toBe(200);
    disabledJobs.push(job!.id);
  }
  let lastOverdue = -1;
  let changedAt = Date.now();
  await waitFor('RMAB startup jobs settled', async () => {
    const logs = stackLogsSync('rmab');
    const overdue = (logs.match(/is overdue, triggering now/g) || []).length;
    if (overdue !== lastOverdue) {
      lastOverdue = overdue;
      changedAt = Date.now();
    }
    const refresh = [/\[AudibleRefresh\] Starting Audible data refresh/g, /\[AudibleRefresh\] (Cleanup complete|Error:)/g].map((r) => (logs.match(r) || []).length);
    const scans = [/\[ScanLibrary\] Scanning library/g, /\[ScanLibrary\] (Matched \d+\/\d+ requests|Error:)/g].map((r) => (logs.match(r) || []).length);
    return Date.now() - changedAt > 20_000 && refresh[1] >= refresh[0] && scans[1] >= scans[0] ? true : null;
  }, { timeoutMs: 420_000, intervalMs: 3_000 });

  // 1a. Deliver martian (X) for real up to `downloaded`.
  const def = {
    name: 'library-follow-325a', description: 'One mp3 torrent for book martian (generated tones).', book: 'martian',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [{ id: 'good', title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]', sizeMB: 420, seeders: 60, fixture: 'martian-mp3' }],
  };
  expect((await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) })).status).toBe(200);
  const idx = await rmab.get<{ indexers: unknown[]; flagConfigs: unknown[] }>('/api/admin/settings/prowlarr/indexers');
  expect((await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers: idx.indexers, flagConfigs: idx.flagConfigs })).ok).toBe(true);
  const since = markJobs();
  const requestId = (await rmab.requestBook((await fakeArr.books()).martian)).request.id;
  await waitFor('request downloaded', async () => ['downloaded', 'available', 'failed'].includes(psql(`select status from requests where id = ${sqlStr(requestId)}`)), { timeoutMs: 420_000, intervalMs: 3_000 });
  await waitOrganized(since, requestId);
  const delivered = bookRow(requestId);
  expect(delivered.status, 'precondition: delivered').toBe('downloaded');
  const rel = delivered.filePath.slice(MEDIA.length + 1);

  // 1b. Real ABS scan adds the folder; real ABS rematches go through the fake metadata.
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  expect((await fetch(`${urls.abs()}/api/libraries/${libraryId}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${abs.token}` } })).ok).toBe(true);
  const item = await waitFor('ABS item for RMAB folder', async () =>
    (await abs.libraryItems(libraryId)).find((i) => String(i.relPath || '').replace(/\/+$/, '') === rel) || null, { timeoutMs: 180_000, intervalMs: 2_000 });
  const rematch = async (asin: string) => {
    await abs.req('POST', `/api/items/${item.id}/match`, { provider: 'audible', asin, overrideDefaults: true, overrideDetails: true });
    const now = (await abs.req('GET', `/api/items/${item.id}`)).media?.metadata?.asin || '';
    expect(now, `precondition: the ABS item now holds ${asin}`).toBe(asin);
  };
  const absAuth = { Authorization: `Bearer ${abs.token}` };
  /** Give the ABS item a generated cover; returns the sha256 of the cover ABS now serves. */
  const setCover = async (color: string, label: string) => {
    const form = new FormData();
    form.append('cover', new Blob([new Uint8Array(await generatedCover(browser, color, label))], { type: 'image/jpeg' }), `cover-${label}.jpg`);
    const res = await fetch(`${urls.abs()}/api/items/${item.id}/cover`, { method: 'POST', headers: absAuth, body: form });
    expect(res.ok, `precondition: ABS took cover ${label} (${res.status})`).toBe(true);
    // ABS picks the cover format from Accept (a bare */* gets webp); ask as RMAB's axios download does.
    const served = await fetch(`${urls.abs()}/api/items/${item.id}/cover`, { headers: { ...absAuth, Accept: 'application/json, text/plain, */*' } });
    expect(served.ok, `precondition: ABS serves cover ${label}`).toBe(true);
    return sha256(await served.arrayBuffer());
  };
  /** The cover RMAB serves at a card's coverArtUrl. */
  const rmabCover = async (url: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('/')) return { url, status: 0, sha: null as string | null };
    const res = await fetch(`${urls.rmab()}${url}`);
    return { url, status: res.status, sha: res.ok ? sha256(await res.arrayBuffer()) : null };
  };
  const oneScan = async (label: string) => {
    const before = counts();
    const t0 = dbNow();
    await rmab.triggerScheduledJob('plex_library_scan');
    const status = await waitFor(`scan ${label}`, async () => {
      const s = psql(`select status from jobs where type in ${SCAN_TYPES} and created_at > ${sqlStr(t0)}::timestamp order by created_at desc limit 1`);
      return s === 'completed' || s === 'failed' ? s : null;
    }, { timeoutMs: 300_000, intervalMs: 2_000 });
    const after = counts();
    const row = bookRow(requestId);
    writeEvidence(`${DIR}/scan-${label}.json`, { status, before, after, row });
    expect.soft(status, `scan ${label}`).toBe('completed');
    expect.soft(after, `scan ${label}: no request, book or search job created`).toEqual(before);
    return row;
  };
  const listedBook = async () =>
    (await rmab.get<{ requests: { id: string; audiobook: Record<string, unknown> }[] }>('/api/requests?limit=100')).requests.find((r) => r.id === requestId)?.audiobook ?? {};
  const requested = { audibleAsin: martian.asin, title: delivered.title, author: delivered.author, narrator: delivered.narrator, series: delivered.series, year: delivered.year };
  await rematch(artemis.asin);
  const coverA = await setCover('#b4235a', 'A');
  const s1 = await oneScan('1-artemis');

  // 1c. API views.
  const listed = await listedBook();
  const admin = await rmab.get<{ requests: Record<string, unknown>[] }>('/api/admin/requests?pageSize=100');
  const adminRow = admin.requests.find((r) => r.requestId === requestId) ?? {};
  const recent = await rmab.get<{ requests: Record<string, unknown>[] }>('/api/admin/requests/recent');
  const recentRow = recent.requests.find((r) => r.requestId === requestId) ?? {};
  const adminSearch = await rmab.get<{ requests: Record<string, unknown>[] }>(`/api/admin/requests?search=${encodeURIComponent(artemis.title)}`);
  const detail = (await rmab.get<{ request: { audiobook: Record<string, unknown> } }>(`/api/requests/${requestId}`)).request.audiobook;
  const cover1 = await rmabCover(listed.coverArtUrl);
  const followLog = (stackLogsSync('rmab').match(/Following Audiobookshelf: "[^"]*" library ASIN \S+ -> \S+/g) || []);
  writeEvidence(`${DIR}/step1.json`, { s1, requested, listed, adminRow, recentRow, adminSearchIds: adminSearch.requests.map((r) => r.requestId), detail, cover1, coverA, followLog });

  // 1d. Screenshots (before Get ebook adds an ebook card). The modal's details response is a labelled replay:
  // RMAB's own Audible calls are refused under abs-fake-metadata; the point is which ASIN the modal asks for.
  const asked: string[] = [];
  {
    const { ctx, page, settled } = await session(browser, 1280, 900, false);
    await page.route(/\/api\/audiobooks\/[A-Z0-9]{10}$/, async (route) => {
      const asin = route.request().url().split('/').pop()!;
      asked.push(asin);
      const book = asin === martian.asin ? martian : asin === artemis.asin ? artemis : null;
      if (!book) return route.fulfill({ status: 404, json: { error: 'NotFound' } });
      await route.fulfill({ json: { success: true, audibleBaseUrl: 'https://www.audible.com', audiobook: { ...book, description: '(replayed details, e2e)', coverArtUrl: null, durationMinutes: 600 } } });
    });
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: artemis.title }).first()).toBeVisible({ timeout: 30_000 });
    await settled(DIR, 'card-1280-light');
    await page.getByRole('button', { name: artemis.title }).first().click();
    await expect(page.getByText(martian.title).first()).toBeVisible({ timeout: 15_000 });
    await settled(DIR, 'modal-requested');
    await page.goto('/admin');
    const row = page.getByText(artemis.title).first();
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await settled(DIR, 'admin-row');
    await ctx.close();
  }
  {
    const { ctx, page, settled } = await session(browser, 375, 812, true);
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: artemis.title }).first()).toBeVisible({ timeout: 30_000 });
    await settled(DIR, 'card-375-dark');
    await ctx.close();
  }

  // 1e. "Get ebook" from the modal keys on X: it must not create a Y audiobooks row. An ebook source is
  // turned on for this step, so the 400 "not enabled" answer cannot pass it vacuously.
  const ebookBefore = psql(`select coalesce((select value from configuration where key = ${sqlStr(EBOOK_KEY)}), '<none>')`);
  psql(`insert into configuration (id, key, value, updated_at) values (gen_random_uuid()::text, ${sqlStr(EBOOK_KEY)}, 'true', now()) on conflict (key) do update set value = 'true', updated_at = now()`);
  const booksBefore = counts().audiobooks;
  const ebook = await rmab.raw('POST', `/api/audiobooks/${martian.asin}/fetch-ebook`, {});
  const ebookBody = await ebook.json().catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 10_000)); // any ebook request and its search job land before step 2 counts
  const booksAfterEbook = counts().audiobooks;
  const yRows = Number(psql(`select count(*) from audiobooks where audible_asin = ${sqlStr(artemis.asin)}`));
  psql(ebookBefore === '<none>'
    ? `delete from configuration where key = ${sqlStr(EBOOK_KEY)}`
    : `update configuration set value = ${sqlStr(ebookBefore)} where key = ${sqlStr(EBOOK_KEY)}`);
  // Offline, RMAB cannot load X's details (404) and stops before any row is written: not reached.
  const ebookReached = ebook.status !== 400 && ebook.status !== 404;
  writeEvidence(`${DIR}/fetch-ebook.json`, { status: ebook.status, body: ebookBody, reached: ebookReached, booksBefore, booksAfterEbook, yRows });
  if (!ebookReached) test.info().annotations.push({ type: 'not reached', description: `Get ebook (X) answered ${ebook.status}: ${JSON.stringify(ebookBody)}` });

  // 2. Rematch to phm (Z) with another cover, one scan.
  await rematch(phm.asin);
  const coverB = await setCover('#1d4ed8', 'B');
  const s2 = await oneScan('2-phm');
  const listed2 = await listedBook();
  const cover2 = await rmabCover(listed2.coverArtUrl);
  const cover1After = await rmabCover(listed.coverArtUrl);
  writeEvidence(`${DIR}/step2.json`, { s2, listed2, cover2, coverB, cover1After });

  // 3. Ownership: X and Z stay owned.
  const post = async (book: FixtureBook) => {
    const res = await rmab.raw('POST', '/api/requests', { audiobook: { asin: book.asin, title: book.title, author: book.author, narrator: book.narrator } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const ownedBefore = counts();
  const postX = await post(martian);
  const postZ = await post(phm);
  const torrentRes = await rmab.raw('POST', '/api/audiobooks/request-with-torrent', {
    audiobook: { asin: martian.asin, title: martian.title, author: martian.author },
    torrent: { guid: 'e2e-325a', title: `${martian.author} - ${martian.title}`, size: 1000, indexer: 'E2E Torrents', downloadUrl: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567', publishDate: new Date().toISOString() },
  });
  const torrent = { status: torrentRes.status, body: await torrentRes.json().catch(() => null) };
  const ownedAfter = counts();
  writeEvidence(`${DIR}/ownership.json`, { postX, postZ, torrent, ownedBefore, ownedAfter });

  // 4. Back to X, one scan. Then Z is no longer owned: a new request's POST response carries the
  // audiobook record as stored, without the library ASIN column.
  await rematch(martian.asin);
  const s4 = await oneScan('4-martian');
  const postZAfter = await post(phm);
  writeEvidence(`${DIR}/post-after.json`, postZAfter);

  expect.soft(s1, 'step 1 SQL').toMatchObject({ status: 'available', absItemId: item.id, libraryAsin: artemis.asin, ...requested });
  expect.soft(listed, 'GET /api/requests').toMatchObject({ audibleAsin: martian.asin, libraryAsin: artemis.asin, title: artemis.title });
  expect.soft(String(listed.coverArtUrl), 'step 1 cover: the library cache, named by Y').toMatch(new RegExp(`^/api/cache/library/[0-9a-f]{16}-${artemis.asin}\\.jpg$`));
  expect.soft(cover1, 'step 1 cover: RMAB serves ABS cover A').toMatchObject({ status: 200, sha: coverA });
  expect.soft(adminRow, 'admin list').toMatchObject({ asin: martian.asin, libraryAsin: artemis.asin, title: delivered.title, author: delivered.author, displayTitle: artemis.title });
  expect.soft(recentRow, 'admin recent').toMatchObject({ title: delivered.title, displayTitle: artemis.title, libraryAsin: artemis.asin });
  expect.soft(adminSearch.requests.map((r) => r.requestId), 'admin search by the library title').toContain(requestId);
  expect.soft(detail, 'GET /api/requests/:id').toMatchObject({ audibleAsin: martian.asin, libraryAsin: artemis.asin, title: artemis.title, coverArtUrl: listed.coverArtUrl });
  expect.soft(followLog, 'one follow so far').toEqual([`Following Audiobookshelf: "${delivered.title}" library ASIN ${martian.asin} -> ${artemis.asin}`]);
  expect.soft(asked, 'the card modal asked for the requested ASIN only').toEqual([martian.asin]);
  if (ebookReached) {
    expect.soft(booksAfterEbook, 'Get ebook created no audiobooks row').toBe(booksBefore);
    expect.soft(yRows, 'no row for the library ASIN').toBe(0);
  }
  expect.soft(s2, 'step 2').toMatchObject({ status: 'available', libraryAsin: phm.asin, ...requested });
  expect.soft(listed2, 'step 2: GET /api/requests shows Z').toMatchObject({ audibleAsin: martian.asin, libraryAsin: phm.asin, title: phm.title });
  expect.soft(String(listed2.coverArtUrl), 'step 2 cover: a new URL, named by Z').toMatch(new RegExp(`^/api/cache/library/[0-9a-f]{16}-${phm.asin}\\.jpg$`));
  expect.soft(cover2, 'step 2 cover: RMAB serves ABS cover B').toMatchObject({ status: 200, sha: coverB });
  expect.soft(coverB, 'precondition: covers A and B differ').not.toBe(coverA);
  expect.soft(cover1After.status, 'step 2: the old cover file is gone').toBe(404);
  expect.soft([postX.status, postZ.status, torrent.status], 'X, Z, request-with-torrent X refused').toEqual([409, 409, 409]);
  expect.soft(torrent.body?.error, 'request-with-torrent').toBe('AlreadyAvailable');
  expect.soft(ownedAfter, 'no request or search job from the ownership checks').toEqual(ownedBefore);
  expect.soft(postZAfter.status, 'after step 4, Z can be requested').toBe(201);
  expect.soft(Object.keys(postZAfter.body?.request?.audiobook ?? { missing: true }), 'POST response: no stored library ASIN').not.toContain('libraryAsin');
  expect.soft(postZAfter.body?.request?.audiobook?.audibleAsin, 'POST response carries the audiobook').toBe(phm.asin);
  expect(s4, 'step 4: back to the requested ASIN clears it').toMatchObject({ status: 'available', libraryAsin: '', ...requested });
});
