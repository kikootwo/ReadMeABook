/**
 * Component: E2E regression #228 helpers (cancel stops the download: scenarios, users, rows, faults)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { waitFor, fakeArr, ctl, urls, Rmab, type Recorded } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

export const TORRENT_INDEXER = { id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 };
export const USENET_INDEXER = { id: 2, name: 'E2E Usenet', protocol: 'usenet', priority: 25 };

export interface SlowRelease {
  id: string;
  book: string;
  completeMs: number;
  usenet?: boolean;
}

/** One release per entry (mp3 fixtures: every book has one); torrents on indexer 1, usenet on indexer 2. */
export function cancelScenario(name: string, releases: SlowRelease[]) {
  return {
    name,
    description: 'Slow downloads cancelled mid-way (#228).',
    indexers: [TORRENT_INDEXER, USENET_INDEXER],
    releases: releases.map((r) => ({
      id: r.id,
      book: r.book,
      title: `{{author}} - {{title}} (Unabridged) [MP3 64kbps] ${r.id}`,
      sizeMB: 420,
      seeders: 60,
      fixture: `${r.book}-mp3`,
      download: { completeMs: r.completeMs },
      ...(r.usenet ? { protocol: 'usenet', indexerId: USENET_INDEXER.id } : {}),
    })),
  };
}

/** Indexer 1 seeds 1 minute (no ratio); indexer 2 enabled. Saved the way the Settings page does. */
export async function configureIndexers(rmab: Rmab, seedingTimeMinutes = 1) {
  const body = await rmab.get<{ indexers: any[]; flagConfigs: any[] }>('/api/admin/settings/prowlarr/indexers');
  const indexers = body.indexers.map((i) => {
    if (i.id === TORRENT_INDEXER.id) return { ...i, enabled: true, seedingTimeMinutes, ratioLimit: 0, removeAfterProcessing: false };
    if (i.id === USENET_INDEXER.id) return { ...i, enabled: true };
    return i;
  });
  const res = await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers, flagConfigs: body.flagConfigs });
  if (!res.ok) throw new Error(`PUT indexers: HTTP ${res.status} ${await res.text()}`);
  return psql(`select value from configuration where key = 'prowlarr_indexers'`);
}

/** The registration settings as saved (missing keys read as off, the way the settings page reads them). */
function registrationSettings(): { enabled: boolean; requireAdminApproval: boolean } {
  const out = psql(`select key, value from configuration where key in ('auth.registration_enabled', 'auth.require_admin_approval')`);
  const saved = new Map(out.split('\n').filter(Boolean).map((line) => line.split('\t') as [string, string]));
  return {
    enabled: saved.get('auth.registration_enabled') === 'true',
    requireAdminApproval: saved.get('auth.require_admin_approval') === 'true',
  };
}

/**
 * A second, non-admin local user with a session and an API token of its own. Open registration is
 * on only for the sign-up, then put back as it was, so later specs on the stack don't inherit it.
 */
export async function registerReader(admin: Rmab, username: string) {
  const before = registrationSettings();
  const reg = await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false });
  if (!reg.ok) throw new Error(`enable registration: HTTP ${reg.status} ${await reg.text()}`);
  let body: any;
  try {
    const res = await fetch(`${urls.rmab()}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: `e2e-${username}-password` }),
    });
    body = await res.json();
    if (!res.ok || !body.accessToken) throw new Error(`register ${username}: HTTP ${res.status} ${JSON.stringify(body)}`);
  } finally {
    const restore = await admin.raw('PUT', '/api/admin/settings/registration', before);
    if (!restore.ok) throw new Error(`restore registration: HTTP ${restore.status} ${await restore.text()}`);
  }
  const after = registrationSettings();
  if (after.enabled !== before.enabled || after.requireAdminApproval !== before.requireAdminApproval) {
    throw new Error(`registration not restored: ${JSON.stringify({ before, after })}`);
  }
  const session = new Rmab(body.accessToken);
  const token = await session.post<{ fullToken: string; token: { role: string } }>('/api/user/api-tokens', { name: 'e2e-506' });
  return { session, apiToken: new Rmab(token.fullToken), userId: String(body.user?.id ?? ''), tokenRole: token.token.role };
}

export interface CancelRow {
  status: string;
  downloadStatus: string;
  hash: string;
  nzbId: string;
  cancelledAt: string;
}

/** The request's status and cancelled_at, and its newest selected download row. */
export function cancelRow(requestId: string): CancelRow {
  const out = psql(
    `select r.status, coalesce(d.download_status, ''), coalesce(d.torrent_hash, ''), coalesce(d.nzb_id, ''), coalesce(r.cancelled_at::text, '')
     from requests r left join lateral (
       select * from download_history h where h.request_id = r.id and h.selected order by h.created_at desc limit 1
     ) d on true where r.id = ${sqlStr(requestId)}`
  );
  const [status = '', downloadStatus = '', hash = '', nzbId = '', cancelledAt = ''] = out.split('\t');
  return { status, downloadStatus, hash, nzbId, cancelledAt };
}

/** Wait until the request is downloading with a client id on its selected row. */
export async function waitDownloading(requestId: string) {
  return waitFor(
    'request downloading with a client id',
    async () => {
      const out = psql(
        `select r.status, coalesce(h.download_client_id, '') from requests r join download_history h on h.request_id = r.id and h.selected
         where r.id = ${sqlStr(requestId)} order by h.created_at desc limit 1`
      );
      const [status, clientId] = out.split('\t');
      return status === 'downloading' && clientId ? clientId : null;
    },
    { timeoutMs: 240_000, intervalMs: 2_000 }
  );
}

/** Fake qBittorrent's view of a release's torrent (undefined once it is gone). */
export async function torrentOf(releaseId: string): Promise<any | undefined> {
  return (await fakeArr.state()).torrents.find((t: any) => t.releaseId === releaseId);
}

/** Fake SABnzbd job (queue or history) by nzo id. */
export async function nzbOf(nzoId: string): Promise<any | undefined> {
  const { nzbs } = await fakeArr.state();
  return [...(nzbs.queue || []), ...(nzbs.history || [])].find((n: any) => n.nzo_id === nzoId);
}

/** SABnzbd queue deletes recorded after `since`. */
export async function sabQueueDeletes(since = 0): Promise<Recorded[]> {
  return (await fakeArr.requests(since)).filter((r) => r.service === 'sab' && r.query.mode === 'queue' && r.query.name === 'delete');
}

/** Make the next `count` qBittorrent torrents/delete calls answer HTTP `status` without deleting. */
export async function armDeleteFault(count = 1, status = 500) {
  const res = await ctl('/qbit-fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'torrents/delete', status, count }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(`qbit-fault: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body.fault;
}

export function cancelledAtColumn(): { exists: boolean; nullable: string; defaultValue: string } {
  const out = psql(
    `select is_nullable, coalesce(column_default, '') from information_schema.columns where table_name = 'requests' and column_name = 'cancelled_at'`
  );
  if (!out) return { exists: false, nullable: '', defaultValue: '' };
  const [nullable, defaultValue = ''] = out.split('\t');
  return { exists: true, nullable, defaultValue };
}

/** Cleanup job result JSON (the `cancelled` pass counts), or null. */
export function cleanupCounts(jobTsv: string): any {
  const [, result] = jobTsv.split('\t');
  try {
    return JSON.parse(result || 'null');
  } catch {
    return null;
  }
}

/** Wait until fake qBittorrent reports the release's torrent finished (progress 1, seeding). */
export async function waitComplete(releaseId: string) {
  return waitFor(
    `torrent ${releaseId} complete`,
    async () => {
      const t = await torrentOf(releaseId);
      return t && t.progress === 1 && t.completion_on > 0 ? t : null;
    },
    { timeoutMs: 600_000, intervalMs: 3_000 }
  );
}

/** The newest live request for a book (any status; the API list may filter some out). */
export function requestIdByAsin(asin: string): string {
  return psql(
    `select r.id from requests r join audiobooks a on a.id = r.audiobook_id
     where a.audible_asin = ${sqlStr(asin)} and r.deleted_at is null order by r.created_at desc limit 1`
  );
}
