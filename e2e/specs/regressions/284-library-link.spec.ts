/**
 * Component: E2E regression #284 (a delivered request links to its Audiobookshelf item by path or file hash)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run with: --offline-fixtures --overrides abs-fake-metadata (ABS gets fake Audible/Audnexus answers;
 * RMAB's own provider calls are CONNECT tunnels the fake refuses with 403, so no real metadata provider
 * is reached; every title is made up).
 * 1. A request for book martian (B082BHJMFF) runs for real: search, fake qBittorrent, organize → `downloaded`.
 * 2. The real Audiobookshelf scan adds RMAB's folder; a real ABS rematch through the fake metadata gives
 *    the item another ASIN (artemis, B072R1CY4P).
 * 3. ONE RMAB library scan. The request must be `available`, linked to that item, keep its own ASIN, and
 *    get one `request_available` notification. On main before the fix it matched by ASIN only and stayed
 *    `downloaded`. All schedules that could scan in between are disabled first.
 */

import { test, expect } from '@playwright/test';
import { Abs, authState, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, Rmab, stackExecSync, stackLogsSync, urls, waitFor, writeEvidence } from '../../lib/harness';
import { dbNow, markJobs, MEDIA, psql, sqlStr, waitOrganized } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const REQUESTED_ASIN = 'B082BHJMFF'; // martian
const LIBRARY_ASIN = 'B072R1CY4P'; // artemis
const SCHEDULES = ['plex_recently_added_check', 'plex_library_scan', 'audible_refresh'];
const SCAN_TYPES = `('scan_plex','plex_library_scan')`;
const FAKE_PROXY = 'http://fake-arr:9898';
/** Hosts the fake metadata proxy stands in for (mirrors e2e/fake-arr/src/metadata.js). */
const FAKED_HOST = /^(api\.audible\.(com|ca|co\.uk|com\.au|fr|de|co\.jp|it|in|es)|(www\.)?audible\.(com|ca|co\.uk|com\.au|fr|de|co\.jp|it|in|es)|api\.audnex\.us)$/;

type MetaRecord = { seq: number; service: string; host: string; path: string; status?: number; client?: string; method: string };

// psql() trims its output, so multi-column reads join with '|': an empty first column would shift a tab split.

const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

test('#284: a delivered request links to the ABS item holding its folder, whatever ASIN ABS gave it', async () => {
  test.setTimeout(1_200_000);

  // 0. Guards: the fake metadata proxy is active for ABS and RMAB, and fixtures are the offline (made-up) ones.
  for (const service of ['abs', 'rmab']) {
    expect(printenv(service, 'HTTPS_PROXY'), `${service} must run with --overrides abs-fake-metadata (never the real Audible)`).toBe(FAKE_PROXY);
  }
  const index = JSON.parse(stackExecSync('fake-arr', ['cat', '/fixtures/index.json']));
  const book = index.books.martian as { asin: string; title: string; author: string; narrator: string };
  expect(book.asin).toBe(REQUESTED_ASIN);
  expect(book.title, 'run with --offline-fixtures (made-up fixture titles)').toMatch(/^Fixture Book /);
  expect(index.books.artemis.asin).toBe(LIBRARY_ASIN);

  // 1. Disable every schedule that could scan between the delivery and our one scan; wait out the boot burst.
  const rmab = await Rmab.loginAdmin();
  const { jobs } = await rmab.get<{ jobs: { id: string; type: string }[] }>('/api/admin/jobs');
  for (const type of SCHEDULES) {
    const job = jobs.find((j) => j.type === type);
    expect(job, `scheduled job ${type}`).toBeTruthy();
    const res = await rmab.raw('PUT', `/api/admin/jobs/${job!.id}`, { enabled: false });
    expect(res.status, `disable ${type}`).toBe(200);
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
    const refreshStarts = (logs.match(/\[AudibleRefresh\] Starting Audible data refresh/g) || []).length;
    const refreshEnds = (logs.match(/\[AudibleRefresh\] (Cleanup complete|Error:)/g) || []).length;
    const scanStarts = (logs.match(/\[ScanLibrary\] Scanning library/g) || []).length;
    const scanEnds = (logs.match(/\[ScanLibrary\] (Matched \d+\/\d+ requests|Error:)/g) || []).length;
    return Date.now() - changedAt > 20_000 && refreshEnds >= refreshStarts && scanEnds >= scanStarts ? true : null;
  }, { timeoutMs: 420_000, intervalMs: 3_000 });
  const seq0 = Math.max(0, ...(await fakeArr.requests()).map((r) => r.seq));

  // 2. Deliver: one torrent release for martian; the request runs for real up to `downloaded`.
  const def = {
    name: 'library-link-284',
    description: 'One multi-file mp3 torrent for book martian (fixture martian-mp3, generated tones).',
    book: 'martian',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [{ id: 'good', title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]', sizeMB: 420, seeders: 60, fixture: 'martian-mp3' }],
  };
  const loaded = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  expect(loaded.status).toBe(200);
  const idx = await rmab.get<{ indexers: unknown[]; flagConfigs: unknown[] }>('/api/admin/settings/prowlarr/indexers');
  expect((await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers: idx.indexers, flagConfigs: idx.flagConfigs })).ok).toBe(true);

  const since = markJobs();
  const created = await rmab.requestBook((await fakeArr.books()).martian);
  const requestId = created.request.id;
  const delivered = await waitFor('request downloaded', async () => {
    const s = psql(`select status from requests where id = ${sqlStr(requestId)}`);
    return ['downloaded', 'available', 'failed'].includes(s) ? s : null;
  }, { timeoutMs: 420_000, intervalMs: 3_000 });
  await waitOrganized(since, requestId);
  expect(delivered, 'precondition: the request was delivered and waits for the library').toBe('downloaded');
  const [filePath, filesHash, audiobookId] = psql(
    `select concat_ws('|', coalesce(a.file_path,''), coalesce(a.files_hash,''), a.id) from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(requestId)}`
  ).split('|');
  writeEvidence('284/delivered.json', { requestId, audiobookId, filePath, filesHash });
  expect(filePath.startsWith(`${MEDIA}/`), 'precondition: RMAB recorded its folder').toBe(true);
  const rel = filePath.slice(MEDIA.length + 1);

  // 3. The real ABS scan adds RMAB's folder; the real ABS rematch gives it another ASIN.
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  const absScan = await fetch(`${urls.abs()}/api/libraries/${libraryId}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${abs.token}` } });
  expect(absScan.ok, 'ABS library scan').toBe(true);
  const item = await waitFor('ABS item for RMAB folder', async () =>
    (await abs.libraryItems(libraryId)).find((i) => String(i.relPath || '').replace(/\/+$/, '') === rel) || null,
  { timeoutMs: 180_000, intervalMs: 2_000 });
  const asinBefore = (await abs.req('GET', `/api/items/${item.id}`)).media?.metadata?.asin || '';
  const match = await abs.req('POST', `/api/items/${item.id}/match`, { provider: 'audible', asin: LIBRARY_ASIN, overrideDefaults: true, overrideDetails: true });
  const asinAfterMatch = (await abs.req('GET', `/api/items/${item.id}`)).media?.metadata?.asin || '';
  writeEvidence('284/abs-item.json', { id: item.id, path: item.path, relPath: item.relPath, asinBefore, asinAfterMatch, matchUpdated: match?.updated ?? null });
  expect(asinAfterMatch, 'precondition: the ABS item now holds another ASIN').toBe(LIBRARY_ASIN);

  // 4. ONE RMAB library scan.
  const t0 = dbNow();
  await rmab.triggerScheduledJob('plex_library_scan');
  const scanStatus = await waitFor('RMAB library scan finished', async () => {
    const s = psql(`select status from jobs where type in ${SCAN_TYPES} and created_at > ${sqlStr(t0)}::timestamp order by created_at desc limit 1`);
    return s === 'completed' || s === 'failed' ? s : null;
  }, { timeoutMs: 300_000, intervalMs: 2_000 });
  await new Promise((resolve) => setTimeout(resolve, 3_000)); // let the notification job row land

  // 5. Read everything first (so a run on main shows every value), then assert.
  const [status, absItemId, audibleAsin, title] = psql(
    `select concat_ws('|', r.status, coalesce(a.abs_item_id,''), coalesce(a.audible_asin,''), a.title) from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(requestId)}`
  ).split('|');
  const [libraryFilePath, libraryAsin] = psql(`select concat_ws('|', coalesce(file_path,''), coalesce(asin,'')) from plex_library where plex_guid = ${sqlStr(item.id)}`).split('|');
  const notifications = Number(psql(
    `select count(*) from jobs where type = 'send_notification' and payload->>'event' = 'request_available' and payload->>'requestId' = ${sqlStr(requestId)}`
  ));
  const scanRuns = Number(psql(`select count(*) from jobs where type in ${SCAN_TYPES} and created_at > ${sqlStr(t0)}::timestamp`));
  const recentRuns = Number(psql(`select count(*) from jobs where type = 'plex_recently_added_check' and created_at > ${sqlStr(t0)}::timestamp`));
  const linkLog = (stackLogsSync('rmab').match(/\[ScanLibrary\] Linked "[^"]*" to Audiobookshelf item \S+ by \w+/g) || []).slice(-1)[0] || '';
  const meta = ((await fakeArr.requests(seq0)) as unknown as MetaRecord[]).filter((r) => r.service === 'metadata');
  const absMeta = meta.filter((r) => r.client === 'abs').map((r) => `${r.method} ${r.host}${r.path} ${r.status}`);
  const rmabRefused = meta.filter((r) => r.client === 'rmab' && r.status === 403).map((r) => `${r.method} ${r.host}${r.path}`);
  const unfakedHosts = ((await fakeArr.requests(0)) as unknown as MetaRecord[])
    .filter((r) => r.service === 'metadata' && !FAKED_HOST.test(String(r.host || '').toLowerCase()))
    .map((r) => `${r.client} ${r.method} ${r.host}${r.path} ${r.status}`);

  writeEvidence('284/result.json', {
    requestId, absItemId: item.id, scanStatus, status, linkedAbsItemId: absItemId, audibleAsin, title,
    plexLibrary: { filePath: libraryFilePath, asin: libraryAsin }, notifications, scanRuns, recentRuns, linkLog,
    absMetadataCalls: absMeta, rmabRefusedMetadataCalls: rmabRefused, unfakedHosts,
  });
  writeEvidence('284/file-path.txt', `plex_library.file_path for ${item.id}: ${libraryFilePath || '(empty)'}\nRMAB folder: ${filePath}\n`);

  expect.soft(scanStatus, 'RMAB scan job').toBe('completed');
  expect.soft(scanRuns, 'exactly one library scan').toBe(1);
  expect.soft(recentRuns, 'no recently-added check ran in the window').toBe(0);
  expect.soft(libraryAsin, 'plex_library holds the ASIN ABS gave the item').toBe(LIBRARY_ASIN);
  expect.soft(libraryFilePath, 'plex_library.file_path filled from the ABS list (proves it returns path)').not.toBe('');
  expect.soft(absMeta.some((c) => c.includes(`api.audnex.us/books/${LIBRARY_ASIN} 200`)), 'ABS read the fake Audnexus book').toBe(true);
  expect.soft(unfakedHosts, 'every metadata proxy call in the run targeted a faked host').toEqual([]);
  expect.soft(absItemId, 'the book is linked to the ABS item').toBe(item.id);
  expect.soft(audibleAsin, 'the requested ASIN is kept').toBe(REQUESTED_ASIN);
  expect.soft(notifications, 'one request_available notification').toBe(1);
  expect(status, 'the delivered request is available').toBe('available');
});
