/**
 * Component: E2E regression #290 helpers (admin Add Torrent: scenario, route calls, job rows, fake-client adds)
 * Documentation: documentation/testing/e2e-harness.md
 */

import type { Page } from '@playwright/test';
import { ctl, urls, waitFor, type Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { callsSince } from './46-helpers';

export const DIR = '290';
export const ADD_PATH = (id: string) => `/api/admin/requests/${id}/add-torrent`;
const TITLE = '{{author}} - {{title}} (Unabridged) [MP3 64kbps]';

/**
 * phm: one listed release that fails at 30 % (the request ends `failed`) and an unlisted magnet.
 * martian: an unlisted generated .torrent. artemis: an unlisted magnet (double submit).
 * Unlisted releases are never in search or RSS: the fake clients know them, Prowlarr never offers them.
 */
export async function loadScenario() {
  const def = {
    name: 'add-torrent-290',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [
      { id: 'fail-phm', book: 'phm', title: TITLE, sizeMB: 300, seeders: 50, fixture: 'phm-mp3', download: { failAtPct: 30 } },
      // 90 s of downloading, so the admin views show it while it runs
      { id: 'magnet-phm', book: 'phm', title: TITLE, name: '{{title}} (hand-added magnet)', fixture: 'phm-mp3', link: 'magnet', unlisted: true, download: { completeMs: 90_000 } },
      { id: 'file-martian', book: 'martian', title: TITLE, name: '{{title}} (hand-added file)', fixture: 'martian-mp3', unlisted: true },
      { id: 'magnet-artemis', book: 'artemis', title: TITLE, name: '{{title}} (hand-added twice)', fixture: 'artemis-mp3', link: 'magnet', unlisted: true },
    ],
  };
  const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  if (!res.ok) throw new Error(`load scenario ${def.name}: HTTP ${res.status} ${await res.text()}`);
  return def;
}

export interface ReleaseTorrent { id: string; infoHash: string; magnet: string; torrentFile: string | null; sha256: string | null }

/** What an admin would paste or upload: the release's magnet and its .torrent bytes (base64). */
export async function releaseTorrent(id: string): Promise<ReleaseTorrent> {
  const res = await ctl(`/release-torrent?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`release-torrent ${id}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

export interface Answer { status: number; body: unknown }

export async function addTorrent(client: Rmab, requestId: string, body: unknown): Promise<Answer> {
  const res = await client.raw('POST', ADD_PATH(requestId), body);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A body sent chunked (no Content-Length), so the size limit is met while reading. */
export async function addTorrentChunked(token: string, requestId: string, bytes: number): Promise<Answer> {
  const chunk = new TextEncoder().encode('A'.repeat(64 * 1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === 0) controller.enqueue(new TextEncoder().encode('{"torrentFile":"'));
      if (sent >= bytes) {
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  const res = await fetch(`${urls.rmab()}${ADD_PATH(requestId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export const requestStatus = (id: string) => psql(`select status from requests where id = ${sqlStr(id)}`);
export const jobCount = (id: string, type?: string) =>
  Number(psql(`select count(*) from jobs where request_id = ${sqlStr(id)}${type ? ` and type = ${sqlStr(type)}` : ''}`));

export async function waitStatus(id: string, statuses: string[], what: string, timeoutMs = 300_000) {
  return waitFor(`${what} ${statuses.join('/')}`, async () => (statuses.includes(requestStatus(id)) ? requestStatus(id) : null), { timeoutMs, intervalMs: 2_000 });
}

/** The request's download_history rows: indexer, hash, title, client. */
export function historyRows(id: string): string[] {
  return psql(
    `select coalesce(indexer_name,'') || '|' || coalesce(indexer_id::text,'') || '|' || coalesce(torrent_hash,'') || '|' || coalesce(torrent_name,'') || '|' || coalesce(download_client,'')
     from download_history where request_id = ${sqlStr(id)} order by created_at`
  ).split('\n').filter(Boolean);
}

/** The history rows once the processor has written the Manual one (it writes after the client add). */
export async function manualHistory(id: string): Promise<string[]> {
  return waitFor(`Manual download_history row for ${id}`, async () => {
    const rows = historyRows(id);
    return rows.some((r) => r.startsWith('Manual|')) ? rows : null;
  }, { timeoutMs: 30_000 });
}

/** The download job's jobs.payload->'torrentFile' and whether the row's payload holds any of the base64. */
export function storedFilePayload(id: string, base64: string) {
  const stored = psql(`select coalesce(payload->'torrentFile','null'::jsonb)::text from jobs where request_id = ${sqlStr(id)} and type = 'download_torrent' order by created_at desc limit 1`);
  const leaked = psql(`select count(*) from jobs where request_id = ${sqlStr(id)} and position(${sqlStr(base64.slice(0, 64))} in payload::text) > 0`);
  return { stored, rowsHoldingBytes: Number(leaked) };
}

/** fake qBittorrent adds recorded after `since` that added (or tried to re-add) `hash`. */
export async function addsFor(since: number, hash: string) {
  const adds = (await callsSince(since, 'qbit')).filter((r) => r.path.endsWith('/torrents/add'));
  return {
    adds,
    added: adds.filter((r) => r.added?.some((a) => a.hash === hash)),
    duplicates: adds.filter((r) => r.duplicates?.includes(hash)),
  };
}

/** Open a request's Actions menu on the admin dashboard. */
export async function openActions(page: Page, title: string) {
  await page.goto('/admin');
  const row = page.locator('tr', { hasText: title }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.getByTitle('Actions').click();
}

export async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
}
