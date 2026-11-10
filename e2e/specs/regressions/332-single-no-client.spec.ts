/**
 * Component: E2E regression #332 (one failing release; no download client configured)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * 1. phm, scenario failed-download (one release the fake qBittorrent fails at 30%): the next search
 *    finds only the blocked release, so the request fails: 1 block, 1 grab, 2 request_error
 *    (the attempt message, then the final one).
 * 2. martian: the qBittorrent client is deleted while the download runs. The monitor fails the
 *    request "No qbittorrent client configured" (Bull retries may notify more than once), nothing is
 *    blocked, nothing else is grabbed.
 * 3. artemis: no client at all (the test deletes both itself). The search filters every result out by protocol, so the request
 *    waits in awaiting_search; nothing is grabbed or blocked.
 * Both clients are put back in afterAll (new ids; this spec runs on its own stack).
 */

import { test, expect } from '@playwright/test';
import { env, execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, waitFor, writeEvidence, Rmab } from '../../lib/harness';
import { blockedFor, grabCounts, historyOf, loadScenario, requestErrors, searchJobs, status } from './332-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const deleted: string[] = [];

test.afterAll(async () => {
  const rmab = await Rmab.loginAdmin();
  const restore = {
    'e2e-qbit': { type: 'qbittorrent', name: 'qBittorrent (fake)', url: 'http://fake-arr:8081', username: env('QBIT_USER'), password: env('QBIT_PASS'), disableSSLVerify: false, remotePathMappingEnabled: false, category: 'readmeabook' },
    'e2e-sab': { type: 'sabnzbd', name: 'SABnzbd (fake)', url: 'http://fake-arr:8085', password: env('SAB_API_KEY'), disableSSLVerify: false, remotePathMappingEnabled: false, category: 'readmeabook' },
  } as const;
  const results: Record<string, number> = {};
  for (const id of deleted) {
    const res = await rmab.raw('POST', '/api/admin/settings/download-clients', restore[id as keyof typeof restore]);
    results[id] = res.status;
  }
  writeEvidence('332/clients-restored.json', results);
});

test('#332: a book with one release that fails ends failed after one grab, with the attempt and the final notification', async () => {
  const loaded = await fakeArr.scenario('failed-download');
  expect(loaded.releases).toEqual(['broken']);
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();
  const id = (await rmab.requestBook(book)).request.id;

  const final = await waitFor('request failed', async () => (status(id).startsWith('failed|') ? status(id) : null), { timeoutMs: 300_000, intervalMs: 3_000 });
  const evidence = { id, final, grabs: await grabCounts(['broken']), blocked: blockedFor(id), history: historyOf(id), requestErrors: requestErrors(id), searchJobs: searchJobs(id) };
  writeEvidence('332/single-release.json', evidence);

  expect(final).toMatch(/^failed\|Download failed; no other release found: No usable releases .*all blocked$/);
  expect(evidence.blocked).toHaveLength(1);
  expect(evidence.grabs).toEqual({ broken: 1 });
  expect(evidence.requestErrors).toHaveLength(2);
  expect(evidence.requestErrors[0]).toMatch(/^Download failed in qBittorrent .*attempt 2 of 3/);
  expect(evidence.requestErrors[1]).toBe(final.slice('failed|'.length));
  expect(evidence.searchJobs[1]).toMatch(/^next-release-.* clientFailures=1$/);
});

test('#332: deleting the download client mid-download fails the request with the no-client message and blocks nothing', async () => {
  await loadScenario({
    name: '332-client-deleted',
    releases: [{ id: 'long', book: 'martian', title: '{{author}} - {{title}} (Unabridged) [M4B]', sizeMB: 310, seeders: 30, fixture: 'martian-m4b', download: { completeMs: 600_000 } }],
  });
  const book = (await fakeArr.books()).martian;
  const rmab = await Rmab.loginAdmin();
  const id = (await rmab.requestBook(book)).request.id;
  await waitFor('download running', async () => (status(id).startsWith('downloading|') && historyOf(id).length === 1 ? true : null), { timeoutMs: 180_000, intervalMs: 2_000 });

  const del = await rmab.raw('DELETE', '/api/admin/settings/download-clients/e2e-qbit');
  expect(del.status).toBe(200);
  deleted.push('e2e-qbit');

  const final = await waitFor('request failed', async () => (status(id).startsWith('failed|') ? status(id) : null), { timeoutMs: 180_000, intervalMs: 2_000 });
  await new Promise((r) => setTimeout(r, 20_000)); // let Bull's retries finish; nothing else may be grabbed
  const evidence = { id, final, grabs: await grabCounts(['long']), blocked: blockedFor(id), history: historyOf(id), requestErrors: requestErrors(id), searchJobs: searchJobs(id) };
  writeEvidence('332/client-deleted.json', evidence);

  expect(status(id)).toBe('failed|No qbittorrent client configured');
  expect(evidence.blocked).toEqual([]);
  expect(evidence.grabs).toEqual({ long: 1 });
  expect(evidence.searchJobs).toHaveLength(1);
  expect(evidence.requestErrors.length).toBeGreaterThan(0);
});

test('#332: with no download client at all nothing is grabbed or blocked', async () => {
  const rmab = await Rmab.loginAdmin();
  // Both clients, so the test stands on its own (an earlier test may already have deleted one)
  for (const clientId of ['e2e-qbit', 'e2e-sab']) {
    const del = await rmab.raw('DELETE', `/api/admin/settings/download-clients/${clientId}`);
    expect([200, 404], `delete ${clientId}`).toContain(del.status);
    if (del.status === 200 && !deleted.includes(clientId)) deleted.push(clientId);
  }
  await loadScenario({
    name: '332-no-client',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent' }, { id: 2, name: 'E2E Usenet', protocol: 'usenet' }],
    releases: [
      { id: 'tor', book: 'artemis', title: '{{author}} - {{title}} (Unabridged) [MP3]', sizeMB: 280, seeders: 20, fixture: 'artemis-mp3' },
      { id: 'nzb', book: 'artemis', protocol: 'usenet', indexerId: 2, title: '{{author}} - {{title}} (Unabridged) [MP3] [NZB]', sizeMB: 280, fixture: 'artemis-mp3' },
    ],
  });
  const book = (await fakeArr.books()).artemis;
  const id = (await rmab.requestBook(book)).request.id;

  const final = await waitFor('request settled', async () => (/^(awaiting_search|failed)\|/.test(status(id)) ? status(id) : null), { timeoutMs: 180_000, intervalMs: 2_000 });
  const evidence = { id, final, grabs: await grabCounts(['tor', 'nzb']), blocked: blockedFor(id), history: historyOf(id), requestErrors: requestErrors(id) };
  writeEvidence('332/no-client.json', evidence);

  expect(final).toMatch(/^awaiting_search\|No torrents\/nzbs found/);
  expect(evidence.grabs).toEqual({ tor: 0, nzb: 0 });
  expect(evidence.blocked).toEqual([]);
  expect(evidence.history).toEqual([]);
});
