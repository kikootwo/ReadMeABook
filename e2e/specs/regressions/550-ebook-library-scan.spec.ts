/**
 * Component: E2E regression #550 (an ebook import scans its own Audiobookshelf library)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Audiobookshelf backend (default flags), real Audiobookshelf with its filesystem watcher off.
 * Layout as a user with separate libraries has it: media_dir /media, audiobook template
 * audiobooks/{author}/{title} (ABS library "Audiobooks" at /media/audiobooks), ebook template
 * ebooks/{author}/{title} (a second ABS library "Ebooks" at /media/ebooks). Scan after import on.
 *   A. ebook library set: an ebook import scans the ebook library; the item appears there with
 *      no other scan.
 *   B. an audiobook import still scans the audiobook library (item appears there).
 *   C. setting saved empty: an ebook import scans the audiobook library (as before); the ebook
 *      library never sees the item.
 *   D. key absent (an upgrade): same as C.
 *   UI: the Library tab, scan on / scan off / libraries not loaded / unknown saved id, at
 *   1280 and 375, light and dark (550/settings-*.jpg).
 * Settings are changed over the real save route; the app's config cache holds a value up to
 * 60 s in the job runner, so each change waits that out. Paths are restored at the end.
 */

import fs from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { Abs, authState, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, snap, waitFor } from '../../lib/harness';
import { PUID, PGID, sh, asApp, q, psql, setConfig, newBook, genAudio, importAudio, importEbook, eventsSince, fmtEvents, exists, type Case } from './library-delete-helpers';
import { markJobs } from './242-helpers';
import { epubBytes } from './550-epub';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const SRC = '/downloads/manual/e2e-550';
const EBOOK_ROOT = '/media/ebooks';
const CACHE_WAIT_MS = 62_000;
const PATH_KEYS = ['media_dir', 'audiobook_path_template', 'ebook_path_template'];
const VIEWS = [
  { name: '1280-light', width: 1280, height: 900, dark: false },
  { name: '1280-dark', width: 1280, height: 900, dark: true },
  { name: '375-light', width: 375, height: 812, dark: false },
  { name: '375-dark', width: 375, height: 812, dark: true },
];

/** Check recorder; evidence under <evidence>/550/<case>/. */
class Rec {
  readonly checks: { name: string; kind: string; ok: boolean; detail?: string }[] = [];
  constructor(readonly id: string) {}
  save(name: string, content: unknown) {
    fs.writeFileSync(evidencePath(`550/${this.id}`, name), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  check(name: string, ok: boolean, kind = 'safety', detail?: string) {
    this.checks.push({ name, kind, ok, detail });
  }
  finish(): string[] {
    const failed = this.checks.filter((c) => !c.ok);
    this.save('result.json', { case: this.id, image: process.env.E2E_RMAB_IMAGE || '', result: failed.length ? 'FAIL' : 'PASS', checks: this.checks });
    return failed.map((f) => `${f.kind}: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
}
const asCase = (r: Rec) => r as unknown as Case;

let rmab: Rmab;
let abs: Abs;
let audioLib: string;
let ebookLib: string;
const savedPaths: Record<string, string | null> = {};
let watcherOff: unknown;

/** A small valid EPUB (built in the runner), owned by the app user. */
function genEpub(dir: string, name: string, title: string) {
  asApp(`mkdir -p ${q(dir)}
echo ${epubBytes(title).toString('base64')} | base64 -d > ${q(`${dir}/${name}`)}`);
}

async function absSettings() {
  return (await rmab.get<{ audiobookshelf: { serverUrl: string; apiToken: string; libraryId: string; ebookLibraryId: string; triggerScanAfterImport: boolean } }>('/api/admin/settings')).audiobookshelf;
}

/** PUT /api/admin/settings/audiobookshelf as the Library tab saves it (masked token, same URL). */
async function saveAbs(r: Rec, changes: Record<string, unknown>, label: string) {
  const current = await absSettings();
  const res = await rmab.raw('PUT', '/api/admin/settings/audiobookshelf', { ...current, ...changes });
  r.check(`${label}: settings saved (HTTP ${res.status})`, res.status === 200, 'control', await res.text());
}

async function itemIn(libraryId: string, folder: string) {
  return (await abs.libraryItems(libraryId)).find((i) => i.path === folder) || null;
}

/** Wait for the ABS item at `folder` in `libraryId` without asking ABS to scan. */
async function appears(libraryId: string, folder: string, timeoutMs = 90_000) {
  return waitFor(`ABS item ${folder}`, () => itemIn(libraryId, folder), { timeoutMs, intervalMs: 3_000 }).catch(() => null);
}

const SCAN_PREFIX = 'Triggered audiobookshelf filesystem scan for library ';
/** The library ids the post-import scan logged it scanned. */
const scanLines = (events: { message: string }[]) =>
  events.filter((e) => e.message.includes(SCAN_PREFIX)).map((e) => e.message.slice(e.message.indexOf(SCAN_PREFIX) + SCAN_PREFIX.length).trim());

/** Ebook request for a new book, organized by the app's own job; returns the scan lines it logged. */
async function ebookImport(r: Rec, key: string, title: string, author: string) {
  const bookId = newBook(title, author, `B0E550${key}01`);
  genEpub(`${SRC}/${key}`, 'Book.epub', title);
  const mark = markJobs();
  await importEbook(asCase(r), bookId, `${SRC}/${key}`, `ebook-${key}`);
  const events = eventsSince(mark);
  r.save(`events-${key}.log`, `${fmtEvents(events)}\n`);
  const folder = `${EBOOK_ROOT}/${author}/${title}`;
  r.check(`${key}: the epub landed in the ebook folder (${folder})`, exists(`${folder}/Book.epub`), 'control');
  return { folder, scans: scanLines(events) };
}


test.beforeAll(async () => {
  rmab = await Rmab.loginAdmin();
  abs = await Abs.login();
  audioLib = authState().absLibraryId;
  for (const key of PATH_KEYS) savedPaths[key] = psql(`select value from configuration where key = '${key}'`) || null;
  sh(`mkdir -p ${q(SRC)} ${q(EBOOK_ROOT)}\nchown ${PUID}:${PGID} /downloads/manual ${q(SRC)} ${q(EBOOK_ROOT)}`);
  setConfig('media_dir', '/media');
  setConfig('audiobook_path_template', 'audiobooks/{author}/{title}');
  setConfig('ebook_path_template', 'ebooks/{author}/{title}');
  const patched = await abs.req<{ serverSettings?: { scannerDisableWatcher?: boolean } }>('PATCH', '/api/settings', { scannerDisableWatcher: true });
  watcherOff = patched.serverSettings?.scannerDisableWatcher;
  const libs = await abs.req<{ libraries: { id: string; folders: { fullPath: string }[] }[] }>('GET', '/api/libraries');
  const existing = libs.libraries.find((l) => l.folders.some((f) => f.fullPath === EBOOK_ROOT));
  ebookLib = existing?.id || (await abs.req<{ id: string }>('POST', '/api/libraries', {
    name: 'Ebooks', folders: [{ fullPath: EBOOK_ROOT }], icon: 'books', mediaType: 'book', provider: 'audible', settings: { disableWatcher: true },
  })).id;
});

test.afterAll(() => {
  for (const key of PATH_KEYS) setConfig(key, savedPaths[key]);
});

test('550 A-D: each import scans the library its files landed in', async () => {
  test.setTimeout(900_000);
  const r = new Rec('scan-target');
  r.save('abs-setup.json', { audioLib, ebookLib, scannerDisableWatcher: watcherOff });
  r.check('ABS watcher is off', watcherOff === true, 'control');

  // A non-string ebook library is refused over HTTP, nothing written
  const bad = await rmab.raw('PUT', '/api/admin/settings/audiobookshelf', { ...(await absSettings()), ebookLibraryId: 42 });
  r.check(`a number for ebookLibraryId answers 400 (HTTP ${bad.status})`, bad.status === 400, 'safety');

  // A. ebook library set
  await saveAbs(r, { libraryId: audioLib, ebookLibraryId: ` ${ebookLib} `, triggerScanAfterImport: true }, 'A');
  const savedA = await absSettings();
  r.check(`A: GET returns the trimmed ebook library (${savedA.ebookLibraryId})`, savedA.ebookLibraryId === ebookLib, 'control');
  await new Promise((res) => setTimeout(res, CACHE_WAIT_MS));
  const a = await ebookImport(r, 'A', 'Scan Ebook Alpha', 'Scan Author Alpha');
  r.check(`A: the ebook import scanned the ebook library only (${a.scans.join(' | ')})`, a.scans.length === 1 && a.scans[0] === ebookLib, 'safety');
  const itemA = await appears(ebookLib, a.folder);
  r.check(`A: the item appeared in the ebook library (${itemA?.id})`, !!itemA, 'safety');
  r.save('item-A.json', itemA);

  // B. an audiobook import still scans the audiobook library
  const bookB = newBook('Scan Audio Bravo', 'Scan Author Bravo', 'B0E550B001');
  genAudio(`${SRC}/B`, ['Book.m4b']);
  const markB = markJobs();
  await importAudio(asCase(r), rmab, bookB, `${SRC}/B`, 'audio-B');
  const scansB = scanLines(eventsSince(markB));
  r.check(`B: the audiobook import scanned the audiobook library only (${scansB.join(' | ')})`, scansB.length === 1 && scansB[0] === audioLib, 'safety');
  const itemB = await appears(audioLib, '/media/audiobooks/Scan Author Bravo/Scan Audio Bravo');
  r.check(`B: the item appeared in the audiobook library (${itemB?.id})`, !!itemB, 'safety');

  // C. saved empty: the audiobook library, as before
  await saveAbs(r, { ebookLibraryId: '' }, 'C');
  r.check('C: GET returns an empty ebook library', (await absSettings()).ebookLibraryId === '', 'control');
  await new Promise((res) => setTimeout(res, CACHE_WAIT_MS));
  const c = await ebookImport(r, 'C', 'Scan Ebook Charlie', 'Scan Author Charlie');
  r.check(`C: the ebook import scanned the audiobook library (${c.scans.join(' | ')})`, c.scans.length === 1 && c.scans[0] === audioLib, 'safety');
  const itemC = await appears(ebookLib, c.folder, 30_000);
  r.check('C: the ebook library never saw the item (watcher off, nothing scanned it)', itemC === null, 'control');

  // D. key absent (installs from before the setting): same as C
  setConfig('audiobookshelf.ebook_library_id', null);
  r.check('D: GET returns an empty ebook library', (await absSettings()).ebookLibraryId === '', 'control');
  await new Promise((res) => setTimeout(res, CACHE_WAIT_MS));
  const d = await ebookImport(r, 'D', 'Scan Ebook Delta', 'Scan Author Delta');
  r.check(`D: the ebook import scanned the audiobook library (${d.scans.join(' | ')})`, d.scans.length === 1 && d.scans[0] === audioLib, 'safety');

  expect(r.finish()).toEqual([]);
});

async function view(browser: Browser, v: (typeof VIEWS)[number]): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: v.width, height: v.height },
    colorScheme: v.dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  const page = await ctx.newPage();
  await page.goto('/admin/settings');
  await expect(page.getByText('Trigger library scan after import')).toBeVisible({ timeout: 30_000 });
  return page;
}

async function shot(page: Page, name: string) {
  // The Ebook Library block when shown, else the scan toggle, in the middle of the viewport
  const ebook = page.getByText('Ebook Library', { exact: true });
  const target = (await ebook.count()) > 0 ? ebook : page.getByText('Trigger library scan after import');
  await target.first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
  await snap(page, '550', name);
}

async function testConnection(page: Page) {
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByText(/Connected to Audiobookshelf/).first()).toBeVisible({ timeout: 30_000 });
}

test('550 UI: the Ebook Library control in each state', async ({ browser }) => {
  test.setTimeout(300_000);
  const r = new Rec('settings-ui');
  await saveAbs(r, { libraryId: audioLib, ebookLibraryId: ebookLib, triggerScanAfterImport: true }, 'ui');
  for (const v of VIEWS) {
    const page = await view(browser, v);
    // Libraries are not loaded until Test Connection
    r.check(`${v.name}: fallback text before Test Connection`, (await page.getByText('Test your connection to load libraries.').count()) === 2, 'control');
    await shot(page, `settings-no-libraries-${v.name}`);
    await testConnection(page);
    const select = page.getByLabel('Ebook Library', { exact: true });
    r.check(`${v.name}: the saved ebook library is selected by name`, (await select.locator('option:checked').textContent()) === 'Ebooks', 'control');
    await shot(page, `settings-scan-on-${v.name}`);
    await page.getByRole('checkbox', { name: /Trigger library scan after import/ }).uncheck();
    r.check(`${v.name}: hidden with the scan off`, (await page.getByLabel('Ebook Library', { exact: true }).count()) === 0, 'control');
    await shot(page, `settings-scan-off-${v.name}`);
    await page.context().close();
  }
  await saveAbs(r, { ebookLibraryId: 'lib-gone-550' }, 'unknown');
  for (const v of VIEWS) {
    const page = await view(browser, v);
    await testConnection(page);
    const label = await page.getByLabel('Ebook Library', { exact: true }).locator('option:checked').textContent();
    r.check(`${v.name}: a stale id shows as unknown (${label})`, label === 'Unknown library (lib-gone-550)', 'safety');
    await shot(page, `settings-unknown-id-${v.name}`);
    await page.context().close();
  }
  await saveAbs(r, { ebookLibraryId: '' }, 'reset');
  expect(r.finish()).toEqual([]);
});
