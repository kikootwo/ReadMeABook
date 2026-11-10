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
 *   Outage leg: an unknown ASIN while Audible is unreachable (the refused lookup returns null, as a
 *         true not-found does); the dialog's "Nothing came back" text is true in both cases.
 * The dialog flows are shot at 1280 light and 375 dark (no import in the 375 context); the finished
 * screen at 1280 light, then the same page at 375 dark. Helpers and fixtures in `189-helpers.ts`.
 * Screenshots go to 189/*.jpg; values are recorded (189/*.json) before the soft asserts.
 */

import { test, expect } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, writeEvidence, Rmab } from '../../lib/harness';
import { genTracks, withSettings, ALL_OFF, libraryFolder, organizeJobs, waitRequestsSettled, bulkScan, markJobs, psql, sh, q, MEDIA } from './434-helpers';
import {
  RUN, ROOT, MEDIA_ROOT, AUTHOR, BOOK, UNKNOWN_ASIN, FOLDERS, SEARCH_REPLAY, blocked, seed, activeRequest, requestsFor, cleanup,
  scanReplayBody, session, openReview, row, dialog, typeAsin, fieldFocused,
} from './189-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });
test.use({ storageState: evidencePath('storage-state.json') });

const SAME_BOOK = 'Same book as another row: change or skip one';
const obs: Record<string, any> = { image: process.env.E2E_RMAB_IMAGE || '', run: RUN, replays: { scan: 'labelled page.route replay of the real scan rows with matches', search: 'labelled page.route replay' } };
let realRows: any[] = [];
const scanBody = () => scanReplayBody(realRows);

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
    const { ctx, page } = await session(browser, { width: 375, height: 812, dark: true, scanBody });
    await openReview(page, 'Downloads', ['e2e-189', RUN]);
    await page.waitForTimeout(400);
    await snap(page, '189', 'review-375-dark');
    // The list scrolls inside the dialog: a second shot shows the Requested and In Library rows
    await row(page, 'Folder Delta').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await snap(page, '189', 'review-375-dark-scrolled');
    obs.phone = {
      findMatchHeight: (await row(page, 'Folder Bravo').getByRole('button', { name: /Find match/ }).boundingBox())?.height ?? null,
      scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    };
    expect.soft(obs.phone.findMatchHeight, 'Find match is at least 44 px tall on a phone').toBeGreaterThanOrEqual(44);
    expect.soft(obs.phone.scrollWidth, 'no sideways scroll at 375').toBeLessThanOrEqual(375);

    // The dialog on a phone: the field lets go of focus once results show (the keyboard drops)
    await row(page, 'Folder Alpha').getByRole('button', { name: 'Change match for Folder Alpha' }).click();
    await expect(dialog(page).getByRole('status')).toHaveText('3 results', { timeout: 30_000 });
    obs.phone.fieldFocusedAfterResults = await fieldFocused(page);
    expect.soft(obs.phone.fieldFocusedAfterResults, 'phone: the field is not focused once results show').toBe(false);
    await snap(page, '189', 'dialog-results-375-dark');
    await dialog(page).getByRole('button', { name: new RegExp(BOOK.search.title) }).click();
    await row(page, BOOK.search.title).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(row(page, BOOK.search.title).getByRole('button', { name: 'Undo change for Folder Alpha' })).toBeVisible();
    await page.waitForTimeout(300);
    await snap(page, '189', 'changed-row-undo-375-dark');
    await row(page, 'Folder Bravo').getByRole('button', { name: 'Find match for Folder Bravo' }).click();
    await typeAsin(page, UNKNOWN_ASIN);
    obs.phone.outageStatus = await dialog(page).getByRole('status').innerText();
    await snap(page, '189', 'dialog-asin-unreachable-375-dark');
    await typeAsin(page, BOOK.owned.asin.toLowerCase());
    await snap(page, '189', 'dialog-typed-in-library-375-dark');
    await page.keyboard.press('Escape');
    await row(page, 'Folder Foxtrot').evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(300);
    obs.phone.sameBook = await row(page, 'Folder Foxtrot').getByText(SAME_BOOK).count();
    expect.soft(obs.phone.sameBook, 'the marker shows at 375').toBe(1);
    await snap(page, '189', 'same-book-marked-375-dark');
    await ctx.close();
  }

  const { ctx, page } = await session(browser, { width: 1280, height: 800, scanBody });
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

    // Two rows the scan matched to one book are marked and held back (not counted, not sent)
    obs.sameBook = { echo: await row(page, 'Folder Echo').getByText(SAME_BOOK).count(), foxtrot: await row(page, 'Folder Foxtrot').getByText(SAME_BOOK).count() };
    expect.soft(obs.sameBook).toEqual({ echo: 1, foxtrot: 1 });
    // Foxtrot is the last row: scrolled to it, Echo sits just above
    await row(page, 'Folder Foxtrot').evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(300);
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
    obs.outage = { label: 'Audible unreachable (the refused lookup answers null, as a true not-found does)', status: await dialog(page).getByRole('status').innerText() };
    expect.soft(obs.outage.status).toBe(`Nothing came back for ${UNKNOWN_ASIN} from audible.com`);
    expect.soft(obs.phone.outageStatus, 'same text at 375').toBe(obs.outage.status);
    await snap(page, '189', 'dialog-asin-unreachable');
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

    // Import: real execute; the footer leaves out the two held-back rows
    obs.footer = (await page.getByText(/to import/).innerText()).replace(/\s+/g, ' ').trim();
    expect.soft(obs.footer).toBe('4 books to import (1 skipped)');
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
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await snap(page, '189', 'finished-refused-375-dark');
    expect.soft(obs.sent.map((x: any) => x.folder), 'the held-back pair is not sent').toEqual(['Folder Alpha', 'Folder Bravo', 'Folder Charlie', 'Folder Golf']);
    expect.soft(obs.results.map((r: any) => [r.folder, r.asin, r.success, r.error])).toEqual([
      ['Folder Alpha', BOOK.search.asin, true, null],
      ['Folder Bravo', BOOK.typed.asin, true, null],
      ['Folder Charlie', BOOK.fix.asin, true, null],
      ['Folder Golf', BOOK.race.asin, false, 'Already requested'],
    ]);
    expect.soft(obs.finishedList.map((t: string) => t.replace(/\s+/g, ' ').trim()), 'refused rows by position, then the held-back rows').toEqual([
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

  const { ctx, page } = await session(browser, { width: 1280, height: 800, scanBody: null });
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
  // The server backstop: two rows naming one book are both refused
  const pair = await rmab.raw('POST', '/api/admin/bulk-import/execute', { imports: ['Folder Echo', 'Folder Foxtrot'].map((f) => ({ folderPath: `${ROOT}/${f}`, asin: BOOK.twice.asin, audioFiles: ['01.m4a'] })) });
  media.pair = { status: pair.status, results: (await pair.json()).results };
  media.requestCount = { before, after: psql('select count(*) from requests') };
  expect.soft(media.noAsin.results?.[0]).toMatchObject({ success: false, error: 'Invalid ASIN' });
  expect.soft(media.owned.results?.[0]).toMatchObject({ success: false, error: 'Already in your library' });
  expect.soft(media.pair.results?.map((r: any) => r.error)).toEqual(['Same book as another row', 'Same book as another row']);
  expect.soft(media.requestCount.after, 'no request created').toBe(media.requestCount.before);
  writeEvidence('189/media-and-crafted.json', media);
});
