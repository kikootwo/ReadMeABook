/**
 * Component: E2E regression #351 (media tools must not run through a shell)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Drives the real download + organize path: a multi-file mp3 release whose download FOLDER name (the
 * torrent/release name, attacker-controlled by the indexer) carries shell metacharacters. With chapter
 * merging on, every chapter path handed to ffprobe/ffmpeg contains that folder. If a media tool is
 * spawned through a shell, the embedded `$(...)` / backtick substitution runs and drops a sentinel file
 * (or, in a read-only cwd, prints a `touch` error) inside the rmab container.
 *
 * Fixed code (execFile/spawn argv arrays): no sentinel, no shell signature -> PASS.
 * Vulnerable code (promisified exec): sentinel or shell signature -> FAIL.
 * Needs the exec bridge (filesystem search + container logs): untainted runs only.
 */

import { test, expect, type Page } from '@playwright/test';
import { snap, env, writeEvidence, waitFor, fakeArr, ctl, Rmab, stackExecSync, stackLogsSync, execBridgeAvailable, EXEC_BRIDGE_SKIP } from '../../lib/harness';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const shot = (page: Page, name: string) => snap(page, 'sec-shell-exec', name);

// A shell evaluating the folder name runs `touch rmab_pwned_*`; in a read-only cwd that fails with
// this signature, which only a shell (never execFile argv) could produce.
const SHELL_EXEC_SIGNATURE = /touch:[^\n]*rmab_pwned/;

// Distinctive sentinel basenames (no '/': a path component cannot contain one).
const SENTINELS = ['rmab_pwned_dollar', 'rmab_pwned_tick'];

// Download folder name = attacker-controlled release name: command substitution, backticks, a single
// quote and spaces.
const PAYLOAD_FOLDER = 'RMAB $(touch ' + SENTINELS[0] + ') `touch ' + SENTINELS[1] + "` O'Brien";

function findSentinels(): string[] {
  const out = stackExecSync('rmab', ['sh', '-c', "find / -xdev -maxdepth 12 -name 'rmab_pwned_*' 2>/dev/null; true"]);
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

test('#351: media tools run without a shell; metacharacter paths do not execute during chapter merge', async ({ page }) => {
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();

  await test.step('enable chapter merging through the admin settings API', async () => {
    const settings = await rmab.get<{ paths: any }>('/api/admin/settings');
    const res = await rmab.raw('PUT', '/api/admin/settings/paths', { ...settings.paths, chapterMergingEnabled: true });
    expect(res.ok, `PUT settings/paths -> ${res.status}`).toBeTruthy();
    const after = await rmab.get<{ paths: any }>('/api/admin/settings');
    expect(after.paths.chapterMergingEnabled).toBe(true);
    writeEvidence('sec-shell-exec/settings-paths.json', after.paths);
  });

  await test.step('load a 3-file mp3 release whose download folder carries shell metacharacters', async () => {
    const definition = {
      name: 'sec-shell-exec',
      book: 'phm',
      indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
      releases: [
        {
          id: 'metachar',
          // Clean title so the ranker pairs it with the requested book; the torrent NAME (on-disk
          // download folder) is the hostile input.
          title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]',
          name: PAYLOAD_FOLDER,
          sizeMB: 420,
          seeders: 60,
          fixture: 'phm-mp3',
        },
      ],
    };
    const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition }) });
    const body = await res.json();
    expect(res.ok, `scenario load -> ${res.status} ${JSON.stringify(body)}`).toBeTruthy();
    expect(body.releases).toContain('metachar');
    writeEvidence('sec-shell-exec/scenario.json', { payloadFolder: PAYLOAD_FOLDER, sentinels: SENTINELS, result: body });
  });

  await test.step('no sentinel exists before the download (baseline)', async () => {
    const pre = findSentinels();
    writeEvidence('sec-shell-exec/sentinels-before.txt', pre.join('\n') || '(none)');
    expect(pre, 'sentinel present before the run: stale container state').toEqual([]);
  });

  await test.step('sign in and request the book from its search card', async () => {
    await page.goto('/login');
    await page.locator('#admin-username').fill(env('E2E_ADMIN_USER'));
    await page.locator('#admin-password').fill(env('E2E_ADMIN_PASSWORD'));
    await page.getByRole('button', { name: /^Login( as Admin)?$/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
    await page.goto('/search');
    await page.getByPlaceholder('Search by title, author, or narrator...').fill(book.title);
    const card = page.locator(`article[aria-label^="View details for ${book.title} by"]`).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await shot(page, '01-search-results');
    await card.hover();
    await card.getByRole('button', { name: 'Request', exact: true }).click();
    await shot(page, '02-requested');
  });

  const findMine = async () => {
    const body = await rmab.get<{ requests: any[] }>('/api/requests?limit=100');
    return body.requests.find((r) => r.audiobook?.title === book.title) || null;
  };
  writeEvidence('sec-shell-exec/request-created.json', await waitFor('request row', findMine, { timeoutMs: 30_000 }));

  await test.step('download completes and the organize / chapter-merge step runs', async () => {
    // A post-organize status means ffprobe already ran on the hostile paths (when a shell would fire).
    const done = await waitFor(
      'request organized (downloaded/available/failed)',
      async () => {
        const r = await findMine();
        return r && ['downloaded', 'available', 'failed', 'error'].includes(r.status) ? r : null;
      },
      { timeoutMs: 300_000, intervalMs: 3_000 }
    );
    writeEvidence('sec-shell-exec/request-after-organize.json', done);
    await page.goto('/requests');
    await shot(page, '03-requests-after-organize');
  });

  await test.step('the hostile download folder really exists on disk', async () => {
    const listing = stackExecSync('rmab', ['sh', '-c', 'ls -laR /downloads 2>/dev/null; true']);
    writeEvidence('sec-shell-exec/downloads-listing.txt', listing);
    expect(listing, 'payload folder not found under /downloads').toContain('$(touch');
  });

  await test.step('SECURITY: no shell interpreted the metacharacter path', async () => {
    const after = findSentinels();
    writeEvidence('sec-shell-exec/sentinels-after.txt', after.join('\n') || '(none)');
    const logs = stackLogsSync('rmab');
    writeEvidence('sec-shell-exec/rmab-logs.txt', logs);
    const shellHit = logs.match(SHELL_EXEC_SIGNATURE);
    writeEvidence('sec-shell-exec/shell-exec-signature.txt', shellHit ? shellHit[0] : '(not found: no shell executed)');
    // Either proof means a shell ran the substitution: (a) a sentinel file, (b) the `touch` error.
    expect(after, `shell command substitution executed; sentinel file(s): ${JSON.stringify(after)}`).toEqual([]);
    expect(shellHit, `shell executed the folder name: ${shellHit?.[0]}`).toBeNull();
  });

  await test.step('ffprobe read the literal metacharacter path (no probe failure)', async () => {
    const logs = stackLogsSync('rmab');
    expect(logs, 'ffprobe failed on the metacharacter path: it went through a shell').not.toContain('Failed to probe audio file');
    expect(logs, 'chapter analysis never probed the files').toContain('Sample filenames:');
  });
});
