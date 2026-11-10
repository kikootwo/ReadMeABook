/**
 * Component: E2E regression #332 (a failed download tries the next-ranked release before the request fails)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Real fake-client failures (fake qBittorrent `error`, fake SABnzbd `Failed` "Out of retention") on
 * automatic grabs. Each test uses its own fixture book and an inline scenario; releases get distinct
 * titles (the blocklist matches normalized names) and are ranked by seeders (usenet scores as full).
 * 1. phm: A fails, B completes, C never grabbed.
 * 2. artemis: A, B, C fail; D never grabbed; the request fails after 3 in a row.
 * 3. martian: A on SABnzbd fails, B on qBittorrent completes.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, waitFor, writeEvidence, Rmab } from '../../lib/harness';
import { blockedFor, grabCounts, historyOf, loadScenario, requestErrors, searchJobs, selectedReleases, status } from './332-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const torrent = (id: string, book: string, tag: string, seeders: number, fixture: string, sizeMB: number, download: Record<string, number>) => ({
  id, book, title: `{{author}} - {{title}} (Unabridged) [M4B] [${tag}]`, sizeMB, seeders, fixture, download,
});
const FAIL = { completeMs: 6000, failAtPct: 30 };
const OK = { completeMs: 6000 };
const settled = (s: string) => /^(failed|downloaded|available|awaiting_search|warn)\|/.test(s);

test('#332: the first release fails in qBittorrent, the second-ranked one is grabbed and completes', async () => {
  await loadScenario({
    name: '332-second-completes',
    releases: [
      torrent('a-fails', 'phm', 'GrpA', 900, 'phm-m4b', 400, FAIL),
      torrent('b-good', 'phm', 'GrpB', 90, 'phm-m4b', 400, OK),
      torrent('c-unused', 'phm', 'GrpC', 9, 'phm-m4b', 400, OK),
    ],
  });
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();
  const id = (await rmab.requestBook(book)).request.id;

  const final = await waitFor('request settled', async () => (settled(status(id)) ? status(id) : null), { timeoutMs: 360_000, intervalMs: 3_000 });
  const evidence = {
    id, final, grabs: await grabCounts(['a-fails', 'b-good', 'c-unused']), blocked: blockedFor(id), history: historyOf(id),
    requestErrors: requestErrors(id), selected: selectedReleases(id), searchJobs: searchJobs(id),
  };
  writeEvidence('332/second-completes.json', evidence);

  expect(final).toMatch(/^(downloaded|available)\|/);
  expect(evidence.grabs).toEqual({ 'a-fails': 1, 'b-good': 1, 'c-unused': 0 });
  expect(evidence.blocked).toEqual([expect.stringContaining('[GrpA]')]);
  expect(evidence.history).toEqual([expect.stringMatching(/\[GrpA\] -> failed$/), expect.not.stringMatching(/-> failed$/)]);
  expect(evidence.requestErrors).toEqual([expect.stringMatching(/^Download failed in qBittorrent .*Trying another release \(attempt 2 of 3\)\.$/)]);
});

test('#332: three releases in a row fail; the fourth is never grabbed and the request fails', async () => {
  await loadScenario({
    name: '332-three-in-a-row',
    releases: [
      torrent('a', 'artemis', 'GrpA', 900, 'artemis-mp3', 280, FAIL),
      torrent('b', 'artemis', 'GrpB', 300, 'artemis-mp3', 280, FAIL),
      torrent('c', 'artemis', 'GrpC', 90, 'artemis-mp3', 280, FAIL),
      torrent('d', 'artemis', 'GrpD', 9, 'artemis-mp3', 280, FAIL),
    ],
  });
  const book = (await fakeArr.books()).artemis;
  const rmab = await Rmab.loginAdmin();
  const id = (await rmab.requestBook(book)).request.id;

  const final = await waitFor('request failed', async () => (settled(status(id)) ? status(id) : null), { timeoutMs: 420_000, intervalMs: 3_000 });
  await new Promise((r) => setTimeout(r, 15_000)); // nothing further may be grabbed
  const evidence = {
    id, final, grabs: await grabCounts(['a', 'b', 'c', 'd']), blocked: blockedFor(id), history: historyOf(id),
    requestErrors: requestErrors(id), selected: selectedReleases(id), searchJobs: searchJobs(id),
  };
  writeEvidence('332/three-in-a-row.json', evidence);

  expect(final).toMatch(/^failed\|3 releases in a row failed in the download client; last: Download failed in qBittorrent/);
  expect(evidence.grabs).toEqual({ a: 1, b: 1, c: 1, d: 0 });
  expect(evidence.blocked).toHaveLength(3);
  expect(evidence.blocked.join(' ')).not.toContain('[GrpD]');
  expect(evidence.requestErrors).toHaveLength(3);
  expect(evidence.requestErrors[0]).toContain('attempt 2 of 3');
  expect(evidence.requestErrors[1]).toContain('attempt 3 of 3');
  expect(evidence.requestErrors[2]).toMatch(/^3 releases in a row failed/);
});

test('#332: a usenet release fails in SABnzbd, the torrent release is grabbed and completes', async () => {
  await loadScenario({
    name: '332-usenet-then-torrent',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent' }, { id: 2, name: 'E2E Usenet', protocol: 'usenet' }],
    releases: [
      { id: 'nzb-fails', book: 'martian', protocol: 'usenet', indexerId: 2, title: '{{author}} - {{title}} (Unabridged) [M4B] [NZB]', sizeMB: 310, fixture: 'martian-m4b', download: FAIL },
      torrent('tor-good', 'martian', 'TOR', 5, 'martian-m4b', 310, OK),
    ],
  });
  const book = (await fakeArr.books()).martian;
  const rmab = await Rmab.loginAdmin();
  const id = (await rmab.requestBook(book)).request.id;

  const final = await waitFor('request settled', async () => (settled(status(id)) ? status(id) : null), { timeoutMs: 360_000, intervalMs: 3_000 });
  const evidence = {
    id, final, grabs: await grabCounts(['nzb-fails', 'tor-good']), blocked: blockedFor(id), history: historyOf(id),
    requestErrors: requestErrors(id), selected: selectedReleases(id), searchJobs: searchJobs(id),
  };
  writeEvidence('332/usenet-then-torrent.json', evidence);

  expect(final).toMatch(/^(downloaded|available)\|/);
  expect(evidence.grabs).toEqual({ 'nzb-fails': 1, 'tor-good': 1 });
  expect(evidence.blocked).toEqual([expect.stringContaining('[NZB]')]);
  expect(evidence.requestErrors).toEqual([expect.stringMatching(/^Download failed in SABnzbd \(Out of retention.*attempt 2 of 3/)]);
});
