/**
 * Component: E2E regression #298 (Prowlarr download links published on a proxy's address)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with `--overrides prowlarr-proxy-host`: fake Prowlarr builds its result links on
 * http://127.0.0.1:9696 (as a Prowlarr behind a Host-rewriting reverse proxy does), while RMAB is
 * configured with http://fake-arr:9696. Inside the RMAB container 127.0.0.1:9696 is nothing.
 * A: interactive pick from the admin requests table (martian). On main the pick is refused with
 * "Download URL must be a magnet link or a download link from the configured Prowlarr server".
 * B: automatic grab (phm, smoke releases). On main the grab goes to 127.0.0.1 and fails.
 * Fixed: both grabs reach fake Prowlarr at fake-arr:9696 and fake qBittorrent gets the torrent; RMAB
 * logs one "Prowlarr published download links on http://127.0.0.1:9696" line per search.
 * Values are read first and asserted with expect.soft, so a run on main still saves its evidence.
 * Exec bridge required (job log rows, RMAB container log).
 */

import { test, expect, type Page } from '@playwright/test';
import { ctl, env, evidencePath, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, keyLeaks, snap, stackLogsSync, waitFor, writeEvidence, Rmab, type Book, type Recorded } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });
test.use({ storageState: evidencePath('storage-state.json') });

const DIR = '298';
const PUBLISHED = 'http://127.0.0.1:9696';
const RELEASE = { id: 'good', title: '{{author}} - {{title}} [M4B]', fixture: 'martian-m4b', sizeMB: 300, seeders: 20 };
const LOG_LINE = `Prowlarr published download links on ${PUBLISHED}; using the configured address http://fake-arr:9696 instead`;

async function loadScenario(definition: Record<string, unknown>) {
  const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition }) });
  expect(res.ok, await res.clone().text()).toBe(true);
}

const statusOf = (id: string) => psql(`select coalesce(status,'') from requests where id = ${sqlStr(id)}`);
const grabsOf = (records: Recorded[], since: number) =>
  records.filter((r) => r.seq > since && r.service === 'prowlarr' && /^\/\d+\/download$/.test(r.path));
const qbitAdds = (records: Recorded[], since: number) =>
  records.filter((r) => r.seq > since && r.service === 'qbit' && r.path === '/api/v2/torrents/add' && (r.added?.length ?? 0) > 0);
const lastSeq = async () => (await fakeArr.requests()).reduce((max, r) => Math.max(max, r.seq), 0);
const rmabLogLines = () => stackLogsSync('rmab').split('\n').filter((l) => l.includes('Prowlarr published download links on'));

async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
}

test('#298 A: an interactive pick of a link published on the proxy address reaches the download client', async ({ page }) => {
  const book: Book = (await fakeArr.books()).martian;
  // Park the request in awaiting_search (every search fails), so only the pick can grab it
  await loadScenario({ name: 'search-all-fail-298', book: 'martian', search: { statuses: [400] }, releases: [RELEASE] });
  const rmab = await Rmab.loginAdmin();
  const requestId = (await rmab.requestBook(book)).request.id;
  await waitFor('request parked in awaiting_search', async () => statusOf(requestId) === 'awaiting_search', { timeoutMs: 180_000, intervalMs: 2_000 });
  await loadScenario({ name: 'proxy-host-298', book: 'martian', releases: [RELEASE] });
  const since = await lastSeq();

  await page.goto('/admin');
  await page.locator('tr', { hasText: book.title }).first().getByTitle('Actions').click();
  const searchP = page.waitForResponse((r) => r.url().endsWith(`/api/requests/${requestId}/interactive-search`), { timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Interactive Search' }).click();
  const search = await (await searchP).json();
  const published = (search.results ?? []).map((r: { downloadUrl?: string }) => new URL(String(r.downloadUrl)).origin);

  const title = `${book.author} - ${book.title} [M4B]`;
  await page.locator('div', { has: page.getByLabel(title, { exact: true }) }).getByRole('button', { name: 'Get' }).last().click();
  const pickP = page.waitForResponse((r) => r.url().endsWith(`/api/requests/${requestId}/select-torrent`), { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const pick = await pickP;
  const pickBody = await pick.json().catch(() => null);
  await page.waitForTimeout(500);
  await settled(page);
  await snap(page, DIR, 'pick');

  let add: Recorded | undefined;
  if (pick.ok()) {
    add = await waitFor('qBittorrent add after the pick', async () => qbitAdds(await fakeArr.requests(), since)[0], { timeoutMs: 60_000 }).catch(() => undefined);
  }
  const records = await fakeArr.requests();
  const grabs = grabsOf(records, since);
  const result = {
    requestId,
    published,
    pick: { status: pick.status(), body: pickBody },
    grabs: grabs.map((g) => ({ host: g.host, path: g.path, status: g.status, keyed: g.headers['x-api-key'] === env('PROWLARR_API_KEY') })),
    qbitAdded: add?.added,
    keyLeaks: keyLeaks(records, env('PROWLARR_API_KEY')).length,
    rmabLog: rmabLogLines(),
  };
  writeEvidence(`${DIR}/pick.json`, result);

  expect.soft(published).toEqual([PUBLISHED]);
  expect.soft(result.pick.status, JSON.stringify(pickBody)).toBe(200);
  expect.soft(result.grabs).toEqual([{ host: 'fake-arr:9696', path: '/1/download', status: 200, keyed: true }]);
  expect.soft(add?.added?.map((a) => a.releaseId)).toEqual(['good']);
  expect.soft(result.keyLeaks).toBe(0);
  expect.soft(result.rmabLog.some((l) => l.includes(LOG_LINE))).toBe(true);
  await expect(page.getByText('Download URL must be a magnet link')).toHaveCount(0);
});

test('#298 B: an automatic grab of a link published on the proxy address succeeds', async () => {
  await fakeArr.scenario('smoke');
  const book: Book = (await fakeArr.books()).phm;
  const since = await lastSeq();
  const rmab = await Rmab.loginAdmin();
  const requestId = (await rmab.requestBook(book)).request.id;

  const add = await waitFor('qBittorrent add from the automatic grab', async () => qbitAdds(await fakeArr.requests(), since)[0], { timeoutMs: 180_000, intervalMs: 2_000 })
    .catch(() => undefined);
  const records = await fakeArr.requests();
  const jobLog = psql(
    `select e.level || ' ' || e.context || ': ' || e.message from job_events e join jobs j on j.id = e.job_id
     where j.request_id = ${sqlStr(requestId)} and e.context = 'DownloadTorrent' order by e.created_at`
  ).split('\n').filter(Boolean);
  const result = {
    requestId,
    status: statusOf(requestId),
    grabs: grabsOf(records, since).map((g) => ({ host: g.host, path: g.path, status: g.status, keyed: g.headers['x-api-key'] === env('PROWLARR_API_KEY') })),
    qbitAdded: add?.added,
    keyLeaks: keyLeaks(records, env('PROWLARR_API_KEY')).length,
    jobLog,
    rmabLog: rmabLogLines(),
  };
  writeEvidence(`${DIR}/automatic.json`, result);
  writeEvidence(`${DIR}/automatic-job-log.txt`, `${jobLog.join('\n')}\n`);
  writeEvidence(`${DIR}/rmab-info-line.txt`, `${result.rmabLog.join('\n')}\n`);

  expect.soft(add?.added?.map((a) => a.releaseId)).toEqual(['good']);
  expect.soft(result.grabs.length).toBeGreaterThan(0);
  expect.soft(result.grabs.every((g) => g.host === 'fake-arr:9696' && g.keyed)).toBe(true);
  expect.soft(result.keyLeaks).toBe(0);
  expect.soft(jobLog.join('\n')).toContain('Trying release 1/');
  expect.soft(result.rmabLog.some((l) => l.includes(LOG_LINE))).toBe(true);
  expect(add, 'fake qBittorrent received the automatic grab').toBeDefined();
});
