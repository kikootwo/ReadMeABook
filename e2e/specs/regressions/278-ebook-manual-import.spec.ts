/**
 * Component: E2E regression #278 (Manual Import from an ebook request imports the ebook, not the audiobook)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with `--offline-fixtures --overrides abs-fake-metadata` (fake ASIN seeded in the database; no
 * RMAB lookup reaches a real metadata provider). One book, two requests:
 *   - the audiobook, imported through the app's own Manual Import (generated mp3), then `available`;
 *   - a failed ebook request for the same book (as the ebook search leaves it).
 * A download folder holds a generated mp3 and a generated epub stand-in. Through the UI (My Requests,
 * the ebook card, its details modal, Manual Import, cleanup source on): the browser lists the epub,
 * not the mp3, and the import sends the ebook request. Afterwards: the epub is in the book's library
 * folder (the ebook path falls back to the audiobook template), the ebook request is `downloaded`,
 * the audiobook request, its book row (path, files hash) and its library files are untouched, no
 * organize job ran for the audiobook request, the source epub is removed and the mp3 and its folder
 * are kept. On main the browser lists only the mp3, and the import recycles the available audiobook
 * request and imports the mp3 into its library folder (and removes the source mp3).
 * Every value is recorded first (expect.soft + 278/<test>.json), so a run on main shows each miss.
 */

import { test, expect } from '@playwright/test';
import { evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, snap, writeEvidence, Rmab } from '../../lib/harness';
import { adminUserId, exists } from './library-delete-helpers';
import {
  ALL_OFF, AUTHOR, seedBook, withSettings, libraryFolder, libraryFiles, manualImportApi, organizeJobs,
  markJobs, waitOrganized, eventsSince, fmtEvents, bookRow, psql, sqlStr, sh, asApp, q,
} from './434-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });
test.use({ storageState: evidencePath('storage-state.json') });

const ASIN = 'B0E2E27801';
const TITLE = 'E2E Shared Folder Book';
const RUN = `run-${Date.now().toString(36)}`;
const ROOT = `/downloads/e2e-278/${RUN}`;
const SRC = `${ROOT}/Shared Folder [${ASIN}]`;

const sha = (file: string) => (exists(file) ? sh(`sha256sum ${q(file)} | cut -d' ' -f1`).trim() : '');
const requestRow = (id: string) =>
  JSON.parse(psql(`select json_build_object('status', status, 'type', type, 'progress', progress, 'updatedAt', updated_at, 'completedAt', completed_at, 'errorMessage', error_message)::text from requests where id = ${sqlStr(id)}`) || '{}');

function genMp3(dir: string, name: string, freq: number) {
  asApp(`mkdir -p ${q(dir)}\nffmpeg -nostdin -loglevel error -f lavfi -i sine=frequency=${freq}:duration=4 -c:a libmp3lame -b:a 64k -y ${q(`${dir}/${name}`)}`);
}

function genEpub(dir: string, name: string) {
  asApp(`mkdir -p ${q(dir)}\ni=0; while [ $i -lt 200 ]; do echo "generated ebook stand-in ${name}"; i=$((i+1)); done > ${q(`${dir}/${name}`)}`);
}

function save(name: string, value: unknown) {
  writeEvidence(`278/${name}.json`, { image: process.env.E2E_RMAB_IMAGE || '', run: RUN, ...(value as object) });
}

test.afterAll(() => {
  const errors: string[] = [];
  try {
    sh(`rm -rf ${q(ROOT.slice(0, ROOT.lastIndexOf('/')))}`);
    const folder = libraryFolder(ASIN);
    if (folder) sh(`rm -rf ${q(folder)}\nrmdir ${q(folder.slice(0, folder.lastIndexOf('/')))} 2>/dev/null || true`);
  } catch (error) {
    errors.push(`files: ${String(error)}`);
  }
  const reqs = `(select id from requests where audiobook_id in (select id from audiobooks where audible_asin = ${sqlStr(ASIN)}))`;
  try {
    psql(
      `begin;
       delete from job_events where job_id in (select id from jobs where request_id in ${reqs});
       delete from jobs where request_id in ${reqs};
       delete from download_history where request_id in ${reqs};
       update requests set parent_request_id = null where id in ${reqs};
       delete from requests where id in ${reqs};
       delete from audiobooks where audible_asin = ${sqlStr(ASIN)};
       delete from audible_cache where asin = ${sqlStr(ASIN)};
       commit;`
    );
  } catch (error) {
    errors.push(`rows: ${String(error).slice(0, 400)}`);
  }
  save('cleanup', { errors });
});

test('278: Manual Import from an ebook request imports the epub for the ebook request; the available audiobook is untouched', async ({ page }) => {
  const obs: Record<string, any> = { src: SRC };
  const rmab = await Rmab.loginAdmin();

  await withSettings({ ...ALL_OFF }, async () => {
    // The audiobook, delivered through the app's own import, then available (as after a library match)
    const bookId = seedBook(ASIN, TITLE);
    genMp3(`${ROOT}/seed`, 'Seed Track.mp3', 330);
    const seeded = await manualImportApi(rmab, { asin: ASIN, folderPath: `${ROOT}/seed`, cleanupSource: false });
    obs.seedImport = { status: seeded.status, body: seeded.body, organizeError: seeded.organizeError ?? null };
    expect(seeded.status, 'seed: audiobook manual import accepted').toBe(200);
    const audioReq: string = seeded.body.requestId;
    psql(`update requests set status = 'available', completed_at = now() where id = ${sqlStr(audioReq)}`);
    const L = libraryFolder(ASIN);
    expect(L, 'seed: library folder made').toBeTruthy();

    // A failed ebook request for the same book (reuse one the import may have made)
    const ebookReq =
      psql(`select id from requests where audiobook_id = ${sqlStr(bookId)} and type = 'ebook' and deleted_at is null order by created_at desc limit 1`) ||
      psql(
        `insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, parent_request_id, created_at, updated_at)
         values (gen_random_uuid(), ${sqlStr(adminUserId())}, ${sqlStr(bookId)}, 'ebook', 'failed', 0, 'e2e fixture: no ebook found', ${sqlStr(audioReq)}, now(), now()) returning id`
      ).split('\n')[0];
    psql(`update requests set status = 'failed', progress = 0 where id = ${sqlStr(ebookReq)}`);

    // The download folder: the audiobook's mp3 and the ebook
    genMp3(SRC, 'Book.mp3', 550);
    genEpub(SRC, 'Book.epub');
    const before = {
      audioRequest: requestRow(audioReq),
      ebookRequest: requestRow(ebookReq),
      book: bookRow(bookId),
      libraryFiles: libraryFiles(L),
      seedSha: sha(`${L}/Seed Track.mp3`),
      srcMp3Sha: sha(`${SRC}/Book.mp3`),
      srcEpubSha: sha(`${SRC}/Book.epub`),
    };
    Object.assign(obs, { L, audioReq, ebookReq, before });

    // UI: My Requests, the ebook card, its details modal, Manual Import
    await page.route(`**/api/audiobooks/${ASIN}`, (route) =>
      route.fulfill({ json: { success: true, audibleBaseUrl: 'https://www.audible.com', audiobook: { asin: ASIN, title: TITLE, author: AUTHOR, narrator: 'E2E Narrator', description: 'Generated test book.', coverArtUrl: '', durationMinutes: 1, genres: [] } } })
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/requests');
    const ebookCard = page.locator('div.shadow-md', { hasText: TITLE }).filter({ hasText: 'Ebook' }).first();
    await ebookCard.locator('[role="button"]').first().click();
    await page.getByTitle('Manual Import').click();
    await page.getByRole('button', { name: /\/downloads/ }).first().click();
    for (const seg of SRC.split('/').slice(2)) await page.getByRole('button', { name: seg, exact: true }).click();
    await page.waitForTimeout(800);
    const listed = async (name: string) => (await page.getByText(name, { exact: true }).count()) > 0;
    const footer = page.locator('p', { hasText: / file(s)? in this folder/ });
    obs.ui = {
      heading: (await page.locator('h2').filter({ hasText: /Manual/ }).first().innerText().catch(() => '')).trim(),
      epubListed: await listed('Book.epub'),
      mp3Listed: await listed('Book.mp3'),
      footer: (await footer.count()) ? (await footer.first().innerText()).trim() : null,
    };
    await snap(page, '278', 'browse-ebook-card');
    expect.soft(obs.ui.epubListed, 'the epub is listed').toBe(true);
    expect.soft(obs.ui.mp3Listed, 'the mp3 is not listed').toBe(false);
    expect.soft(obs.ui.footer, 'footer counts ebook files').toMatch(/^1 ebook file in this folder/);

    const mark = markJobs();
    await page.getByRole('button', { name: /Select This Folder/ }).click();
    await expect(page.getByRole('button', { name: 'Start Import' })).toBeVisible();
    const toggle = page.locator('div.p-4', { hasText: 'Cleanup source files' }).locator('input[type="checkbox"]');
    await toggle.check({ force: true });
    obs.ui.cleanupOn = await toggle.isChecked();
    await snap(page, '278', 'confirm-cleanup-on');
    const reqP = page.waitForRequest((r) => r.url().endsWith('/api/admin/manual-import') && r.method() === 'POST');
    const resP = page.waitForResponse((r) => r.url().endsWith('/api/admin/manual-import'));
    await page.getByRole('button', { name: 'Start Import' }).click();
    const [req, res] = await Promise.all([reqP, resP]);
    obs.sent = req.postDataJSON();
    obs.response = { status: res.status(), body: await res.json().catch(() => ({})) };
    if (res.ok()) await waitOrganized(mark, obs.response.body.requestId).catch((e) => (obs.organizeError = String(e)));
    await page.waitForTimeout(1500);
    await snap(page, '278', 'after-import');

    obs.organizeJobs = organizeJobs(mark).map((j) => ({ status: j.status, requestId: j.payload?.requestId, selectedFiles: j.payload?.selectedFiles ?? null, cleanupSource: j.payload?.cleanupSource ?? null }));
    obs.events = fmtEvents(eventsSince(mark)).split('\n').filter(Boolean);
    obs.after = {
      audioRequest: requestRow(audioReq),
      ebookRequest: requestRow(ebookReq),
      book: bookRow(bookId),
      libraryFiles: libraryFiles(L),
      seedSha: sha(`${L}/Seed Track.mp3`),
      libraryEpubSha: sha(`${L}/Book.epub`),
      libraryMp3Present: exists(`${L}/Book.mp3`),
      srcEpubPresent: exists(`${SRC}/Book.epub`),
      srcMp3Sha: sha(`${SRC}/Book.mp3`),
      srcFolderPresent: exists(SRC),
      libraryFolderPresent: exists(L),
    };
    save('result', obs);

    const a = obs.after;
    expect.soft(obs.sent?.requestId, 'the UI sends the ebook request').toBe(ebookReq);
    expect.soft(obs.sent?.requestType, 'the UI sends the ebook type').toBe('ebook');
    expect.soft(obs.sent?.selectedFiles, 'the UI sends the epub only').toEqual(['Book.epub']);
    expect.soft(obs.response.status, 'manual import accepted').toBe(200);
    expect.soft(obs.response.body?.requestId, 'the import runs on the ebook request').toBe(ebookReq);
    expect.soft(a.ebookRequest.status, 'the ebook request completes (downloaded)').toBe('downloaded');
    expect.soft(a.libraryEpubSha, 'the epub is in the book\'s library folder, same bytes').toBe(before.srcEpubSha);
    expect.soft(a.audioRequest, 'the available audiobook request is untouched').toEqual(before.audioRequest);
    expect.soft(obs.organizeJobs.map((j: any) => j.requestId), 'no organize job for the audiobook request').not.toContain(audioReq);
    expect.soft({ filePath: a.book.filePath, filesHash: a.book.filesHash, status: a.book.status }, 'the book row keeps its audiobook path and files hash')
      .toEqual({ filePath: before.book.filePath, filesHash: before.book.filesHash, status: before.book.status });
    expect.soft(a.seedSha, 'the audiobook\'s library file is unchanged').toBe(before.seedSha);
    expect.soft(a.libraryMp3Present, 'the source mp3 was not imported into the library').toBe(false);
    expect.soft([...a.libraryFiles].sort(), 'library folder: the audiobook files plus the epub').toEqual([...before.libraryFiles, 'Book.epub'].sort());
    expect.soft(a.srcEpubPresent, 'cleanup removed the source epub').toBe(false);
    expect.soft(a.srcMp3Sha, 'cleanup kept the source mp3').toBe(before.srcMp3Sha);
    expect.soft(a.srcFolderPresent, 'cleanup kept the source folder').toBe(true);
    expect.soft(a.libraryFolderPresent, 'the library folder is kept').toBe(true);
  });
});
