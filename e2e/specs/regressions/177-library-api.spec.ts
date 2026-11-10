/**
 * Component: E2E #177 Library API gating (GET /api/library and ?live=1 on the built image)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Default flags; exec bridge. Seeds one stack over psql: a followed library book (stored link to an
 * item of another ASIN) with an ebook organized onto its row, a scan-only library book, and requests
 * in every status group, one by a soft-deleted account and one by a live account of the same name.
 * Three viewers call the full list and live mode: a non-admin with no stake in the failed book, the
 * failed request's owner and the admin. Asserts the gating table (keys omitted, not nulled), that
 * no canary (Audiobookshelf folder, placed ebook path, approval bypass mark, raw library ASIN, the
 * ebook's `epub` format, the Plex thumb token) appears in any response, and that a canary `q`
 * matches nothing for anyone. Evidence: `177/<viewer>-full.json`, `177/<viewer>-live.json`,
 * `177/result.json`. Values read first, then `expect.soft`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, writeEvidence } from '../../lib/harness';
import { psql } from './242-helpers';
import { activeLibraryId, insertBook, insertLibraryRow, insertRequest, insertUser, registerUser } from './177-library-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });

const CANARY = {
  absFolder: '/audiobookshelf/E2E177-CANARY-abs-folder/Followed Book',
  placedEbook: '/media/ebooks/E2E177-CANARY-placed.epub',
  bypass: 'asin_match:awaiting_approval',
  rawLibraryAsin: 'B0E177RAWL',
  thumbToken: 'E2E177-CANARY-PLEX-TOKEN',
  error: 'E2E177 CANARY download failed: tracker refused',
  adminPath: '/media/audiobooks/E2E177 CANARY admin path',
  ebookFolder: '/media/ebooks/E2E177 CANARY ebook folder',
};
const PREFIX = 'E2E 177';
const ASIN_LIKE = `audible_asin like 'B0E177%'`;

function cleanup() {
  psql(
    `begin;
     delete from requests where audiobook_id in (select id from audiobooks where ${ASIN_LIKE});
     delete from audiobooks where ${ASIN_LIKE};
     delete from plex_library where plex_guid like 'e2e-177-%';
     delete from users where plex_id like 'e2e-177-%';
     commit;`
  );
}

test.afterAll(() => {
  if (execBridgeAvailable()) cleanup();
});

test('#177: GET /api/library gates request data per viewer and leaks no server-only value', async () => {
  cleanup();
  const admin = await Rmab.loginAdmin();
  const owner = await registerUser(admin, 'lib177owner', 'e2e-lib177-owner-pass');
  const other = await registerUser(admin, 'lib177other', 'e2e-lib177-other-pass');
  const adminId = psql(`select id from users where role = 'admin' order by created_at limit 1`);
  const goneId = insertUser('lib177carol', 'e2e-177-gone', true);
  const liveCarolId = insertUser('lib177carol', 'e2e-177-live', false);
  const libraryId = activeLibraryId();
  expect(libraryId, 'an active Audiobookshelf library id').toBeTruthy();

  // Library: a followed book (item ASIN differs from the requested one) and a scan-only book
  insertLibraryRow(libraryId, { guid: 'e2e-177-followed', asin: 'B0E177LIBR', title: `${PREFIX} Library Edition`, filePath: CANARY.absFolder, thumbUrl: `http://plex/thumb?X-Plex-Token=${CANARY.thumbToken}` });
  insertLibraryRow(libraryId, { guid: 'e2e-177-scan', asin: 'B0E177SCAN', title: `${PREFIX} Scan Only`, filePath: `${CANARY.absFolder}-2`, thumbUrl: `http://plex/thumb2?X-Plex-Token=${CANARY.thumbToken}` });

  // The followed book: the ebook organize wrote its folder and format onto the shared row
  const followed = insertBook({ asin: 'B0E177REQS', title: `${PREFIX} Requested Edition`, absItemId: 'e2e-177-followed', libraryAsin: CANARY.rawLibraryAsin, filePath: CANARY.ebookFolder, fileFormat: 'epub' });
  insertRequest({ userId: owner.id, bookId: followed, status: 'available', progress: 100, placedEbookFiles: JSON.stringify([{ path: CANARY.placedEbook }]), approvalBypassedBy: CANARY.bypass });
  insertRequest({ userId: owner.id, bookId: followed, status: 'downloaded', type: 'ebook', placedEbookFiles: JSON.stringify([{ path: CANARY.placedEbook }]) });

  const failed = insertBook({ asin: 'B0E177FAIL', title: `${PREFIX} Failed`, filePath: CANARY.adminPath });
  const failedRequest = insertRequest({ userId: owner.id, bookId: failed, status: 'failed', error: CANARY.error });
  insertRequest({ userId: goneId, bookId: insertBook({ asin: 'B0E177DOWN', title: `${PREFIX} Downloading` }), status: 'downloading', progress: 42 });
  insertRequest({ userId: other.id, bookId: insertBook({ asin: 'B0E177APPR', title: `${PREFIX} Needs Approval` }), status: 'awaiting_approval' });
  insertRequest({ userId: adminId, bookId: insertBook({ asin: 'B0E177RELS', title: `${PREFIX} Awaiting Release` }), status: 'awaiting_release' });
  insertRequest({ userId: liveCarolId, bookId: insertBook({ asin: 'B0E177DENY', title: `${PREFIX} Denied` }), status: 'denied' });

  const viewers = { other: other.rmab, owner: owner.rmab, admin };
  const responses: Record<string, { full: any; live: any; fullStatus: number; liveStatus: number }> = {};
  for (const [name, rmab] of Object.entries(viewers)) {
    const full = await rmab.raw('GET', `/api/library?limit=120&q=${encodeURIComponent(PREFIX)}`);
    const live = await rmab.raw('GET', '/api/library?live=1');
    responses[name] = { full: await full.json(), live: await live.json(), fullStatus: full.status, liveStatus: live.status };
    writeEvidence(`177/${name}-full.json`, responses[name].full);
    writeEvidence(`177/${name}-live.json`, responses[name].live);
  }

  const canaryQ: Record<string, Record<string, number>> = {};
  for (const [name, rmab] of Object.entries(viewers)) {
    canaryQ[name] = {};
    for (const q of [CANARY.absFolder, CANARY.placedEbook, CANARY.error, CANARY.adminPath, CANARY.ebookFolder]) {
      canaryQ[name][q] = (await rmab.get(`/api/library?q=${encodeURIComponent(q)}`)).matched;
    }
  }

  const byTitle = (name: string, title: string) => responses[name].full.items?.find((i: any) => i.title === `${PREFIX} ${title}`);
  const universal = [CANARY.absFolder, CANARY.placedEbook, CANARY.bypass, CANARY.rawLibraryAsin, CANARY.thumbToken, CANARY.ebookFolder];
  const leaks = Object.fromEntries(Object.entries(responses).map(([name, r]) => {
    const text = JSON.stringify(r);
    return [name, [...universal.filter((c) => text.includes(c)), ...(/epub/i.test(text) ? ['epub'] : [])]];
  }));
  const gated = Object.fromEntries(Object.keys(viewers).map((name) => {
    const text = JSON.stringify(responses[name]);
    return [name, { error: text.includes(CANARY.error), adminPath: text.includes(CANARY.adminPath) }];
  }));
  const failedFor = (name: string) => byTitle(name, 'Failed');
  const facetCarols = responses.other.full.facets?.requestedBy?.filter((f: any) => f.username === 'lib177carol') ?? [];

  const result = {
    statuses: Object.fromEntries(Object.entries(responses).map(([n, r]) => [n, [r.fullStatus, r.liveStatus]])),
    matched: Object.fromEntries(Object.entries(responses).map(([n, r]) => [n, r.full.matched])),
    leaks,
    gated,
    canaryQ,
    viewer: Object.fromEntries(Object.entries(responses).map(([n, r]) => [n, r.full.viewer])),
    failedRequestKeys: Object.fromEntries(Object.keys(viewers).map((n) => [n, Object.keys(failedFor(n)?.request ?? {}).sort()])),
    pathKeys: Object.fromEntries(Object.keys(viewers).map((n) => [n, responses[n].full.items?.filter((i: any) => 'path' in i).length])),
    adminPaths: { followed: byTitle('admin', 'Library Edition')?.path, failed: failedFor('admin')?.path, scan: byTitle('admin', 'Scan Only')?.path },
    followed: byTitle('other', 'Library Edition'),
    groups: Object.fromEntries((responses.other.full.items ?? []).map((i: any) => [i.title, [i.id.slice(0, 4), i.statusGroup, i.source]])),
    facetCarols,
    live: responses.other.live,
    failedRequestId: failedRequest,
  };
  writeEvidence('177/result.json', result);

  for (const name of Object.keys(viewers)) {
    expect.soft(result.statuses[name], `${name}: both modes answer 200`).toEqual([200, 200]);
    expect.soft(leaks[name], `${name}: no canary in any response`).toEqual([]);
    expect.soft(Object.values(canaryQ[name]).every((m) => m === 0), `${name}: a canary q matches nothing`).toBe(true);
  }
  expect.soft(result.matched.other, 'every seeded book listed once (7)').toBe(7);
  expect.soft(result.groups).toEqual({
    [`${PREFIX} Library Edition`]: ['req_', 'available', 'rmab'],
    [`${PREFIX} Scan Only`]: ['lib_', 'available', 'scan'],
    [`${PREFIX} Failed`]: ['req_', 'problem', 'rmab'],
    [`${PREFIX} Downloading`]: ['req_', 'on_the_way', 'rmab'],
    [`${PREFIX} Needs Approval`]: ['req_', 'needs_approval', 'rmab'],
    [`${PREFIX} Awaiting Release`]: ['req_', 'awaiting_release', 'rmab'],
    [`${PREFIX} Denied`]: ['req_', 'denied', 'rmab'],
  });
  // Gating table
  expect.soft(result.failedRequestKeys.other, 'other user: public request keys only').toEqual(['createdAt', 'id', 'isMine', 'requestedBy']);
  expect.soft(result.failedRequestKeys.owner, 'owner: gated keys present').toEqual(['completedAt', 'createdAt', 'downloadSizeBytes', 'errorMessage', 'id', 'isMine', 'requestedBy']);
  expect.soft(result.failedRequestKeys.admin, 'admin: gated keys present').toEqual(['completedAt', 'createdAt', 'downloadSizeBytes', 'errorMessage', 'id', 'isMine', 'requestedBy']);
  expect.soft(gated.other, 'other user sees no error and no path').toEqual({ error: false, adminPath: false });
  expect.soft(gated.owner, 'owner sees its error, never a path').toEqual({ error: true, adminPath: false });
  expect.soft(gated.admin, 'admin sees both').toEqual({ error: true, adminPath: true });
  expect.soft(result.pathKeys, 'path: admins only, on every item').toEqual({ other: 0, owner: 0, admin: 7 });
  expect.soft(result.adminPaths, 'admin path: ebook rule and no library path').toEqual({ followed: null, failed: CANARY.adminPath, scan: null });
  expect.soft(result.viewer.other).toEqual({ isAdmin: false });
  expect.soft(result.viewer.owner).toEqual({ isAdmin: false });
  expect.soft(result.viewer.admin).toEqual({ isAdmin: true, canFetchEbook: expect.any(Boolean) });
  // Followed book: one entry, library metadata, never the requested edition
  expect.soft(result.followed).toMatchObject({ inLibrary: true, durationMinutes: 60, request: { requestedBy: { username: 'lib177owner' } } });
  // Deleted requester stays, same-name live account is a second facet entry keyed by id
  expect.soft(byTitle('other', 'Downloading')?.request?.requestedBy?.username).toBe('lib177carol');
  expect.soft(facetCarols.map((f: any) => [f.userId, f.deleted ?? false]).sort()).toEqual([[goneId, true], [liveCarolId, false]].sort());
  // Live mode: the downloading request only
  const liveIds = (responses.other.live.items ?? []).map((i: any) => i.id);
  const downloadingId = byTitle('other', 'Downloading')?.id;
  expect.soft(liveIds, 'live mode lists the in-flight request').toContain(downloadingId);
  expect.soft(liveIds, 'live mode skips non-live requests').not.toContain(byTitle('other', 'Failed')?.id);
  expect.soft(responses.other.live.refreshMs).toBe(5000);
});
