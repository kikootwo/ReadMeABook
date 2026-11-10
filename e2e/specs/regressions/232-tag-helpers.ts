/**
 * Component: E2E helpers for the #232 requester tag spec (users, deliveries, ABS item reads, jobs)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { expect } from '@playwright/test';
import { Abs, authState, ctl, Rmab, urls, waitFor, type Book } from '../../lib/harness';
import { asApp, dbNow, markJobs, MEDIA, psql, q, sh, sqlStr, waitOrganized } from './242-helpers';
import { SCAN_TYPES } from './284-helpers';

export const TAG_KEY = 'audiobookshelf.tag_requester';
const PASSWORD = 'e2e-232-tags-pass';

/** A documentation-range address (TEST-NET-3) per name: the register route keys its limit on a valid client address (#575). Shared by the e2e register helpers. */
export const addressFor = (name: string) => `203.0.113.${([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 254) + 1}`;

/**
 * Register a local user (registration on, no approval) and set its auto-approve. The register route
 * allows 5 attempts an hour per client address, so each user sends its own.
 */
export async function registerUser(admin: Rmab, username: string, autoApproveRequests: boolean): Promise<{ id: string; rmab: Rmab }> {
  const res = await fetch(`${urls.rmab()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': addressFor(username) },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await res.json();
  expect(res.status, `register ${username}: ${JSON.stringify(body)}`).toBe(200);
  const set = await admin.raw('PUT', `/api/admin/users/${body.user.id}`, { role: 'user', autoApproveRequests });
  expect(set.status, `${username} autoApprove ${autoApproveRequests}`).toBe(200);
  return { id: body.user.id, rmab: new Rmab(body.accessToken) };
}

/** The ABS settings as the settings page sends them, with tagRequester set. */
export async function setTagging(admin: Rmab, on: boolean) {
  const s = (await admin.get<{ audiobookshelf: Record<string, unknown> }>('/api/admin/settings')).audiobookshelf;
  const res = await admin.raw('PUT', '/api/admin/settings/audiobookshelf', {
    serverUrl: s.serverUrl, apiToken: s.apiToken, libraryId: s.libraryId, triggerScanAfterImport: s.triggerScanAfterImport, tagRequester: on,
  });
  expect(res.status, `tagging ${on ? 'on' : 'off'}`).toBe(200);
}

/** Run a scheduled job once and wait until its job row is done (the full scan's row is `scan_plex`). */
export async function runJob(admin: Rmab, type: string): Promise<string> {
  const t0 = dbNow();
  await admin.triggerScheduledJob(type);
  const rowTypes = type === 'plex_library_scan' ? SCAN_TYPES : `(${sqlStr(type)})`;
  return waitFor(`${type} finished`, async () => {
    const s = psql(`select status from jobs where type in ${rowTypes} and created_at > ${sqlStr(t0)}::timestamp order by created_at desc limit 1`);
    return s === 'completed' || s === 'failed' ? s : null;
  }, { timeoutMs: 300_000, intervalMs: 2_000 });
}

/** The newest backfill job started after `t0`, once done: status and result. */
export async function backfillAfter(t0: string): Promise<{ status: string; result: Record<string, unknown> | null }> {
  return waitFor('requester tag backfill finished', async () => {
    const row = psql(`select concat_ws('|', status, coalesce(result::text, '')) from jobs where type = 'backfill_requester_tags' and created_at > ${sqlStr(t0)}::timestamp order by created_at desc limit 1`);
    if (!row) return null;
    const [status, ...rest] = row.split('|');
    if (status !== 'completed' && status !== 'failed') return null;
    return { status, result: rest.join('|') ? JSON.parse(rest.join('|')) : null };
  }, { timeoutMs: 180_000, intervalMs: 2_000 });
}

export const requestStatus = (id: string) => psql(`select status from requests where id = ${sqlStr(id)}`);
export const bypassMark = (id: string) => psql(`select coalesce(approval_bypassed_by, '') from requests where id = ${sqlStr(id)}`);

/** Wait until a new request's automatic search has settled (nothing found for a non-fixture title). */
export async function waitSettled(id: string, statuses = ['awaiting_search', 'failed', 'awaiting_approval', 'denied']) {
  return waitFor(`request ${id} settled`, async () => (statuses.includes(requestStatus(id)) ? requestStatus(id) : null), { timeoutMs: 240_000, intervalMs: 2_000 });
}

/** A folder of generated tones under /downloads (as the app user). */
function generatedFolder(label: string): string {
  const dir = `/downloads/e2e-232/${label}-${Date.now().toString(36)}`;
  asApp(`mkdir -p ${q(dir)}\nffmpeg -nostdin -loglevel error -f lavfi -i sine=frequency=440:duration=6 -c:a libmp3lame -b:a 64k -y ${q(`${dir}/${label}.mp3`)}`);
  return dir;
}

/** Manual import (unnamed request) of a folder of generated tones for the request's book; waits for organize. */
export async function importGenerated(admin: Rmab, requestId: string, label: string): Promise<string> {
  const dir = generatedFolder(label);
  const audiobookId = psql(`select audiobook_id from requests where id = ${sqlStr(requestId)}`);
  const since = markJobs();
  const res = await admin.raw('POST', '/api/admin/manual-import', { audiobookId, folderPath: dir, cleanupSource: false });
  expect(res.status, `manual import ${label}: ${await res.clone().text()}`).toBe(200);
  await waitOrganized(since, requestId);
  sh(`rm -rf ${q(dir)}`);
  return psql(`select coalesce(file_path, '') from audiobooks where id = ${sqlStr(audiobookId)}`);
}

/**
 * Manual import of a book nobody requested: the import creates the admin's own request. The book row is
 * inserted first (offline RMAB can't fetch a book by ASIN; ABS gets the fake metadata, RMAB does not).
 */
export async function importUnrequested(admin: Rmab, book: Book): Promise<{ requestId: string; filePath: string }> {
  const audiobookId = psql(`insert into audiobooks (id, audible_asin, title, author, narrator, status, updated_at) values (gen_random_uuid()::text, ${sqlStr(book.asin)}, ${sqlStr(book.title)}, ${sqlStr(book.author)}, ${sqlStr(book.narrator)}, 'requested', now()) returning id`).split('\n')[0];
  const dir = generatedFolder('unrequested');
  const since = markJobs();
  const res = await admin.raw('POST', '/api/admin/manual-import', { audiobookId, folderPath: dir, cleanupSource: false });
  const body = await res.clone().json().catch(() => ({}));
  expect(res.status, `manual import of ${book.asin}: ${JSON.stringify(body)}`).toBe(200);
  await waitOrganized(since, body.requestId);
  sh(`rm -rf ${q(dir)}`);
  return { requestId: body.requestId, filePath: psql(`select coalesce(a.file_path, '') from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(body.requestId)}`) };
}

/**
 * A second run on the same stack: a fixture book an earlier run delivered is taken back out (ABS item
 * deleted with its files, RMAB's library rows and link columns cleared, its requests soft-deleted), so
 * this run can request or import it again. A book never delivered is left alone. Returns what it cleared.
 */
export async function clearEarlierRun(abs: Abs, asins: string[]): Promise<string[]> {
  const cleared: string[] = [];
  for (const asin of asins) {
    const rows = psql(`select concat_ws('|', id, coalesce(abs_item_id, ''), coalesce(file_path, '')) from audiobooks where audible_asin = ${sqlStr(asin)}`).split('\n').filter(Boolean);
    for (const row of rows) {
      const [id, itemId, filePath] = row.split('|');
      const live = psql(`select count(*) from requests where audiobook_id = ${sqlStr(id)} and deleted_at is null`);
      if (!itemId && !filePath && live === '0') continue;
      if (itemId) {
        const res = await fetch(`${urls.abs()}/api/items/${itemId}?hard=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${abs.token}` } });
        expect([200, 404], `delete ABS item ${itemId}`).toContain(res.status);
        psql(`delete from plex_library where plex_guid = ${sqlStr(itemId)}`);
      }
      if (filePath.startsWith(`${MEDIA}/`)) sh(`rm -rf ${q(filePath)}`);
      psql(`update requests set deleted_at = now() where audiobook_id = ${sqlStr(id)} and deleted_at is null`);
      psql(`update audiobooks set abs_item_id = null, plex_guid = null, file_path = null, files_hash = null, library_asin = null, completed_at = null where id = ${sqlStr(id)}`);
      cleared.push(asin);
    }
  }
  return cleared;
}

/** The ABS library's lastScan (ms), set when a library scan finishes. */
export async function absLastScan(abs: Abs, libraryId: string): Promise<number | null> {
  const body = await abs.req<{ lastScan?: number; library?: { lastScan?: number } }>('GET', `/api/libraries/${libraryId}`);
  return body.library?.lastScan ?? body.lastScan ?? null;
}

/** ABS scan, then the item whose folder is RMAB's `filePath`. */
export async function absItemFor(abs: Abs, filePath: string): Promise<{ id: string }> {
  const rel = filePath.slice(MEDIA.length + 1);
  const libraryId = authState().absLibraryId;
  expect((await fetch(`${urls.abs()}/api/libraries/${libraryId}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${abs.token}` } })).ok).toBe(true);
  return waitFor(`ABS item for ${rel}`, async () =>
    (await abs.libraryItems(libraryId)).find((i) => String(i.relPath || '').replace(/\/+$/, '') === rel) || null, { timeoutMs: 180_000, intervalMs: 2_000 });
}

/** The item's tags and updatedAt as ABS holds them now. */
export async function itemTags(abs: Abs, itemId: string): Promise<{ tags: string[]; updatedAt: number }> {
  const item = await abs.req<{ media: { tags: string[] }; updatedAt: number }>('GET', `/api/items/${itemId}`);
  return { tags: item.media.tags, updatedAt: item.updatedAt };
}

/** The fake Audnexus answers `tags` as Audible tag genres for this ASIN (empty list = none). */
export async function setAudibleTags(asin: string, tags: string[]) {
  const res = await ctl('/metadata-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asin, tags }) });
  expect(res.status, 'fake metadata tags').toBe(200);
}

/** A made-up book (not in the fixtures): RMAB stores what the request sends; nothing searches finds it. */
export const madeUpBook = (asin: string, word: string): Book => ({ asin, title: `Tagbook ${word}`, author: 'Synthetic Writer', narrator: 'Synthetic Voice', runtimeMin: null });
