/**
 * Component: E2E regression #189 (change a row's match on the Bulk Import review screen; #588)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with `--offline-fixtures --overrides abs-fake-metadata`: RMAB's own Audible/Audnexus calls are
 * refused, so no lookup reaches a real provider. Every book is a made-up name on a fake ASIN
 * (B0E2E189xx) seeded in audible_cache + audiobooks; covers are flat SVGs drawn in the browser, and
 * the browser never leaves the RMAB origin (anything else is aborted and recorded).
 *   Real: the scan API (offline every row is No Match, recorded as the reason for the replay), every
 *         typed-ASIN lookup (database first), its In Library / Requested flags (a plex_library row,
 *         a pending request), execute, organize, the library folders and the ASIN tag, the media-
 *         folder scan in the UI, and two crafted execute calls (no ASIN #588; a book in the library).
 *   Labelled replays (page.route): the scan stream the wizard reads (the real rows, given matches),
 *         and the text search's results (RMAB's Audible search cannot run offline).
 *   Outage leg: an unknown ASIN is "Audible unreachable shown as not found" (the refused lookup
 *         returns null, as a true not-found does).
 * Screenshots go to 189/*.jpg; values are recorded (189/*.json) before the soft asserts.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, writeEvidence, Rmab } from '../../lib/harness';
import { genTracks, withSettings, ALL_OFF, libraryFolder, organizeJobs, waitRequestsSettled, bulkScan, markJobs, psql, sqlStr, sh, q, MEDIA } from './434-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });
test.use({ storageState: evidencePath('storage-state.json') });

const RUN = `run-${Date.now().toString(36)}`;
const ROOT_PARENT = '/downloads/e2e-189';
const ROOT = `${ROOT_PARENT}/${RUN}`;
const MEDIA_ROOT = `${MEDIA}/e2e-189-${RUN}`;
const AUTHOR = 'E2E Fixture Author';
const COVER_HOST = 'covers.e2e.invalid';

const BOOK = {
  wrong: { asin: 'B0E2E18901', title: 'E2E Wrong Guess' },
  search: { asin: 'B0E2E18902', title: 'E2E Search Pick' },
  typed: { asin: 'B0E2E18903', title: 'E2E Typed Pick' },
  owned: { asin: 'B0E2E18904', title: 'E2E Owned Book' },
  asked: { asin: 'B0E2E18905', title: 'E2E Asked Book' },
  fix: { asin: 'B0E2E18907', title: 'E2E Requested Fix' },
  twice: { asin: 'B0E2E18908', title: 'E2E Twice Found' },
  race: { asin: 'B0E2E18909', title: 'E2E Late Request' },
} as const;
const ALL_ASINS = Object.values(BOOK).map((b) => b.asin);
const UNKNOWN_ASIN = 'B0E2E18999';
const PLEX_GUID = `e2e-189-${RUN}`;

const FOLDERS = ['Folder Alpha', 'Folder Bravo', 'Folder Charlie', 'Folder Delta', 'Folder Golf', 'Folder Echo', 'Folder Foxtrot'];
const cover = (asin: string) => `https://${COVER_HOST}/${asin}.jpg`;
const match = (b: { asin: string; title: string }) => ({ asin: b.asin, title: b.title, author: AUTHOR, narrator: 'E2E Narrator', coverArtUrl: cover(b.asin), durationMinutes: 61 });

/** What the replayed scan gives each real row (by folder name): the scan's match and flags. */
const REPLAY: Record<string, { match: ReturnType<typeof match> | null; inLibrary?: boolean; hasActiveRequest?: boolean }> = {
  'Folder Alpha': { match: match(BOOK.wrong) },
  'Folder Bravo': { match: null },
  'Folder Charlie': { match: match(BOOK.asked), hasActiveRequest: true },
  'Folder Delta': { match: match(BOOK.owned), inLibrary: true },
  'Folder Golf': { match: match(BOOK.race) },
  'Folder Echo': { match: match(BOOK.twice) },
  'Folder Foxtrot': { match: match(BOOK.twice) },
};
/** Replayed text-search results: one free book, one In Library, one Requested. */
const SEARCH_REPLAY = [
  { ...match(BOOK.search), inLibrary: false, hasActiveRequest: false },
  { ...match(BOOK.owned), inLibrary: true, hasActiveRequest: false },
  { ...match(BOOK.asked), inLibrary: false, hasActiveRequest: true },
];

const obs: Record<string, any> = { image: process.env.E2E_RMAB_IMAGE || '', run: RUN, replays: { scan: 'labelled page.route replay of the real scan rows with matches', search: 'labelled page.route replay' } };
const blocked: string[] = [];
let realRows: any[] = [];

function seed() {
  for (const b of Object.values(BOOK)) {
    psql(`insert into audible_cache (id, asin, title, author, narrator, description, genres, last_synced_at, created_at, updated_at)
          values (gen_random_uuid(), ${sqlStr(b.asin)}, ${sqlStr(b.title)}, ${sqlStr(AUTHOR)}, 'E2E Narrator', 'Generated test book.', '[]'::jsonb, now(), now(), now())
          on conflict (asin) do nothing`);
    psql(`insert into audiobooks (id, audible_asin, title, author, narrator, series, series_part, year, status, created_at, updated_at)
          values (gen_random_uuid(), ${sqlStr(b.asin)}, ${sqlStr(b.title)}, ${sqlStr(AUTHOR)}, 'E2E Narrator', 'E2E 189 Series', '1', 2020, 'requested', now(), now())`);
  }
  psql(`insert into plex_library (id, plex_guid, title, author, asin, plex_library_id, last_scanned_at, created_at, updated_at)
        values (gen_random_uuid(), ${sqlStr(PLEX_GUID)}, ${sqlStr(BOOK.owned.title)}, ${sqlStr(AUTHOR)}, ${sqlStr(BOOK.owned.asin)}, 'e2e-189', now(), now(), now())`);
  activeRequest(BOOK.asked.asin);
}

/** A pending request (the admin's) for the book: the scan's Requested. */
function activeRequest(asin: string) {
  psql(`insert into requests (id, user_id, audiobook_id, type, status, progress, created_at, updated_at)
        select gen_random_uuid(), (select id from users where role = 'admin' order by created_at limit 1), id, 'audiobook', 'pending', 0, now(), now()
        from audiobooks where audible_asin = ${sqlStr(asin)} limit 1`);
}

function requestsFor(asin: string): string[] {
  return psql(`select r.status from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin = ${sqlStr(asin)} and r.deleted_at is null order by r.created_at`)
    .split('\n').filter(Boolean);
}

function cleanup(): string[] {
  const errors: string[] = [];
  try {
    sh(`rm -rf ${q(ROOT)} ${q(MEDIA_ROOT)}\nrmdir ${q(ROOT_PARENT)} 2>/dev/null || true`);
    for (const asin of ALL_ASINS) {
      const folder = libraryFolder(asin);
      if (folder) sh(`rm -rf ${q(folder)}`);
    }
  } catch (error) {
    errors.push(`files: ${String(error)}`);
  }
  const list = ALL_ASINS.map(sqlStr).join(',');
  const reqs = `(select id from requests where audiobook_id in (select id from audiobooks where audible_asin in (${list})))`;
  try {
    psql(`begin;
          delete from job_events where job_id in (select id from jobs where request_id in ${reqs});
          delete from jobs where request_id in ${reqs};
          delete from requests where id in ${reqs};
          delete from audiobooks where audible_asin in (${list});
          delete from audible_cache where asin in (${list});
          delete from plex_library where plex_guid = ${sqlStr(PLEX_GUID)};
          commit;`);
  } catch (error) {
    errors.push(`rows: ${String(error).slice(0, 400)}`);
  }
  return errors;
}

function coverSvg(url: string) {
  let h = 0;
  for (const c of url) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${h},45%,42%)"/></svg>`;
}

/** A context held to the RMAB origin, with the scan and text-search replays. */
async function session(browser: Browser, opts: { width: number; height: number; dark?: boolean; replayScan?: boolean }) {
  const ctx: BrowserContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  const base = new URL(process.env.E2E_BASE_URL!).host;
  await ctx.route((url) => url.host !== base, (route) => {
    const url = route.request().url();
    if (new URL(url).host === COVER_HOST) return route.fulfill({ contentType: 'image/svg+xml', body: coverSvg(url) });
    blocked.push(url);
    return route.abort();
  });
  if (opts.replayScan !== false) {
    await ctx.route((url) => url.pathname === '/api/admin/bulk-import/scan', (route) => route.fulfill({ contentType: 'text/event-stream', body: scanReplayBody() }));
  }
  await ctx.route((url) => url.pathname === '/api/admin/bulk-import/match', (route) => {
    const text = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (/^(B0[A-Z0-9]{8}|\d{9}[\dX])$/i.test(text.trim())) return route.continue(); // typed ASIN: the real route
    return route.fulfill({ json: { kind: 'search', asin: null, store: 'audible.com', results: SEARCH_REPLAY } });
  });
  return { ctx, page: await ctx.newPage() };
}

function scanReplayBody(): string {
  const rows = FOLDERS.map((name, index) => {
    const real = realRows.find((r) => r.folderName === name);
    const r = REPLAY[name];
    return { ...real, index, match: r.match, inLibrary: !!r.inLibrary, hasActiveRequest: !!r.hasActiveRequest };
  });
  return [...rows.map((r) => `event: book_matched\ndata: ${JSON.stringify(r)}\n\n`), `event: complete\ndata: {}\n\n`].join('');
}

/** Admin page → Bulk Import → into `segments` under the root → Scan; resolves on the review footer. */
async function openReview(page: Page, rootLabel: string, segments: string[]) {
  await page.goto('/admin');
  await page.getByRole('button', { name: /Bulk Import/ }).first().click();
  await page.getByRole('button', { name: new RegExp(rootLabel) }).click();
  for (const seg of segments) await page.getByRole('button', { name: seg, exact: true }).click();
  await page.getByRole('button', { name: 'Scan for Audiobooks' }).click();
  await expect(page.getByRole('button', { name: 'Start Import' })).toBeVisible({ timeout: 180_000 });
}

const row = (page: Page, text: string) => page.getByTestId('bulk-import-row').filter({ hasText: text });
const dialog = (page: Page) => page.getByRole('dialog');

async function typeAsin(page: Page, asin: string) {
  await dialog(page).getByRole('searchbox').fill(asin);
  await dialog(page).getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog(page).getByRole('status')).not.toHaveText('Searching…', { timeout: 30_000 });
  await expect(dialog(page).getByRole('status')).not.toHaveText('');
}

test.beforeAll(() => {
  cleanup();
  for (const name of FOLDERS) genTracks(`${ROOT}/${name}`, [{ rel: '01.m4a', seconds: 2 }]);
  genTracks(`${MEDIA_ROOT}/Folder Media`, [{ rel: '01.m4a', seconds: 2 }]);
  seed();
});

test.afterAll(() => {
  obs.cleanupErrors = cleanup();
  obs.blockedRequests = blocked;
  writeEvidence('189/run.json', obs);
});

test('189: change a match by search and by typed ASIN, refusals listed, books imported as picked', async ({ browser }) => {
  test.setTimeout(600_000);
  const rmab = await Rmab.loginAdmin();

  // Real scan first: offline every row is No Match (why the wizard's scan stream is replayed)
  const scan = await bulkScan(rmab, ROOT);
  realRows = scan.events.filter((e) => e.event === 'book_matched').map((e) => e.data);
  obs.realScan = realRows.map((r) => ({ folderName: r.folderName, match: r.match, inMediaFolder: r.inMediaFolder }));
  expect(realRows.map((r) => r.folderName).sort()).toEqual([...FOLDERS].sort());
  expect.soft(realRows.every((r) => r.match === null && r.inMediaFolder === false), 'offline: No Match, not in the media folder').toBe(true);

  // 375 dark: the review list (matched, No Match, Requested, In Library rows)
  {
    const { ctx, page } = await session(browser, { width: 375, height: 812, dark: true });
    await openReview(page, 'Downloads', ['e2e-189', RUN]);
    await page.waitForTimeout(400);
    await snap(page, '189', 'review-375-dark');
    obs.phone = {
      findMatchHeight: (await row(page, 'Folder Bravo').getByRole('button', { name: /Find match/ }).boundingBox())?.height ?? null,
      scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    };
    expect.soft(obs.phone.findMatchHeight, 'Find match is at least 44 px tall on a phone').toBeGreaterThanOrEqual(44);
    expect.soft(obs.phone.scrollWidth, 'no sideways scroll at 375').toBeLessThanOrEqual(375);
    await ctx.close();
  }

  const { ctx, page } = await session(browser, { width: 1280, height: 800 });
  await withSettings({ ...ALL_OFF, metadata_tagging_enabled: 'true' }, async () => {
    await openReview(page, 'Downloads', ['e2e-189', RUN]);
    // Requested after the review loaded: the import must refuse it on its own
    activeRequest(BOOK.race.asin);
    await page.waitForTimeout(400);
    await snap(page, '189', 'review-1280-light');
    obs.controls = Object.fromEntries(await Promise.all(FOLDERS.map(async (name) => [name, await row(page, name).getByRole('button', { name: /match for/ }).allInnerTexts()])));
    expect.soft(obs.controls).toEqual({
      'Folder Alpha': ['Change match'], 'Folder Bravo': ['Find match'], 'Folder Charlie': ['Change match'], 'Folder Delta': [],
      'Folder Golf': ['Change match'], 'Folder Echo': ['Change match'], 'Folder Foxtrot': ['Change match'],
    });
    obs.dimmed = {
      bravoBody: await row(page, 'Folder Bravo').getByTestId('bulk-import-row-body').evaluate((el) => getComputedStyle(el).opacity),
      bravoButton: await row(page, 'Folder Bravo').getByRole('button', { name: /Find match/ }).evaluate((el) => {
        let o = 1;
        for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
        return o;
      }),
    };
    expect.soft(obs.dimmed.bravoBody, 'a skipped row dims its cover and text').toBe('0.4');
    expect.soft(obs.dimmed.bravoButton, 'Find match at full strength on a skipped row').toBe(1);

    // Two rows the scan matched to one book are marked before import
    obs.sameBook = { echo: await row(page, 'Folder Echo').getByText('Same book as another row').count(), foxtrot: await row(page, 'Folder Foxtrot').getByText('Same book as another row').count() };
    expect.soft(obs.sameBook).toEqual({ echo: 1, foxtrot: 1 });
    await row(page, 'Folder Echo').scrollIntoViewIfNeeded();
    await snap(page, '189', 'same-book-marked');

    // Row A: search replay; In Library and Requested hits cannot be picked
    await row(page, 'Folder Alpha').getByRole('button', { name: 'Change match for Folder Alpha' }).click();
    await expect(dialog(page).getByRole('status')).toHaveText('3 results', { timeout: 30_000 });
    obs.searchHits = await Promise.all(SEARCH_REPLAY.map(async (b) => ({ asin: b.asin, disabled: await dialog(page).getByRole('button', { name: new RegExp(b.title) }).isDisabled() })));
    expect.soft(obs.searchHits.map((h: any) => h.disabled)).toEqual([false, true, true]);
    await snap(page, '189', 'dialog-results');
    await dialog(page).getByRole('button', { name: new RegExp(BOOK.search.title) }).click();
    await expect(row(page, BOOK.search.title).getByRole('button', { name: 'Undo change for Folder Alpha' })).toBeVisible();
    await snap(page, '189', 'changed-row-undo');
    await row(page, BOOK.search.title).getByRole('button', { name: 'Undo change for Folder Alpha' }).click();
    obs.afterUndo = await row(page, 'Folder Alpha').getByText(BOOK.wrong.title).count();
    expect.soft(obs.afterUndo, 'Undo brings back the scan match').toBe(1);
    await row(page, 'Folder Alpha').getByRole('button', { name: 'Change match for Folder Alpha' }).click();
    await dialog(page).getByRole('button', { name: new RegExp(BOOK.search.title) }).click();

    // Row B: typed ASINs, all real lookups (database first)
    await row(page, 'Folder Bravo').getByRole('button', { name: 'Find match for Folder Bravo' }).click();
    await typeAsin(page, UNKNOWN_ASIN);
    obs.outage = { label: 'Audible unreachable shown as not found', status: await dialog(page).getByRole('status').innerText() };
    expect.soft(obs.outage.status).toBe(`No book found for ${UNKNOWN_ASIN} on audible.com`);
    await snap(page, '189', 'dialog-asin-unreachable-as-not-found');
    await typeAsin(page, BOOK.owned.asin.toLowerCase());
    obs.typedOwned = { disabled: await dialog(page).getByRole('button', { name: new RegExp(BOOK.owned.title) }).isDisabled(), badge: await dialog(page).getByText('In Library').count() };
    await snap(page, '189', 'dialog-typed-in-library');
    await typeAsin(page, BOOK.asked.asin);
    obs.typedAsked = { disabled: await dialog(page).getByRole('button', { name: new RegExp(BOOK.asked.title) }).isDisabled(), badge: await dialog(page).getByText('Requested').count() };
    expect.soft(obs.typedOwned).toEqual({ disabled: true, badge: 1 });
    expect.soft(obs.typedAsked).toEqual({ disabled: true, badge: 1 });
    await typeAsin(page, BOOK.typed.asin.toLowerCase());
    await dialog(page).getByRole('button', { name: new RegExp(BOOK.typed.title) }).click();

    // Row C (Requested): the picked book takes over; badge gone, toggle on
    await row(page, 'Folder Charlie').getByRole('button', { name: 'Change match for Folder Charlie' }).click();
    await expect(dialog(page).getByRole('status')).toHaveText('3 results', { timeout: 30_000 });
    await typeAsin(page, BOOK.fix.asin);
    await dialog(page).getByRole('button', { name: new RegExp(BOOK.fix.title) }).click();
    const charlie = row(page, BOOK.fix.title);
    obs.requestedRow = { badge: await charlie.getByText('Requested', { exact: true }).count(), toggleTitle: await charlie.locator('button[title]').last().getAttribute('title') };
    expect.soft(obs.requestedRow).toEqual({ badge: 0, toggleTitle: 'Click to skip this book' });

    // Import: real execute
    const mark = markJobs();
    const reqP = page.waitForRequest((r) => r.url().endsWith('/api/admin/bulk-import/execute'));
    const resP = page.waitForResponse((r) => r.url().endsWith('/api/admin/bulk-import/execute'));
    await page.getByRole('button', { name: 'Start Import' }).click();
    const [req, res] = await Promise.all([reqP, resP]);
    obs.sent = req.postDataJSON().imports.map((i: any) => ({ folder: i.folderPath.split('/').pop(), asin: i.asin }));
    obs.results = (await res.json()).results.map((r: any) => ({ folder: r.folderPath.split('/').pop(), asin: r.asin, success: r.success, error: r.error ?? null, requestId: r.requestId ?? null }));
    await expect(page.getByRole('list', { name: 'Books not queued' })).toBeVisible();
    obs.finishedList = await page.getByRole('list', { name: 'Books not queued' }).getByRole('listitem').allInnerTexts();
    await snap(page, '189', 'finished-refused');
    expect.soft(obs.results.map((r: any) => [r.folder, r.asin, r.success, r.error])).toEqual([
      ['Folder Alpha', BOOK.search.asin, true, null],
      ['Folder Bravo', BOOK.typed.asin, true, null],
      ['Folder Charlie', BOOK.fix.asin, true, null],
      ['Folder Golf', BOOK.race.asin, false, 'Already requested'],
      ['Folder Echo', BOOK.twice.asin, false, 'Same book as another row'],
      ['Folder Foxtrot', BOOK.twice.asin, false, 'Same book as another row'],
    ]);
    expect.soft(obs.finishedList.map((t: string) => t.replace(/\s+/g, ' ').trim()), 'refused rows listed by position with their reasons').toEqual([
      'Folder Golf Already requested',
      'Folder Echo Same book as another row',
      'Folder Foxtrot Same book as another row',
    ]);

    const ids = obs.results.filter((r: any) => r.requestId).map((r: any) => r.requestId);
    obs.settled = await waitRequestsSettled(mark, ids).catch((e) => ({ error: String(e) }));
    obs.organize = organizeJobs(mark).map((j) => ({ status: j.status, audiobookId: j.payload?.audiobookId ?? null }));
  });
  await ctx.close();

  obs.requests = Object.fromEntries(Object.entries(BOOK).map(([k, b]) => [k, requestsFor(b.asin)]));
  expect.soft(obs.requests.wrong, 'no request for the scan\'s wrong guess').toEqual([]);
  expect.soft(obs.requests.twice, 'no request for the twice-found book').toEqual([]);
  expect.soft(obs.requests.race, 'the late request is untouched').toEqual(['pending']);
  for (const k of ['search', 'typed', 'fix'] as const) {
    const folder = libraryFolder(BOOK[k].asin);
    // The organizer places the single .m4a as .m4b
    const file = folder ? sh(`find ${q(folder)} -type f \\( -name '*.m4a' -o -name '*.m4b' \\) | head -1`).trim() : '';
    const tags = file ? JSON.parse(sh(`ffprobe -v error -show_entries format_tags -of json ${q(file)}`) || '{}').format?.tags ?? {} : {};
    obs[`library_${k}`] = {
      folder, file,
      asinTag: tags.ASIN ?? null, album: tags.album ?? null, requests: obs.requests[k],
    };
    expect.soft(folder, `library folder for ${k}`).toBe(`${MEDIA}/${AUTHOR}/${BOOK[k].title} ${BOOK[k].asin}`);
    expect.soft(obs[`library_${k}`].asinTag, `ASIN tag for ${k}`).toBe(BOOK[k].asin);
    expect.soft(obs.requests[k].length, `one request for ${k}`).toBe(1);
  }
  writeEvidence('189/flow.json', obs);
});

test('189: no control on media-folder rows; crafted rows are refused (no ASIN #588, in the library)', async ({ browser }) => {
  test.setTimeout(420_000);
  const rmab = await Rmab.loginAdmin();
  const media: Record<string, any> = {};

  const scan = await bulkScan(rmab, MEDIA_ROOT);
  media.realScan = scan.events.filter((e) => e.event === 'book_matched').map((e) => ({ folderName: e.data.folderName, match: e.data.match, inMediaFolder: e.data.inMediaFolder }));
  expect.soft(media.realScan).toEqual([{ folderName: 'Folder Media', match: null, inMediaFolder: true }]);

  const { ctx, page } = await session(browser, { width: 1280, height: 800, replayScan: false });
  await openReview(page, 'Media Library', [`e2e-189-${RUN}`]);
  media.ui = {
    noMatchBadge: await row(page, 'Folder Media').getByText('No Match').count(),
    controls: await row(page, 'Folder Media').getByRole('button', { name: /match for/ }).count(),
  };
  await snap(page, '189', 'media-folder-no-control');
  expect.soft(media.ui).toEqual({ noMatchBadge: 1, controls: 0 });
  await ctx.close();

  const before = psql('select count(*) from requests');
  const noAsin = await rmab.raw('POST', '/api/admin/bulk-import/execute', { imports: [{ folderPath: `${ROOT}/Folder Delta`, audioFiles: ['01.m4a'] }] });
  media.noAsin = { status: noAsin.status, results: (await noAsin.json()).results };
  const owned = await rmab.raw('POST', '/api/admin/bulk-import/execute', { imports: [{ folderPath: `${ROOT}/Folder Delta`, asin: BOOK.owned.asin, audioFiles: ['01.m4a'] }] });
  media.owned = { status: owned.status, results: (await owned.json()).results };
  media.requestCount = { before, after: psql('select count(*) from requests') };
  expect.soft(media.noAsin.results?.[0]).toMatchObject({ success: false, error: 'Invalid ASIN' });
  expect.soft(media.owned.results?.[0]).toMatchObject({ success: false, error: 'Already in your library' });
  expect.soft(media.requestCount.after, 'no request created').toBe(media.requestCount.before);
  writeEvidence('189/media-and-crafted.json', media);
});
