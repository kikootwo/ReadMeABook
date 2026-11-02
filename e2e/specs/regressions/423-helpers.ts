/**
 * Component: E2E regression #423 helpers (takeover scenario, ownership rows, cleanup trigger)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * A "takeover" is a torrent that was already in qBittorrent before RMAB grabbed the same release:
 * fake-arr's /__control/qbit-seed puts it there (finished, files on disk, added 2 days ago).
 */

import { waitFor, fakeArr, ctl, authState, Abs, Rmab, type Recorded } from '../../lib/harness';
import { sh, q, psql, sqlStr, markJobs, newJobsWhere } from './242-helpers';

export const TWO_DAYS_SEC = 2 * 24 * 3600;
const TITLE = '{{author}} - {{title}} (Unabridged) [MP3 64kbps]';

/** One torrent release per book on indexer 1; ids are the release ids. */
export function takeoverScenario(name: string, books: Record<string, string>) {
  return {
    name,
    description: 'Torrent releases on indexer 1 via fake qBittorrent; some are seeded into the client before the grab (#423).',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: Object.entries(books).map(([id, book]) => ({ id, book, title: TITLE, sizeMB: 420, seeders: 60, fixture: `${book}-mp3` })),
  };
}

export async function loadScenario(def: unknown) {
  const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  if (!res.ok) throw new Error(`load scenario: HTTP ${res.status} ${await res.text()}`);
}

export interface SeededTorrent {
  hash: string;
  name: string;
  contentPath: string;
  addedOn: number;
  completionOn: number;
}

/** Put a release's torrent in fake qBittorrent as someone else's: added (and finished) long ago. */
export async function seedTakeover(release: string, addedAgoSec = TWO_DAYS_SEC): Promise<SeededTorrent> {
  const res = await ctl('/qbit-seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ release, addedAgoSec, category: 'manual' }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(`qbit-seed ${release}: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body.torrent;
}

/** Save indexer 1's seeding rule the way the Settings page does (GET, then PUT the list). */
export async function setSeeding(rmab: Rmab, seedingTimeMinutes: number) {
  const body = await rmab.get<{ indexers: any[]; flagConfigs: any[] }>('/api/admin/settings/prowlarr/indexers');
  const indexers = body.indexers.map((i) => (i.id === 1 ? { ...i, enabled: true, seedingTimeMinutes, ratioLimit: 0, removeAfterProcessing: false } : i));
  const res = await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers, flagConfigs: body.flagConfigs });
  if (!res.ok) throw new Error(`PUT indexers: HTTP ${res.status} ${await res.text()}`);
  return psql(`select value from configuration where key = 'prowlarr_indexers'`);
}

/** sha256 of each file below a download folder, relative paths, sorted ('' if the folder is gone). */
export function folderShas(dir: string, service = 'rmab'): string {
  const out = sh(`[ -d ${q(dir)} ] || exit 0\ncd ${q(dir)} && find . -type f -exec sha256sum {} +`, { service });
  return out.split('\n').filter(Boolean).map((l) => l.replace(/ +\.\//, '  ')).sort().join('\n');
}

export const fixtureShas = (book: string) => folderShas(`/fixtures/${book}-mp3`, 'fake-arr');

export function hasOwnershipColumn(): boolean {
  return psql(`select count(*) from information_schema.columns where table_name = 'download_history' and column_name = 'added_by_rmab'`) === '1';
}

export interface DownloadRow {
  requestId: string;
  addedByRmab: 'true' | 'false' | 'null' | 'no column';
  status: string;
  hash: string;
}

/** The selected download of a request (null when the request row is gone). */
export function downloadRow(requestId: string): DownloadRow | null {
  const owned = hasOwnershipColumn() ? `coalesce(added_by_rmab::text, 'null')` : `'no column'`;
  const out = psql(
    `select request_id, ${owned}, coalesce(download_status, ''), coalesce(torrent_hash, '') from download_history
     where request_id = ${sqlStr(requestId)} and selected order by created_at desc limit 1`
  );
  if (!out) return null;
  const [id, addedByRmab, status, hash] = out.split('\t');
  return { requestId: id, addedByRmab: addedByRmab as DownloadRow['addedByRmab'], status, hash };
}

export const requestExists = (requestId: string) => psql(`select count(*) from requests where id = ${sqlStr(requestId)}`) === '1';

export const requestStatus = (requestId: string) => psql(`select status from requests where id = ${sqlStr(requestId)}`);

export async function waitDownloaded(requestId: string) {
  return waitFor('request downloaded/available', async () => (['downloaded', 'available'].includes(requestStatus(requestId)) ? true : null), {
    timeoutMs: 300_000,
    intervalMs: 3_000,
  });
}

/** Scan Audiobookshelf until it lists every title, then run RMAB's check until each request is available. */
export async function waitAvailable(rmab: Rmab, items: { requestId: string; title: string }[]) {
  const abs = await Abs.login();
  const libraryId = authState().absLibraryId;
  await waitFor(
    'ABS lists every title',
    async () => {
      await abs.req('POST', `/api/libraries/${libraryId}/scan`).catch(() => undefined);
      const titles = new Set((await abs.libraryItems(libraryId)).map((i) => i.media?.metadata?.title));
      return items.every((i) => titles.has(i.title)) || null;
    },
    { timeoutMs: 240_000, intervalMs: 5_000 }
  );
  await waitFor(
    'requests available',
    async () => {
      await rmab.triggerScheduledJob('plex_recently_added_check').catch(() => undefined);
      return items.every((i) => requestStatus(i.requestId) === 'available') || null;
    },
    { timeoutMs: 240_000, intervalMs: 10_000 }
  );
}

/** Wait until the fake client reports at least `seconds` of seeding for a hash. */
export async function waitSeeded(hash: string, seconds: number) {
  return waitFor(
    `torrent ${hash} seeding ${seconds}s`,
    async () => {
      const t = (await fakeArr.state()).torrents.find((x: any) => x.hash === hash);
      return t && t.seeding_time >= seconds ? t : null;
    },
    { timeoutMs: (seconds + 120) * 1000, intervalMs: 5_000 }
  );
}

/** Trigger the scheduled seeding cleanup and wait for its job; returns the job's result JSON. */
export async function runCleanup(rmab: Rmab): Promise<string> {
  const mark = markJobs();
  await rmab.triggerScheduledJob('cleanup_seeded_torrents');
  return waitFor(
    'cleanup job finished',
    async () => {
      const row = psql(`select status, coalesce(result::text, '') from jobs where type = 'cleanup_seeded_torrents' and ${newJobsWhere(mark)} order by created_at desc limit 1`);
      const [status, result] = row.split('\t');
      return ['completed', 'failed'].includes(status) ? `${status}\t${result || ''}` : null;
    },
    { timeoutMs: 180_000, intervalMs: 2_000 }
  );
}

/** qBittorrent delete calls (hashes and deleteFiles) recorded after `since`. */
export async function qbitDeletes(since = 0): Promise<{ seq: number; hashes: string[]; deleteFiles: boolean }[]> {
  return (await fakeArr.requests(since))
    .filter((r: Recorded) => r.service === 'qbit' && r.path.endsWith('/torrents/delete'))
    .map((r) => ({ seq: r.seq, hashes: String(r.body?.hashes || '').toLowerCase().split('|').filter(Boolean), deleteFiles: !!r.body?.deleteFiles }));
}

export async function lastSeq(): Promise<number> {
  return (await fakeArr.requests()).at(-1)?.seq ?? 0;
}

export async function clientHas(hash: string): Promise<boolean> {
  return (await fakeArr.state()).torrents.some((t: any) => t.hash === hash);
}
