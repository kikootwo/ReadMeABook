/**
 * Component: Import List Preview
 * Documentation: documentation/backend/services/list-sync.md
 *
 * Shows what a sync would do with each book on a list (already in the library, already requested,
 * filtered out, no Audible match, or would be requested) without requesting anything. Runs in the
 * background because matching uncached books takes a while; the screen polls for progress.
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { fetchListBooks } from './goodreads-list.provider';
import { deepFilter, needsMetadata, preFilter, toRules } from './filter';
import type { FilterRules } from './filter';
import { resolveListBook } from './match';
import { loadOwnedIndex, ownedHow } from './owned';

const logger = RMABLogger.create('ImportListPreview');
const AUDIBLE_DELAY_MS = 600;

export type PreviewStatus = 'in_library' | 'requested' | 'ignored' | 'filtered' | 'no_match' | 'would_request';

export interface PreviewRow {
  rank: number;
  title: string;
  author: string;
  asin?: string;
  status: PreviewStatus;
  detail?: string;
  rating?: number;
  minutes?: number;
}

export interface PreviewState {
  listId: string;
  state: 'running' | 'done' | 'error';
  done: number;
  total: number;
  startedAt: number;
  rows: PreviewRow[];
  counts: Record<PreviewStatus, number>;
  error?: string;
}

const NO_FILTER: FilterRules = {
  skipPartsAndSets: false, titleExcludePatterns: [], authorExcludePatterns: [], requireAudibleAsin: true,
  allowAbridged: true, minRuntimeMinutes: 0, maxRuntimeMinutes: 0, minPublicationYear: 0, maxPublicationYear: 0,
  allowedLanguages: [], excludedPublishers: [], excludedNarrators: [], excludedGenres: [], includedGenres: [],
  minAudibleRating: 0,
};

const previews = new Map<string, PreviewState>();

export function getPreview(listId: string): PreviewState | null {
  return previews.get(listId) ?? null;
}

function emptyCounts(): Record<PreviewStatus, number> {
  return { in_library: 0, requested: 0, ignored: 0, filtered: 0, no_match: 0, would_request: 0 };
}

/** Start (or return the running) preview for a list. */
export function startPreview(listId: string): PreviewState {
  const existing = previews.get(listId);
  if (existing?.state === 'running') return existing;

  const state: PreviewState = { listId, state: 'running', done: 0, total: 0, startedAt: Date.now(), rows: [], counts: emptyCounts() };
  previews.set(listId, state);
  void runPreview(listId, state).catch((error) => {
    state.state = 'error';
    state.error = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Preview failed for list ${listId}: ${state.error}`);
  });
  return state;
}

async function runPreview(listId: string, state: PreviewState): Promise<void> {
  const list = await prisma.importList.findUnique({ where: { id: listId }, include: { filterProfile: true } });
  if (!list) throw new Error('Import list not found');
  const rules = list.filterProfile ? toRules(list.filterProfile) : NO_FILTER;

  const [owned, requests, admin] = await Promise.all([
    loadOwnedIndex(),
    prisma.request.findMany({
      where: { type: 'audiobook', deletedAt: null, status: { notIn: ['cancelled', 'denied'] } },
      select: { audiobook: { select: { audibleAsin: true } } },
    }),
    prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } }),
  ]);
  const requested = new Set(requests.map((r) => r.audiobook?.audibleAsin).filter((a): a is string => !!a));
  const ignored = new Set(
    admin ? (await prisma.ignoredAudiobook.findMany({ where: { userId: admin.id }, select: { asin: true } })).map((i) => i.asin) : [],
  );

  const { books } = await fetchListBooks(list.listId, list.topN);
  state.total = books.length;

  for (const book of books) {
    const row: PreviewRow = { rank: book.rank, title: book.title, author: book.author, status: 'would_request' };
    const dropped = preFilter(book.title, book.author, rules);
    if (dropped) {
      row.status = 'filtered';
      row.detail = dropped;
    } else {
      const resolved = await resolveListBook(book);
      if (resolved.searched) await new Promise((resolve) => setTimeout(resolve, AUDIBLE_DELAY_MS));
      const meta = resolved.meta;
      if (!meta) {
        row.status = 'no_match';
        row.detail = 'no Audible match';
      } else {
        row.asin = meta.asin;
        row.rating = meta.rating;
        row.minutes = meta.durationMinutes;
        const reason = needsMetadata(rules) ? deepFilter(meta, rules) : null;
        const how = ownedHow(owned, [{ asin: meta.asin, title: meta.title, author: meta.author }, { title: book.title, author: book.author }]);
        if (reason) {
          row.status = 'filtered';
          row.detail = reason;
        } else if (how) {
          row.status = 'in_library';
          row.detail = how === 'asin' ? undefined : 'matched by title and author';
        } else if (requested.has(meta.asin)) {
          row.status = 'requested';
        } else if (ignored.has(meta.asin)) {
          row.status = 'ignored';
        }
      }
    }
    state.rows.push(row);
    state.counts[row.status]++;
    state.done++;
  }
  state.state = 'done';
}
