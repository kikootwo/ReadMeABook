/**
 * Component: E2E regression #216 (a processing request shows the chapter merge's progress)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * A real chapter merge (merge-progress: 9 min of 44.1 kHz stereo mp3, re-encoded to AAC) is held
 * by SIGSTOPping its ffmpeg and stepped forward with CONT/sleep/STOP in one container call. The
 * step window doubles while the stored percent does not move, until two rising non-zero values
 * are seen. After each move the real /requests card (1280 light and 375 dark, the page's own 5 s
 * poll) shows the stored percent and a bar of that width; the admin row shows "Merging chapters ·
 * N%" once. Released, the request ends downloaded/available at progress 100 with one merged m4b
 * over the merge's size floor (0.4 MB per minute). "Organizing files" lasts a moment, so its shot
 * is staged (psql), and so is a Downloaded card if the scan has already taken it to available.
 * Tagging off, merging on (both restored). Exec bridge required.
 */

import { test, expect, type Page } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, writeEvidence, type Book } from '../../lib/harness';
import { psql, q, sh, sqlStr } from './242-helpers';
import { setConfig } from './library-delete-helpers';
import { session } from './284-helpers';
import { heldPid, holdNextMerge, procState, release, step } from './216-merge-hold';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '216';
const INTERVAL_MS = 10_000; // the reporter's write interval (MERGE_PROGRESS_WRITE_INTERVAL_MS)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stored(id: string): { status: string; progress: number } {
  const [status, progress] = psql(`select status || '|' || progress from requests where id = ${sqlStr(id)}`).split('|');
  return { status, progress: Number(progress) };
}

function getConfig(key: string): string | null {
  return psql(`select count(*) from configuration where key = ${sqlStr(key)}`) === '0'
    ? null
    : psql(`select value from configuration where key = ${sqlStr(key)}`);
}

/**
 * The stored value once every write of the last run window has landed. ffmpeg is stopped, so it
 * reports nothing new: the only write left is a held-back value, written when the interval of the
 * last write ends, which is at most one interval after the window closed. A second read 2 s later
 * must agree (nothing moves while ffmpeg is held).
 */
async function quietProgress(id: string): Promise<{ status: string; progress: number }> {
  await sleep(INTERVAL_MS + 4_000);
  const value = stored(id);
  await sleep(2_000);
  expect(stored(id), 'nothing is written while ffmpeg is held').toEqual(value);
  return value;
}

/** The merge's first stored value: processing below 100 (written before ffmpeg starts). */
async function firstProgress(id: string): Promise<{ status: string; progress: number }> {
  const end = Date.now() + 60_000;
  for (let now = stored(id); !(now.status === 'processing' && now.progress < 100); now = stored(id)) {
    if (Date.now() > end) throw new Error(`the merge never wrote a first value (${now.status}|${now.progress})`);
    await sleep(500);
  }
  return quietProgress(id);
}

const card = (page: Page, title: string) =>
  page.locator('h3', { hasText: title }).locator('xpath=ancestor::div[contains(@class,"shadow-md")][1]');

/** The card shows "Merging chapters", the stored percent and a bar of that width. */
async function expectCardAt(page: Page, title: string, percent: number) {
  const c = card(page, title);
  const bar = c.getByRole('progressbar', { name: 'Progress' });
  await expect(bar).toHaveAttribute('aria-valuenow', String(percent), { timeout: 20_000 });
  await expect(c.getByText('Merging chapters', { exact: true })).toBeVisible();
  await expect(c.getByText(`${percent}%`, { exact: true })).toBeVisible();
  expect(await bar.locator('div').first().evaluate((el) => (el as HTMLElement).style.width)).toBe(`${percent}%`);
}

test('#216 the card and the admin row show the chapter merge moving', async ({ browser }) => {
  const started = Date.now();
  const out: Record<string, unknown> = {};
  const save = () => writeEvidence(`${DIR}/result.json`, out);
  const saved = (['chapter_merging_enabled', 'metadata_tagging_enabled'] as const).map((k) => [k, getConfig(k)] as const);
  let pid = '';
  try {
    setConfig('chapter_merging_enabled', 'true');
    setConfig('metadata_tagging_enabled', 'false');

    await fakeArr.scenario('merge-progress');
    const book: Book = (await fakeArr.books()).phm;
    const rmab = await Rmab.loginAdmin();
    holdNextMerge();
    const id = (await rmab.requestBook(book)).request.id;
    pid = await heldPid();
    out.requestId = id;
    out.heldAfterSeconds = Math.round((Date.now() - started) / 1000);

    const light = await session(browser, 1280, 900, false);
    const dark = await session(browser, 375, 812, true);
    await light.page.goto('/requests');
    await dark.page.goto('/requests');

    // Held at the start: the merge wrote its first value
    const first = await firstProgress(id);
    expect(first.status, 'held merge: the request is processing').toBe('processing');
    expect(first.progress, 'held merge: progress under 100').toBeLessThan(100);
    await expectCardAt(light.page, book.title, first.progress);
    await expectCardAt(dark.page, book.title, first.progress);

    // Step forward until two rising non-zero values are stored
    const seen: number[] = [];
    const steps: { windowMs: number; progress: number | null; status?: string }[] = [];
    let prev = first.progress;
    let windowMs = 150;
    for (let i = 0; seen.length < 2 && i < 14; i++) {
      step(pid, windowMs);
      const next = await quietProgress(id);
      steps.push({ windowMs, progress: next.progress, status: next.status });
      out.steps = steps;
      save();
      if (next.status === 'processing' && next.progress === prev) {
        windowMs = Math.min(windowMs * 2, 4000);
        continue;
      }
      expect(next.status, 'still processing (lengthen the fixture if a step finished the merge)').toBe('processing');
      expect(procState(pid), 'ffmpeg still held').toBe('T');
      expect(next.progress).toBeGreaterThan(prev);
      expect(next.progress).toBeLessThan(100);
      prev = next.progress;
      seen.push(prev);
      await expectCardAt(light.page, book.title, prev);
      await expectCardAt(dark.page, book.title, prev);

      if (seen.length === 1) {
        const admin = await session(browser, 1280, 900, false);
        await admin.page.goto('/admin');
        const row = admin.page.getByRole('row').filter({ hasText: book.title });
        await expect(row).toContainText(`Merging chapters · ${prev}%`, { timeout: 30_000 });
        await row.scrollIntoViewIfNeeded();
        await admin.settled(DIR, 'admin-row-merging-1280-light');
        await admin.ctx.close();
      }
    }
    out.seen = seen;
    expect(seen.length, 'two rising non-zero values stored').toBe(2);
    expect(seen[0]).toBeGreaterThan(0);
    await light.settled(DIR, 'card-merging-1280-light');
    await dark.settled(DIR, 'card-merging-375-dark');
    out.steppedSeconds = Math.round((Date.now() - started) / 1000);
    save();

    // Released: the merge finishes, progress is 100 again and the request moves on
    release(pid);
    pid = '';
    const after: string[] = [];
    let final = stored(id);
    for (const end = Date.now() + 300_000; !['downloaded', 'available'].includes(final.status) && Date.now() < end; ) {
      await sleep(1000);
      final = stored(id);
      const sample = `${final.status}|${final.progress}`;
      if (after[after.length - 1] !== sample) after.push(sample);
    }
    out.afterRelease = after;
    expect(['downloaded', 'available']).toContain(final.status);
    expect(final.progress).toBe(100);
    await expect(card(light.page, book.title).getByText('Merging chapters', { exact: true })).toHaveCount(0, { timeout: 20_000 });
    await expect(card(light.page, book.title).getByRole('progressbar')).toHaveCount(0);

    // One merged m4b, over the size floor the merge's final check uses (0.4 MB per minute)
    const folder = psql(`select a.file_path from audiobooks a join requests r on r.audiobook_id = a.id where r.id = ${sqlStr(id)}`);
    const files = sh(`find ${q(folder)} -maxdepth 1 -type f \\( -name '*.m4b' -o -name '*.mp3' \\) | sort`).split('\n').filter(Boolean);
    const probe = JSON.parse(sh(`ffprobe -v error -show_entries format=duration,size -of json ${q(files[0] ?? '/nonexistent')}`)).format;
    const mbPerMinute = Number(probe.size) / 1024 / 1024 / (Number(probe.duration) / 60);
    out.merged = { folder, files, size: Number(probe.size), durationSeconds: Number(probe.duration), mbPerMinute: Number(mbPerMinute.toFixed(3)) };
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.m4b$/);
    expect(Number(probe.duration)).toBeGreaterThan(530);
    expect(mbPerMinute).toBeGreaterThanOrEqual(0.4);

    // Staged: "Organizing files" (processing at 100, not completed yet) lasts a moment in a real run
    const completedAt = psql(`select completed_at from requests where id = ${sqlStr(id)}`);
    psql(`update requests set status = 'processing', progress = 100, completed_at = null, updated_at = now() where id = ${sqlStr(id)}`);
    await light.page.reload();
    await expect(card(light.page, book.title).getByText('Organizing files', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(card(light.page, book.title).getByRole('progressbar')).toHaveCount(0);
    await light.settled(DIR, 'organizing-files-STAGED-1280-light');

    // A Downloaded card is unchanged: no phase line, no bar (staged when the scan already made it available)
    const downloadedStaged = final.status !== 'downloaded';
    psql(`update requests set status = 'downloaded', progress = 100, completed_at = ${completedAt ? sqlStr(completedAt) : 'null'}, updated_at = now() where id = ${sqlStr(id)}`);
    await light.page.reload();
    const c = card(light.page, book.title);
    await expect(c.getByText('Downloaded', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(c.getByText(/Organizing files|Merging chapters|library scan/)).toHaveCount(0);
    await expect(c.getByRole('progressbar')).toHaveCount(0);
    await light.settled(DIR, downloadedStaged ? 'downloaded-card-STAGED-1280-light' : 'downloaded-card-1280-light');
    psql(`update requests set status = ${sqlStr(final.status)}, progress = 100, updated_at = now() where id = ${sqlStr(id)}`);

    await light.ctx.close();
    await dark.ctx.close();
    out.totalSeconds = Math.round((Date.now() - started) / 1000);
    save();
  } finally {
    if (pid) release(pid);
    for (const [key, value] of saved) setConfig(key, value);
    save();
  }
});
