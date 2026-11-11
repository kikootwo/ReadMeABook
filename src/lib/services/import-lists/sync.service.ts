/**
 * Component: Import List Sync Service
 * Documentation: documentation/backend/services/list-sync.md
 *
 * Syncs one system-wide import list: read the list, filter, match to Audible, then request
 * the books you do not have. Library, in-progress, ignored and removed-book checks are done by
 * the shared request creator, so lists behave like any other automatic request source.
 */

import { statfs } from 'node:fs/promises';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { getConfigService } from '@/lib/services/config.service';
import { createRequestForUser } from '@/lib/services/request-creator.service';
import { getMediaDir } from '@/lib/utils/media-dir';
import { fetchListBooks } from './goodreads-list.provider';
import { deepFilter, needsMetadata, preFilter, SEED_PROFILES, toRules } from './filter';
import type { FilterRules } from './filter';
import { resolveListBook } from './match';
import { loadOwnedIndex, ownedHow } from './owned';

const logger = RMABLogger.create('ImportListSync');

export const MIN_FREE_GB_KEY = 'import_lists.min_free_gb';
export const MAX_REQUESTS_PER_HOUR_KEY = 'import_lists.max_requests_per_hour';
export const DEFAULT_MIN_FREE_GB = 300;
export const DEFAULT_MAX_REQUESTS_PER_HOUR = 25;

const HOUR_MS = 3_600_000;
const AUDIBLE_DELAY_MS = 600;
const MAX_CONSECUTIVE_FAILURES = 5;
const SAMPLE_LIMIT = 6;
/** Rules used when a list has no filter profile: keep everything that matches Audible. */
const NO_FILTER: FilterRules = {
  skipPartsAndSets: false, titleExcludePatterns: [], authorExcludePatterns: [], requireAudibleAsin: true,
  allowAbridged: true, minRuntimeMinutes: 0, maxRuntimeMinutes: 0, minPublicationYear: 0, maxPublicationYear: 0,
  allowedLanguages: [], excludedPublishers: [], excludedNarrators: [], excludedGenres: [], includedGenres: [],
  minAudibleRating: 0,
};

export class ImportListSyncInProgressError extends Error {
  constructor() {
    super('A sync is already running for this list');
  }
}

export interface RunBudget {
  /** Requests still allowed in this run */
  remaining: number;
}

export interface SyncSummary {
  logId: string;
  fetched: number;
  newOnList: number;
  filtered: number;
  missed: number;
  alreadyHave: number;
  skipped: number;
  requested: number;
  stoppedReason: string | null;
  errorMessage: string | null;
}

export async function getSettings(): Promise<{ minFreeGb: number; maxRequestsPerHour: number }> {
  const values = await getConfigService().getMany([MIN_FREE_GB_KEY, MAX_REQUESTS_PER_HOUR_KEY]);
  const minFree = Number(values[MIN_FREE_GB_KEY]);
  const perHour = Number(values[MAX_REQUESTS_PER_HOUR_KEY]);
  return {
    minFreeGb: Number.isFinite(minFree) && values[MIN_FREE_GB_KEY] !== null ? minFree : DEFAULT_MIN_FREE_GB,
    maxRequestsPerHour: Number.isFinite(perHour) && values[MAX_REQUESTS_PER_HOUR_KEY] !== null ? perHour : DEFAULT_MAX_REQUESTS_PER_HOUR,
  };
}

/** Free space (GB) on the media library, or null when it cannot be read. */
export async function getFreeGb(): Promise<number | null> {
  try {
    const stats = await statfs(await getMediaDir());
    return (Number(stats.bavail) * Number(stats.bsize)) / 1e9;
  } catch {
    return null;
  }
}

/** A message when automatic requests should pause because free space is below the guard, otherwise null. */
export async function automaticRequestsPausedForDisk(): Promise<string | null> {
  try {
    const [free, { minFreeGb }] = await Promise.all([getFreeGb(), getSettings()]);
    if (free === null || free >= minFreeGb) return null;
    return `Automatic requests are paused: ${Math.round(free)} GB free, guard is ${minFreeGb} GB`;
  } catch {
    // A guard that cannot read the disk or its settings must never block requests
    return null;
  }
}

/** Create the built-in filter profiles if they are missing. */
export async function ensureSeedProfiles(): Promise<void> {
  for (const seed of SEED_PROFILES) {
    const existing = await prisma.importListFilterProfile.findUnique({ where: { seedSlug: seed.seedSlug } });
    if (!existing) {
      await prisma.importListFilterProfile.create({ data: { seedSlug: seed.seedSlug, name: seed.name, ...seed.data } });
    }
  }
}

/** How many requests the hourly allowance still permits (counting what lists requested in the last hour). */
export async function computeHourlyBudget(): Promise<RunBudget> {
  const { maxRequestsPerHour } = await getSettings();
  const recent = await prisma.importListSyncLog.aggregate({
    where: { startedAt: { gt: new Date(Date.now() - HOUR_MS) } },
    _sum: { requested: true },
  });
  return { remaining: Math.max(0, maxRequestsPerHour - (recent._sum.requested ?? 0)) };
}

function addSample(samples: Record<string, string[]>, key: string, text: string): void {
  const bucket = (samples[key] ??= []);
  if (bucket.length < SAMPLE_LIMIT) bucket.push(text);
}

async function previousIds(importListId: string): Promise<Set<string> | null> {
  const last = await prisma.importListSyncLog.findFirst({
    where: { importListId, completedAt: { not: null }, errorMessage: null },
    orderBy: { startedAt: 'desc' },
  });
  if (!last?.details) return null;
  try {
    const ids = JSON.parse(last.details).ids;
    return Array.isArray(ids) ? new Set(ids.map(String)) : null;
  } catch {
    return null;
  }
}

/**
 * Sync one list. Pass a budget for scheduled runs; omit it for a manual "sync now", which is
 * limited only by the list's own per-sync cap and the free-space guard.
 */
export async function syncImportList(listId: string, budget?: RunBudget): Promise<SyncSummary> {
  const list = await prisma.importList.findUnique({ where: { id: listId }, include: { filterProfile: true } });
  if (!list) throw new Error('Import list not found');

  const running = await prisma.importListSyncLog.findFirst({
    where: { importListId: list.id, completedAt: null, startedAt: { gt: new Date(Date.now() - 2 * HOUR_MS) } },
  });
  if (running) throw new ImportListSyncInProgressError();

  const log = await prisma.importListSyncLog.create({ data: { importListId: list.id } });
  const c = { fetched: 0, newOnList: 0, filtered: 0, missed: 0, alreadyHave: 0, skipped: 0, requested: 0 };
  const samples: Record<string, string[]> = {};
  let ids: string[] = [];
  let sourceSize: number | undefined;
  let stoppedReason: string | null = null;
  let errorMessage: string | null = null;

  try {
    const rules = list.filterProfile ? toRules(list.filterProfile) : NO_FILTER;
    const { minFreeGb } = await getSettings();
    const requester = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
    if (list.autoRequest && !requester) throw new Error('No admin user to own the requests');

    const fetched = await fetchListBooks(list.listId, list.topN);
    sourceSize = fetched.size;
    ids = fetched.books.map((b) => b.bookId);
    c.fetched = fetched.books.length;
    if (c.fetched === 0) throw new Error('Goodreads returned no books for this list');

    const owned = await loadOwnedIndex();
    const before = await previousIds(list.id);
    if (before) c.newOnList = ids.filter((id) => !before.has(id)).length;
    logger.info(`List "${list.name}": ${c.fetched} books read, ${c.newOnList} new since last sync`);

    let failures = 0;
    for (const book of fetched.books) {
      const label = `${book.title} — ${book.author}`;

      const dropped = preFilter(book.title, book.author, rules);
      if (dropped) {
        c.filtered++;
        addSample(samples, 'filtered', `${label} (${dropped})`);
        continue;
      }

      let resolved;
      try {
        resolved = await resolveListBook(book);
        failures = 0;
      } catch (error) {
        failures++;
        logger.warn(`Audible lookup failed for "${book.title}": ${error instanceof Error ? error.message : 'unknown error'}`);
        if (failures >= MAX_CONSECUTIVE_FAILURES) throw new Error('Audible lookups keep failing; try again later');
        continue;
      }
      if (resolved.searched) await new Promise((resolve) => setTimeout(resolve, AUDIBLE_DELAY_MS));

      const meta = resolved.meta;
      if (!meta) {
        c.missed++;
        addSample(samples, 'missed', label);
        continue;
      }
      if (needsMetadata(rules)) {
        const reason = deepFilter(meta, rules);
        if (reason) {
          c.filtered++;
          addSample(samples, 'filtered', `${label} (${reason})`);
          continue;
        }
      }

      if (!list.autoRequest) continue;

      // Already in the library by ASIN, or the same title and author under another ASIN
      if (ownedHow(owned, [{ asin: meta.asin, title: meta.title, author: meta.author }, { title: book.title, author: book.author }])) {
        c.alreadyHave++;
        continue;
      }

      if (list.maxRequestsPerSync > 0 && c.requested >= list.maxRequestsPerSync) {
        stoppedReason = 'this list\'s request cap for one sync was reached';
        break;
      }
      if (budget && budget.remaining <= 0) {
        stoppedReason = 'the hourly request allowance was used up';
        break;
      }
      const free = await getFreeGb();
      if (free !== null && free < minFreeGb) {
        stoppedReason = `low disk space (${Math.round(free)} GB free, guard is ${minFreeGb} GB)`;
        break;
      }

      const result = await createRequestForUser(
        requester!.id,
        { asin: meta.asin, title: meta.title, author: meta.author, narrator: meta.narrator, description: meta.description, coverArtUrl: meta.coverArtUrl },
        { automatic: true },
      );
      if (result.success) {
        c.requested++;
        if (budget) budget.remaining--;
        addSample(samples, 'requested', label);
      } else if (result.reason === 'already_available' || result.reason === 'being_processed' || result.reason === 'duplicate') {
        c.alreadyHave++;
      } else if (result.reason === 'low_disk_space') {
        stoppedReason = result.message;
        break;
      } else if (result.reason === 'user_not_found') {
        throw new Error('The admin user that owns list requests no longer exists');
      } else {
        c.skipped++;
        addSample(samples, 'skipped', `${label} (${result.reason.replace(/_/g, ' ')})`);
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`List "${list.name}" sync failed: ${errorMessage}`);
  }

  const now = new Date();
  await prisma.importListSyncLog.update({
    where: { id: log.id },
    data: { ...c, completedAt: now, stoppedReason, errorMessage, details: JSON.stringify({ samples, ids }) },
  });

  // A run cut short by an allowance or the disk guard comes due again in about an hour
  // (instead of waiting a full interval) so the rest of the list is picked up gradually.
  const resumeSoon = !errorMessage && stoppedReason !== null;
  const lastSuccessful = errorMessage
    ? list.lastSuccessfulSyncAt
    : resumeSoon
      ? new Date(now.getTime() - Math.max(0, list.syncIntervalHours - 1) * HOUR_MS)
      : now;
  await prisma.importList.update({
    where: { id: list.id },
    data: { lastSyncedAt: now, lastSuccessfulSyncAt: lastSuccessful, lastError: errorMessage, sourceSize: sourceSize ?? list.sourceSize },
  });

  logger.info(
    `List "${list.name}" done: ${c.requested} requested, ${c.alreadyHave} already have, ${c.filtered} filtered, ${c.missed} no match` +
      (stoppedReason ? ` (stopped: ${stoppedReason})` : ''),
  );
  return { logId: log.id, ...c, stoppedReason, errorMessage };
}

/** True when a list should be synced by the scheduled sweep. */
export function isDue(list: { enabled: boolean; syncIntervalHours: number; lastSyncedAt: Date | null; lastSuccessfulSyncAt: Date | null; lastError: string | null }, now = Date.now()): boolean {
  if (!list.enabled) return false;
  // Back off for an hour after a failure instead of retrying every sweep
  if (list.lastError && list.lastSyncedAt && now - list.lastSyncedAt.getTime() < HOUR_MS) return false;
  if (!list.lastSuccessfulSyncAt) return true;
  return now >= list.lastSuccessfulSyncAt.getTime() + list.syncIntervalHours * HOUR_MS;
}
