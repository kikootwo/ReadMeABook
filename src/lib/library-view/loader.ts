/**
 * Component: Library view loader (Prisma reads; explicit selects only)
 * Documentation: documentation/features/library-view.md
 *
 * Load 1 never selects plex_library.file_path (a real Audiobookshelf folder since #495), thumb_url
 * (Plex token) or summary. Load 2 never selects the server-only request/audiobook columns
 * (file_format, ebook_auto_retry_count, custom_search_terms, placed_ebook_files,
 * approval_bypassed_by, cancelled_at, auto_rerequest_count). libraryAsin/absItemId are read only
 * for the cover rule and never serialized.
 */

import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import {
  LIVE_ALWAYS_STATUSES,
  LIVE_RECENT_STATUSES,
  LIVE_RECENT_WINDOW_MS,
} from '@/lib/constants/request-statuses';
import type { LibraryRowRecord, RequestRecord } from './types';

export const LIBRARY_ROW_SELECT = {
  id: true,
  plexGuid: true,
  title: true,
  author: true,
  narrator: true,
  duration: true,
  year: true,
  asin: true,
  addedAt: true,
  createdAt: true,
  cachedLibraryCoverPath: true,
} as const;

/** Qualifying requests: audiobook type, not deleted, not cancelled (the route test asserts this). */
export const LIBRARY_REQUEST_WHERE = {
  type: 'audiobook',
  deletedAt: null,
  status: { not: 'cancelled' },
} as const;

export const LIBRARY_REQUEST_SELECT = {
  id: true,
  audiobookId: true,
  type: true,
  status: true,
  progress: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  releaseDate: true,
  errorMessage: true,
  deletedAt: true,
  user: { select: { id: true, plexUsername: true, deletedAt: true } },
  audiobook: {
    select: {
      id: true,
      audibleAsin: true,
      title: true,
      author: true,
      narrator: true,
      series: true,
      seriesPart: true,
      year: true,
      plexGuid: true,
      absItemId: true,
      libraryAsin: true,
      coverArtUrl: true,
    },
  },
} as const;

export interface ActiveLibrary {
  backend: 'plex' | 'audiobookshelf';
  libraryId: string | null;
}

/** The configured library (never audiobookshelf.ebook_library_id, which only picks a scan target). */
export async function resolveActiveLibrary(): Promise<ActiveLibrary> {
  const config = getConfigService();
  const backend = await config.getBackendMode();
  if (backend === 'audiobookshelf') {
    return { backend, libraryId: (await config.get('audiobookshelf.library_id')) || null };
  }
  const plex = await config.getPlexConfig();
  return { backend: 'plex', libraryId: plex.libraryId || null };
}

/**
 * Load 1's version: row count and newest updated_at for one library. Every plex_library write goes
 * through Prisma (@updatedAt, including updateMany), so any insert, update or delete changes it.
 */
export async function libraryRowsVersion(libraryId: string): Promise<string> {
  const agg = await prisma.plexLibrary.aggregate({
    where: { plexLibraryId: libraryId },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
}

/** Load 1: the active library's rows, in id order (cached by snapshot.ts). */
export async function loadLibraryRows(libraryId: string): Promise<LibraryRowRecord[]> {
  const rows = await prisma.plexLibrary.findMany({
    where: { plexLibraryId: libraryId },
    select: LIBRARY_ROW_SELECT,
    orderBy: { id: 'asc' },
  });
  return rows as LibraryRowRecord[];
}

/** Load 2: qualifying audiobook requests. Read fresh on every full-mode call. */
export async function loadLibraryRequests(): Promise<RequestRecord[]> {
  const requests = await prisma.request.findMany({
    where: LIBRARY_REQUEST_WHERE,
    select: LIBRARY_REQUEST_SELECT,
  });
  return requests as RequestRecord[];
}

/** audible_cache minutes by uppercase ASIN (request-only books; the duration sort). */
export async function loadDurations(asins: string[]): Promise<Map<string, number>> {
  if (asins.length === 0) return new Map();
  const cached = await prisma.audibleCache.findMany({
    where: { asin: { in: asins } },
    select: { asin: true, durationMinutes: true },
  });
  const minutes = new Map<string, number>();
  for (const c of cached) {
    if (c.durationMinutes != null) minutes.set(c.asin.toUpperCase(), c.durationMinutes);
  }
  return minutes;
}

export interface LiveRequestRecord {
  audiobookId: string;
  status: string;
  progress: number;
  updatedAt: Date;
  createdAt: Date;
}

/** Live audiobook requests only (status-indexed; no library rows, no merge). Newest first. */
export async function loadLiveRequests(now: number): Promise<LiveRequestRecord[]> {
  return prisma.request.findMany({
    where: {
      type: 'audiobook',
      deletedAt: null,
      OR: [
        { status: { in: [...LIVE_ALWAYS_STATUSES] } },
        { status: { in: [...LIVE_RECENT_STATUSES] }, updatedAt: { gte: new Date(now - LIVE_RECENT_WINDOW_MS) } },
      ],
    },
    select: { audiobookId: true, status: true, progress: true, updatedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}
