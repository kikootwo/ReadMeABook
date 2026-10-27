/**
 * Component: SABnzbd duplicate NZB lookup
 * Documentation: documentation/phase3/sabnzbd.md
 *
 * SABnzbd's "Detect duplicate downloads" either refuses an addfile (Discard), adds the new
 * job paused (Pause, or a copy already in the queue on 4.2+), or fails it straight to
 * history with "Duplicate NZB" (Fail). Its nzo_ids only ever name the new job, so the
 * existing job is found by name (the release title, or a specific upload name; never a
 * generic one like `download.nzb`) and category. A found job is tracked while it is queued
 * or post-processing, taken over when it finished and its files are on disk, and
 * otherwise the release is rejected for the blocklist.
 */

import fs from 'fs/promises';
import { RMABLogger } from '@/lib/utils/logger';
import { PathMapper, type PathMappingConfig } from '@/lib/utils/path-mapper';
import { UnusableDownloadSourceError } from '../interfaces/download-client.interface';
import type { HistoryItem, QueueItem } from './sabnzbd.service';

const logger = RMABLogger.create('SABnzbd');

/** Blocklist reason for a duplicate SABnzbd finished earlier whose files are gone. */
export const DUPLICATE_FILES_GONE = 'Already in SABnzbd, files gone';

export interface HistoryQuery {
  search?: string;
  nzoIds?: string[];
  /** SABnzbd 4.3+: only archived jobs (RMAB archives the jobs it imported) */
  archive?: boolean;
  limit?: number;
}

/** The SABnzbd calls the lookup needs (implemented by SABnzbdService). */
export interface SabJobApi {
  getQueue(): Promise<QueueItem[]>;
  queryHistory(query: HistoryQuery): Promise<HistoryItem[]>;
  deleteNZB(nzbId: string, deleteFiles?: boolean): Promise<void>;
  archiveFromHistory(nzbId: string): Promise<void>;
}

export type ExistingJob =
  | { where: 'queue'; item: QueueItem }
  | { where: 'history'; item: HistoryItem };

/** The job name SABnzbd gives an upload: the file name without `.nzb` (and `.gz` / `.bz2`). */
export function nzbJobName(filename: string): string {
  return filename.replace(/\.nzb(\.gz|\.bz2)?$/i, '');
}

/** Letters and digits only, lowercased: SABnzbd sanitizes folder names and matches names case-insensitively. */
function looseName(name: string): string {
  return (name || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function sameJobName(a: string, b: string): boolean {
  const left = looseName(a);
  return left !== '' && left === looseName(b);
}

/** Upload names that say nothing about the book (fetch fallbacks, indexer path segments) */
const GENERIC_NAMES = new Set(['download', 'api', 'nzb', 'get', 'getnzb', 'file', 'files', 'index', 'fetch', 'release']);

function words(name: string): Set<string> {
  return new Set((name || '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2));
}

/**
 * Whether a job name can identify this release: not a generic name (`download.nzb` fallback,
 * `api`, a bare number) and, when the release title is known, sharing a title word with it.
 */
export function isSpecificJobName(jobName: string, releaseTitle?: string): boolean {
  const loose = looseName(jobName);
  if (!loose || GENERIC_NAMES.has(loose) || /^\d+$/.test(loose)) return false;
  if (!releaseTitle) return true;
  const titleWords = words(releaseTitle);
  return [...words(jobName)].some((word) => titleWords.has(word));
}

/** Names an existing job may carry for this release: the release title, and the upload name when it is specific. */
export function lookupNames(jobName: string, releaseTitle?: string): string[] {
  const names = releaseTitle && looseName(releaseTitle) ? [releaseTitle] : [];
  if (isSpecificJobName(jobName, releaseTitle) && !names.some((name) => sameJobName(name, jobName))) {
    names.push(jobName);
  }
  return names;
}

/** History search term: SABnzbd treats `*` as a wildcard, so punctuation SABnzbd may have changed still matches. */
export function historySearchTerm(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '*');
}

const statusIs = (status: string | undefined, value: string) => (status || '').toLowerCase() === value;

/**
 * Find the job SABnzbd holds under one of these names (see `lookupNames`) in this category
 * (failed jobs excluded, as SABnzbd's own duplicate check does). No names: no lookup. Prefers
 * a job still downloading, then a history job (current, then archived), then a paused queue job.
 */
export async function findExistingJob(
  sab: SabJobApi,
  names: string[],
  category: string,
  excludeId?: string
): Promise<ExistingJob | null> {
  if (names.length === 0) return null;
  const matches = (jobName: string, jobCategory: string, id: string) =>
    id !== excludeId
    && names.some((name) => sameJobName(jobName, name))
    && (jobCategory || '').toLowerCase() === category.toLowerCase();

  const queued = (await sab.getQueue()).filter((item) => matches(item.name, item.category, item.nzbId));
  const active = queued.find((item) => !statusIs(item.status, 'paused'));
  if (active) return { where: 'queue', item: active };

  for (const archive of [false, true]) {
    for (const name of names) {
      const rows = await sab.queryHistory({ search: historySearchTerm(name), archive, limit: 50 });
      const row = rows.find((item) => matches(item.name, item.category, item.nzbId) && !statusIs(item.status, 'failed'));
      if (row) return { where: 'history', item: row };
    }
  }

  return queued[0] ? { where: 'queue', item: queued[0] } : null;
}

/** The job to track for an existing SABnzbd job; `paused` when it waits paused in the queue. */
export interface ResolvedJob {
  id: string;
  paused: boolean;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The nzo_id to track for an existing job. A finished job is used only when its files are on
 * disk after path mapping (the monitor then imports them); otherwise this throws an
 * UnusableDownloadSourceError with a blocklist reason, so the next release is tried.
 */
export async function resolveExistingJob(job: ExistingJob, pathMapping: PathMappingConfig): Promise<ResolvedJob> {
  if (job.where === 'queue' || !statusIs(job.item.status, 'completed')) {
    logger.info(`Tracking the job SABnzbd already holds for "${job.item.name}": ${job.item.nzbId} (${job.item.status})`);
    return { id: job.item.nzbId, paused: job.where === 'queue' && statusIs(job.item.status, 'paused') };
  }

  const localPath = job.item.storage ? PathMapper.transform(job.item.storage, pathMapping) : '';
  if (localPath && await pathExists(localPath)) {
    logger.info(`SABnzbd already finished "${job.item.name}" (${job.item.nzbId}); importing its files from ${localPath}`);
    return { id: job.item.nzbId, paused: false };
  }

  throw new UnusableDownloadSourceError(
    `SABnzbd already has "${job.item.name}" as a finished download, but its files are not on disk${localPath ? ` (${localPath})` : ''}`,
    DUPLICATE_FILES_GONE
  );
}

/**
 * After SABnzbd accepted an add: was the new job set aside as a duplicate? A paused new job
 * (Pause mode, or a copy already queued) is removed; a new job already in history (Fail mode)
 * is archived. Returns the existing job, or null when the new job is the one to track.
 */
export async function duplicateOfNewJob(
  sab: SabJobApi,
  newId: string,
  names: string[],
  category: string
): Promise<ExistingJob | null> {
  const queued = (await sab.getQueue()).find((item) => item.nzbId === newId);
  if (queued && !statusIs(queued.status, 'paused')) {
    return null;
  }

  // Not paused or queued: a job only reaches history this fast when SABnzbd failed it on add
  const failedOnAdd = queued
    ? undefined
    : (await sab.queryHistory({ nzoIds: [newId], limit: 20 })).find((item) => item.nzbId === newId);
  if (!queued && (!failedOnAdd || statusIs(failedOnAdd.status, 'completed'))) {
    return null;
  }

  const existing = await findExistingJob(sab, names, category, newId);
  if (!existing) {
    return null;
  }

  logger.warn(`SABnzbd set "${existing.item.name}" aside as a duplicate of ${existing.item.nzbId}; removing the new job ${newId}`);
  try {
    // RMAB's own job from this add, with nothing downloaded
    await (queued ? sab.deleteNZB(newId, true) : sab.archiveFromHistory(newId));
  } catch (error) {
    logger.warn(`Could not remove the duplicate job ${newId}`, { error: error instanceof Error ? error.message : String(error) });
  }
  return existing;
}
