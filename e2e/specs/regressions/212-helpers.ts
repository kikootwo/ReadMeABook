/**
 * Component: E2E regression #212 helpers (request flood, bulk bar, library state of a delivered book)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { expect, type Page } from '@playwright/test';
import type { Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { folderShas } from './423-helpers';
import { torrentOf } from './506-helpers';
import { absItemExists } from './library-delete-helpers';

export const FLOOD_ASIN = 'B0Z';
export const floodTitle = (n: number) => `Made Up Flood Book ${String(n).padStart(3, '0')}`;

/**
 * The reader's flood, one book row each (made-up titles), statuses interleaved by number: n % 5 of 1 or 2
 * awaiting_approval (120), 0 failed (60), 3 or 4 awaiting_search (120). Older than every real request,
 * newest last (300 is the newest).
 */
export function seedFlood(userId: string) {
  psql(
    `begin;
     insert into audiobooks (id, audible_asin, title, author, status, created_at, updated_at)
     select gen_random_uuid(), '${FLOOD_ASIN}' || lpad(g::text, 7, '0'), 'Made Up Flood Book ' || lpad(g::text, 3, '0'),
            'Made Up Flood Author', 'requested', now(), now()
     from generate_series(1, 300) g;
     insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, created_at, updated_at)
     select gen_random_uuid(), ${sqlStr(userId)}, a.id, 'audiobook',
            case when a.n % 5 in (1, 2) then 'awaiting_approval' when a.n % 5 = 0 then 'failed' else 'awaiting_search' end,
            0, case when a.n % 5 = 0 then 'Made up failure' end,
            now() - interval '2 hours' + (a.n || ' seconds')::interval, now()
     from (select id, substr(audible_asin, 4)::int as n from audiobooks where audible_asin like '${FLOOD_ASIN}%') a;
     commit;`
  );
}

/** Flood request counts by status (live requests), and soft-deleted ones by who deleted them. */
export function floodCounts(): Record<string, number> {
  const out = psql(
    `select case when r.deleted_at is null then r.status else 'deleted:' || coalesce(r.deleted_by, '') end, count(*)
     from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin like '${FLOOD_ASIN}%' group by 1 order by 1`
  );
  return Object.fromEntries(out.split('\n').filter(Boolean).map((l) => {
    const [k, v] = l.split('\t');
    return [k, Number(v)];
  }));
}

export const floodRequestId = (n: number) =>
  psql(`select r.id from requests r join audiobooks a on a.id = r.audiobook_id where a.audible_asin = '${FLOOD_ASIN}${String(n).padStart(7, '0')}'`);

/** Jobs queued for these requests: type (and notification event), counted. */
export function jobsFor(requestIds: string[]): Record<string, number> {
  const out = psql(
    `select type || coalesce(':' || (payload->>'event'), ''), count(*) from jobs
     where request_id in (${requestIds.map(sqlStr).join(',')}) group by 1 order by 1`
  );
  return Object.fromEntries(out.split('\n').filter(Boolean).map((l) => {
    const [k, v] = l.split('\t');
    return [k, Number(v)];
  }));
}

/** A live request's status | deleted_at | deleted_by (joined with a visible delimiter). */
export const requestRow = (id: string) =>
  psql(`select status || '|' || coalesce(deleted_at::text, '') || '|' || coalesce(deleted_by, '') from requests where id = ${sqlStr(id)}`);

export interface LibraryState {
  folder: string;
  shas: string;
  absItemId: string;
  absItemExists: boolean;
  torrentInClient: boolean;
  bookStatus: string;
}

/** What the library holds for a delivered request's book: folder sha256s, the ABS item, the torrent. */
export async function libraryState(requestId: string, releaseId: string): Promise<LibraryState> {
  const [folder = '', absItemId = '', bookStatus = ''] = psql(
    `select coalesce(a.file_path, '-') || '|' || coalesce(a.abs_item_id, '-') || '|' || a.status
     from requests r join audiobooks a on a.id = r.audiobook_id where r.id = ${sqlStr(requestId)}`
  ).split('|');
  let absExists = false;
  if (absItemId && absItemId !== '-') absExists = await absItemExists(absItemId);
  return { folder, shas: folder && folder !== '-' ? folderShas(folder) : '', absItemId, absItemExists: absExists, torrentInClient: !!(await torrentOf(releaseId)), bookStatus };
}

/** The admin requests list as the table loads it (inLibrary included). */
export async function listPage(admin: Rmab, query: string) {
  return admin.get<{ requests: { requestId: string; title: string; status: string; inLibrary: boolean }[]; total: number }>(`/api/admin/requests?${query}`);
}

export const bar = (page: Page) => page.getByRole('region', { name: 'Bulk actions' });

/** Open the admin page on a list query and wait for the table's header checkbox. */
export async function openTable(page: Page, query: string) {
  await page.goto(`/admin?${query}`);
  await expect(page.getByRole('checkbox', { name: 'Select all requests on this page' })).toBeVisible({ timeout: 60_000 });
}

/** The bar's status line (selection count, progress or result; focusable, unlike the screen reader line). */
export const statusLine = (page: Page) => bar(page).locator('p[tabindex="-1"]');

/** plex_library rows the delete's index cleanup would match for a book (by ASIN, or exact title and author). */
export function libraryIndexRows(asin: string, title: string, author: string): number {
  return Number(psql(
    `select count(*) from plex_library where asin = ${sqlStr(asin)} or plex_guid like ${sqlStr(`%${asin}%`)}
     or (lower(title) = lower(${sqlStr(title)}) and lower(author) = lower(${sqlStr(author)}))`
  ));
}
