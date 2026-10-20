/**
 * Component: E2E regression #312 (a re-request keeps the failed request's blocklist)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Scenario failed-download: one torrent release ("broken") that the fake qBittorrent fails at 30%.
 * The download fails, the request goes to `failed` and the release is auto-blocked. A re-request
 * through POST /api/requests (createRequestForUser, the same path shelf sync and watched lists use;
 * a real shelf sync needs Hardcover/Goodreads, which the harness does not fake) must carry the
 * blocklist to the new request, so the dead release is NOT grabbed again and the new request
 * settles at awaiting_search ("all blocked"). On main before the fix the re-request deleted the
 * old request (and its blocklist) and grabbed "broken" a second time.
 * The second test fires two re-requests at once and checks one request results; that is a smoke
 * check of the guarded replace, not a proof of the race (timing in a container is not controlled).
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, fakeArr, waitFor, writeEvidence, Rmab, type Recorded } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'default' });

const releaseOf = (r: Recorded) => {
  try {
    return JSON.parse(Buffer.from(String(r.query.link), 'base64url').toString('utf8')).r as string;
  } catch {
    return undefined;
  }
};
const grabsOf = async (id: string) =>
  (await fakeArr.requests()).filter((r) => r.service === 'prowlarr' && /^\/\d+\/download$/.test(r.path) && releaseOf(r) === id);

const status = (requestId: string) => psql(`select coalesce(status,'') || '|' || coalesce(error_message,'') from requests where id = ${sqlStr(requestId)}`);
const blockedFor = (requestId: string) => psql(`select release_name from blocked_releases where request_id = ${sqlStr(requestId)} order by created_at`).split('\n').filter(Boolean);

test('#312: a re-request after an auto-blocked failure keeps the blocklist and does not grab the dead release again', async () => {
  const loaded = await fakeArr.scenario('failed-download');
  expect(loaded.releases).toEqual(['broken']);
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();

  const first = await rmab.requestBook(book);
  const oldId = first.request.id;
  await waitFor('first request failed', async () => (status(oldId).startsWith('failed|') ? true : null), { timeoutMs: 300_000, intervalMs: 3_000 });
  const blocked = blockedFor(oldId);
  writeEvidence('312/first-request.json', { oldId, status: status(oldId), blocked, grabs: (await grabsOf('broken')).length });
  expect(blocked.length, 'the failed release was auto-blocked').toBeGreaterThan(0);
  expect((await grabsOf('broken')).length).toBe(1);

  const res = await rmab.raw('POST', '/api/requests', { audiobook: { asin: book.asin, title: book.title, author: book.author, narrator: book.narrator } });
  const body = await res.json();
  writeEvidence('312/re-request-response.json', { status: res.status, body });
  expect(res.status).toBe(201);
  const newId = body.request.id as string;

  const settled = await waitFor(
    'new request searched with the carried blocklist',
    async () => (status(newId).startsWith('awaiting_search|') ? status(newId) : null),
    { timeoutMs: 240_000, intervalMs: 3_000 }
  );
  writeEvidence('312/after-re-request.json', {
    newId,
    settled,
    blockedOnNew: blockedFor(newId),
    oldRows: psql(`select count(*) from requests where id = ${sqlStr(oldId)}`),
    grabs: (await grabsOf('broken')).length,
  });
  expect(settled).toContain('all blocked');
  expect(blockedFor(newId)).toEqual(blocked);
  expect(psql(`select count(*) from requests where id = ${sqlStr(oldId)}`)).toBe('0');
  expect((await grabsOf('broken')).length, 'the dead release was not grabbed again').toBe(1);
});

test('#312: two re-requests at once leave one request with the blocklist (smoke check, not a race proof)', async () => {
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();
  const active = psql(
    `select r.id from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin = ${sqlStr(book.asin)} and r.deleted_at is null and r.type = 'audiobook'`
  ).split('\n').filter(Boolean);
  expect(active.length, 'one request left by the previous test').toBe(1);
  const blocked = blockedFor(active[0]);
  // Make it re-requestable again
  psql(`update requests set status = 'failed' where id = ${sqlStr(active[0])}`);

  const post = () => rmab.raw('POST', '/api/requests', { audiobook: { asin: book.asin, title: book.title, author: book.author, narrator: book.narrator } });
  const responses = await Promise.all([post(), post()]);
  const statuses = responses.map((r) => r.status).sort();
  const after = psql(
    `select r.id from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin = ${sqlStr(book.asin)} and r.deleted_at is null and r.type = 'audiobook'`
  ).split('\n').filter(Boolean);
  writeEvidence('312/concurrent.json', { statuses, after, blockedOnAfter: after.map(blockedFor) });

  expect(after.length, 'exactly one active request').toBe(1);
  expect(statuses).toEqual([201, 409]);
  expect(blockedFor(after[0])).toEqual(blocked);
});
