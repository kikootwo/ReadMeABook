/**
 * Component: E2E regression #332 helpers (inline scenarios, grabs, blocks, notifications per request)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { expect } from '@playwright/test';
import { ctl, fakeArr, type Recorded } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';

/** Load an inline scenario definition into fake-arr */
export async function loadScenario(definition: Record<string, unknown>) {
  const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition }) });
  expect(res.ok, `load scenario ${String(definition.name)}`).toBe(true);
  return (await res.json()) as { releases: string[] };
}

const releaseOf = (r: Recorded) => {
  try {
    return JSON.parse(Buffer.from(String(r.query.link), 'base64url').toString('utf8')).r as string;
  } catch {
    return undefined;
  }
};

/** Prowlarr grabs (`/{indexer}/download`) per release id */
export async function grabCounts(ids: string[]): Promise<Record<string, number>> {
  const grabs = (await fakeArr.requests()).filter((r) => r.service === 'prowlarr' && /^\/\d+\/download$/.test(r.path));
  return Object.fromEntries(ids.map((id) => [id, grabs.filter((r) => releaseOf(r) === id).length]));
}

const rows = (sql: string) => psql(sql).split('\n').filter(Boolean);

export const status = (requestId: string) =>
  psql(`select coalesce(status,'') || '|' || coalesce(error_message,'') from requests where id = ${sqlStr(requestId)}`);

export const blockedFor = (requestId: string) =>
  rows(`select release_name from blocked_releases where request_id = ${sqlStr(requestId)} order by created_at`);

/** "<release> -> <status>" per download, oldest first */
export const historyOf = (requestId: string) =>
  rows(`select torrent_name || ' -> ' || coalesce(download_status,'') from download_history where request_id = ${sqlStr(requestId)} order by created_at`);

export const requestErrors = (requestId: string) =>
  rows(`select payload->>'message' from jobs where request_id = ${sqlStr(requestId)} and type = 'send_notification' and payload->>'event' = 'request_error' order by created_at`);

/** The ranking's pick per search, from the job log */
export const selectedReleases = (requestId: string) =>
  rows(`select je.message from job_events je join jobs j on j.id = je.job_id where j.request_id = ${sqlStr(requestId)} and je.message like 'Selected best result:%' order by je.created_at`);

export const searchJobs = (requestId: string) =>
  rows(`select coalesce(bull_job_id,'') || ' clientFailures=' || coalesce(payload->>'clientFailures','-') from jobs where request_id = ${sqlStr(requestId)} and type = 'search_indexers' order by created_at`);
