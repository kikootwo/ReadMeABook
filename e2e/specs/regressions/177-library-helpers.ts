/**
 * Component: E2E helpers for the Library API specs (#177: 177-library-api, 177-library-perf)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { expect } from '@playwright/test';
import { Rmab, urls } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

/** The active Audiobookshelf library id, as the Library route reads it. */
export const activeLibraryId = () => psql(`select value from configuration where key = 'audiobookshelf.library_id'`);

/** Register a local user over the real route (registration on, no approval). */
export async function registerUser(admin: Rmab, username: string, password: string): Promise<{ id: string; rmab: Rmab }> {
  const settings = await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false });
  expect(settings.status, 'registration turned on').toBe(200);
  const res = await fetch(`${urls.rmab()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  expect(res.status, `register ${username}: ${JSON.stringify(body)}`).toBe(200);
  return { id: body.user.id, rmab: new Rmab(body.accessToken) };
}

/** A users row written directly (no sign-in), optionally soft deleted. */
export function insertUser(name: string, key: string, deleted: boolean): string {
  return psql(
    `insert into users (id, plex_id, plex_username, role, auth_provider, registration_status, deleted_at, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(key)}, ${sqlStr(name)}, 'user', 'local', 'approved', ${deleted ? 'now()' : 'null'}, now(), now())
     returning id`
  ).split('\n')[0];
}

export interface BookSeed {
  asin: string;
  title: string;
  filePath?: string | null;
  fileFormat?: string | null;
  absItemId?: string | null;
  libraryAsin?: string | null;
}

export function insertBook(b: BookSeed): string {
  return psql(
    `insert into audiobooks (id, audible_asin, title, author, narrator, status, file_path, file_format, abs_item_id, library_asin, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(b.asin)}, ${sqlStr(b.title)}, 'E2E 177 Author', 'E2E Narrator', 'requested',
             ${b.filePath ? sqlStr(b.filePath) : 'null'}, ${b.fileFormat ? sqlStr(b.fileFormat) : 'null'},
             ${b.absItemId ? sqlStr(b.absItemId) : 'null'}, ${b.libraryAsin ? sqlStr(b.libraryAsin) : 'null'}, now(), now())
     returning id`
  ).split('\n')[0];
}

export interface RequestSeed {
  userId: string;
  bookId: string;
  status: string;
  type?: 'audiobook' | 'ebook';
  progress?: number;
  error?: string | null;
  placedEbookFiles?: string | null;
  approvalBypassedBy?: string | null;
}

export function insertRequest(r: RequestSeed): string {
  return psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, placed_ebook_files, approval_bypassed_by, completed_at, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(r.userId)}, ${sqlStr(r.bookId)}, ${sqlStr(r.type ?? 'audiobook')}, ${sqlStr(r.status)}, ${r.progress ?? 0},
             ${r.error ? sqlStr(r.error) : 'null'}, ${r.placedEbookFiles ? `${sqlStr(r.placedEbookFiles)}::jsonb` : 'null'},
             ${r.approvalBypassedBy ? sqlStr(r.approvalBypassedBy) : 'null'}, ${r.status === 'available' ? 'now()' : 'null'}, now(), now())
     returning id`
  ).split('\n')[0];
}

export function insertLibraryRow(libraryId: string, row: { guid: string; asin: string; title: string; filePath: string; thumbUrl: string }) {
  psql(
    `insert into plex_library (id, plex_guid, title, author, narrator, duration, year, asin, file_path, thumb_url, plex_library_id, added_at, last_scanned_at, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(row.guid)}, ${sqlStr(row.title)}, 'E2E 177 Library Author', 'E2E Narrator', 3600000, 2020,
             ${sqlStr(row.asin)}, ${sqlStr(row.filePath)}, ${sqlStr(row.thumbUrl)}, ${sqlStr(libraryId)}, now(), now(), now(), now())`
  );
}

/** Timed GET with a bearer token; returns status, ms and the parsed body. */
export async function timedGet(token: string, path: string): Promise<{ status: number; ms: number; body: any }> {
  const started = performance.now();
  const res = await fetch(`${urls.rmab()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  return { status: res.status, ms: performance.now() - started, body };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
