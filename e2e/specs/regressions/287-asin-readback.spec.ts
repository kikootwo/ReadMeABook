/**
 * Component: E2E regression #287 (the ASIN from the Audiobookshelf match is stored in the same scan)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata (ABS gets fake Audible/Audnexus answers;
 * RMAB's own provider calls are CONNECT tunnels the fake refuses with 403, so no real metadata provider
 * is reached; every title and summary is made up).
 * A book folder with no ASIN goes into the library; the real Audiobookshelf scan adds it; ONE RMAB
 * library scan triggers ABS's match (fuzzy, through the fake catalog). A request for that ASIN must
 * then be refused as already owned (409 AlreadyAvailable) without a second scan. On main before the
 * fix RMAB discarded the match response, so plex_library had no ASIN and the request got 201.
 * All schedules that could scan or read the ASIN in between are disabled first.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackExecSync, stackLogsSync, urls, waitFor, writeEvidence } from '../../lib/harness';
import { dbNow, MEDIA, PGID, PUID, psql, q, sh, sqlStr } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const FIXTURE = 'martian-mp3';
const SCHEDULES = ['plex_recently_added_check', 'plex_library_scan', 'audible_refresh'];
const SCAN_TYPES = `('scan_plex','plex_library_scan')`;
const FAKE_PROXY = 'http://fake-arr:9898';
/** Hosts the fake metadata proxy stands in for (mirrors e2e/fake-arr/src/metadata.js). */
const FAKED_HOST = /^(api\.audible\.(com|ca|co\.uk|com\.au|fr|de|co\.jp|it|in|es)|(www\.)?audible\.(com|ca|co\.uk|com\.au|fr|de|co\.jp|it|in|es)|api\.audnex\.us)$/;

type MetaRecord = { seq: number; service: string; host: string; path: string; status?: number; client?: string; method: string };

const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

test('#287: a library item matched by ABS during one scan is refused as already owned', async () => {
  test.setTimeout(900_000);

  // 0. Guards: the fake metadata proxy is active for ABS and RMAB, and fixtures are the offline (made-up) ones.
  for (const service of ['abs', 'rmab']) {
    expect(printenv(service, 'HTTPS_PROXY'), `${service} must run with --overrides abs-fake-metadata (never the real Audible)`).toBe(FAKE_PROXY);
  }
  const index = JSON.parse(stackExecSync('fake-arr', ['cat', '/fixtures/index.json']));
  const fx = index.fixtures[FIXTURE];
  const book = index.books[fx.book] as { asin: string; title: string; author: string; narrator: string };
  expect(book.title, 'run with --offline-fixtures (made-up fixture titles)').toMatch(/^Fixture Book /);

  // No releases: on main the accepted request must not start a download.
  const loaded = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: { name: 'empty-287', releases: [] } }) });
  expect(loaded.status).toBe(200);

  // 1. Disable every schedule that could scan or read the ASIN between our one scan and the request.
  const rmab = await Rmab.loginAdmin();
  const { jobs } = await rmab.get<{ jobs: { id: string; type: string; enabled: boolean }[] }>('/api/admin/jobs');
  for (const type of SCHEDULES) {
    const job = jobs.find((j) => j.type === type);
    expect(job, `scheduled job ${type}`).toBeTruthy();
    const res = await rmab.raw('PUT', `/api/admin/jobs/${job!.id}`, { enabled: false });
    expect(res.status, `disable ${type}`).toBe(200);
  }
  // At boot RMAB staggers "overdue" triggers from a list read before our disable, so a disabled scan
  // or Audible refresh can still fire once. Let that burst finish before the window opens.
  let lastOverdue = -1;
  let changedAt = Date.now();
  await waitFor('RMAB startup jobs settled', async () => {
    const logs = stackLogsSync('rmab');
    const overdue = (logs.match(/is overdue, triggering now/g) || []).length;
    if (overdue !== lastOverdue) {
      lastOverdue = overdue;
      changedAt = Date.now();
    }
    const refreshStarts = (logs.match(/\[AudibleRefresh\] Starting Audible data refresh/g) || []).length;
    const refreshEnds = (logs.match(/\[AudibleRefresh\] (Cleanup complete|Error:)/g) || []).length;
    const scanStarts = (logs.match(/\[ScanLibrary\] Scanning library/g) || []).length;
    const scanEnds = (logs.match(/\[ScanLibrary\] (Matched \d+\/\d+ requests|Error:)/g) || []).length;
    return Date.now() - changedAt > 20_000 && refreshEnds >= refreshStarts && scanEnds >= scanStarts ? true : null;
  }, { timeoutMs: 420_000, intervalMs: 3_000 });
  const t0 = dbNow();
  const seq0 = Math.max(0, ...(await fakeArr.requests()).map((r) => r.seq));

  // 2. A book folder with no ASIN (not in tags, not in the folder name).
  const authorDir = `${MEDIA}/${book.author}`;
  const dest = `${authorDir}/${fx.folder}`;
  sh(`mkdir -p ${q(dest)}\ncp -r /fixtures/${FIXTURE}/. ${q(dest)}/\nchown -R ${PUID}:${PGID} ${q(authorDir)}`, { service: 'fake-arr' });

  // 3. The real Audiobookshelf scan adds it, still without an ASIN.
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  const scan = await fetch(`${urls.abs()}/api/libraries/${libraryId}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${abs.token}` } });
  expect(scan.ok, 'ABS library scan').toBe(true);
  const item = await waitFor('ABS item for the new folder', async () =>
    (await abs.libraryItems(libraryId)).find((i) => String(i.relPath || i.path || '').endsWith(fx.folder)) || null,
  { timeoutMs: 120_000, intervalMs: 2_000 });
  const asinBefore = (await abs.req('GET', `/api/items/${item.id}`)).media?.metadata?.asin || '';
  writeEvidence('287/abs-item-before.json', { id: item.id, title: item.media?.metadata?.title, asin: asinBefore });
  expect(asinBefore, 'precondition: the ABS item has no ASIN').toBe('');

  // 4. ONE RMAB library scan (it triggers the ABS match for items without an ASIN).
  await rmab.triggerScheduledJob('plex_library_scan');
  const scanStatus = await waitFor('RMAB library scan finished', async () => {
    const s = psql(`select status from jobs where type in ${SCAN_TYPES} and created_at > ${sqlStr(t0)}::timestamp order by created_at desc limit 1`);
    return s === 'completed' || s === 'failed' ? s : null;
  }, { timeoutMs: 300_000, intervalMs: 2_000 });

  // 5. Read everything first (so a run on main shows every value), then assert.
  const asinAfter = (await abs.req('GET', `/api/items/${item.id}`)).media?.metadata?.asin || '';
  const libraryAsin = psql(`select coalesce(asin,'') from plex_library where plex_guid = ${sqlStr(item.id)}`);
  const scanRuns = Number(psql(`select count(*) from jobs where type in ${SCAN_TYPES} and created_at > ${sqlStr(t0)}::timestamp`));
  const recentRuns = Number(psql(`select count(*) from jobs where type = 'plex_recently_added_check' and created_at > ${sqlStr(t0)}::timestamp`));
  const meta = ((await fakeArr.requests(seq0)) as unknown as MetaRecord[]).filter((r) => r.service === 'metadata');
  const absMeta = meta.filter((r) => r.client === 'abs').map((r) => `${r.method} ${r.host}${r.path} ${r.status}`);

  // 6. The request check in the same window.
  const res = await rmab.raw('POST', '/api/requests', { audiobook: { asin: book.asin, title: book.title, author: book.author, narrator: book.narrator } });
  const body = await res.json().catch(() => null);
  const requestRows = Number(psql(`select count(*) from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin = ${sqlStr(book.asin)} and r.deleted_at is null`));
  const metaAll = ((await fakeArr.requests(seq0)) as unknown as MetaRecord[]).filter((r) => r.service === 'metadata');
  const forbidden = metaAll.filter((r) => r.status === 403).map((r) => `${r.client} ${r.method} ${r.host}${r.path}`);
  // Every proxied call of the whole run (boot included), not just this window, went to a faked host.
  const unfakedHosts = ((await fakeArr.requests(0)) as unknown as MetaRecord[])
    .filter((r) => r.service === 'metadata' && !FAKED_HOST.test(String(r.host || '').toLowerCase()))
    .map((r) => `${r.client} ${r.method} ${r.host}${r.path} ${r.status}`);

  writeEvidence('287/result.json', {
    book, absItemId: item.id, scanStatus, asinBefore, asinAfter, libraryAsin, scanRuns, recentRuns,
    absMetadataCalls: absMeta, forbiddenMetadataCalls: forbidden, unfakedHosts,
    metadataCalls: metaAll.map((r) => `${r.client} ${r.method} ${r.host}${r.path} ${r.status}`),
    request: { status: res.status, body }, requestRows,
  });

  expect.soft(scanStatus, 'RMAB scan job').toBe('completed');
  expect.soft(asinAfter, 'ABS matched the item through the fake catalog').toBe(book.asin);
  expect.soft(absMeta.some((c) => c.includes('/1.0/catalog/products 200')), 'ABS searched the fake Audible catalog').toBe(true);
  expect.soft(absMeta.some((c) => c.includes(`api.audnex.us/books/${book.asin} 200`)), 'ABS read the fake Audnexus book').toBe(true);
  expect.soft(forbidden, 'no metadata call left the fake providers').toEqual([]);
  expect.soft(unfakedHosts, 'every metadata proxy call in the run targeted a faked host').toEqual([]);
  expect.soft(scanRuns, 'exactly one library scan').toBe(1);
  expect.soft(recentRuns, 'no recently-added check ran in the window').toBe(0);
  expect.soft(libraryAsin, 'plex_library has the matched ASIN after ONE scan').toBe(book.asin);
  expect(res.status, 'request for an owned book is refused').toBe(409);
  expect(body?.error).toBe('AlreadyAvailable');
  expect(requestRows, 'no request row was created').toBe(0);
});
