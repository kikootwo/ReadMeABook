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

import { Prisma } from '@/generated/prisma/client';
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

/** DB column of every LIBRARY_ROW_SELECT field (the row version hashes exactly these; a test pins it). */
export const LIBRARY_ROW_COLUMNS: Record<keyof typeof LIBRARY_ROW_SELECT, string> = {
  id: 'id',
  plexGuid: 'plex_guid',
  title: 'title',
  author: 'author',
  narrator: 'narrator',
  duration: 'duration',
  year: 'year',
  asin: 'asin',
  addedAt: 'added_at',
  createdAt: 'created_at',
  cachedLibraryCoverPath: 'cached_library_cover_path',
};

type RequestSelect = typeof LIBRARY_REQUEST_SELECT;

/** DB columns of every LIBRARY_REQUEST_SELECT field, per table (the requests version hashes these). */
export const LIBRARY_REQUEST_COLUMNS: {
  request: Record<Exclude<keyof RequestSelect, 'user' | 'audiobook'>, string>;
  user: Record<keyof RequestSelect['user']['select'], string>;
  audiobook: Record<keyof RequestSelect['audiobook']['select'], string>;
} = {
  request: {
    id: 'id',
    audiobookId: 'audiobook_id',
    type: 'type',
    status: 'status',
    progress: 'progress',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    completedAt: 'completed_at',
    releaseDate: 'release_date',
    errorMessage: 'error_message',
    deletedAt: 'deleted_at',
  },
  user: { id: 'id', plexUsername: 'plex_username', deletedAt: 'deleted_at' },
  audiobook: {
    id: 'id',
    audibleAsin: 'audible_asin',
    title: 'title',
    author: 'author',
    narrator: 'narrator',
    series: 'series',
    seriesPart: 'series_part',
    year: 'year',
    plexGuid: 'plex_guid',
    absItemId: 'abs_item_id',
    libraryAsin: 'library_asin',
    coverArtUrl: 'cover_art_url',
  },
};

/** `alias.column, ...` from constant column maps (never user input). */
function columnList(alias: string, columns: Record<string, string>): string {
  return Object.values(columns)
    .map((c) => `${alias}.${c}`)
    .join(', ');
}

/** count + order-independent sum of a 64-bit hash of each record's text form (row() keeps NULL distinct from ''). */
async function contentVersion(query: Prisma.Sql): Promise<string> {
  const [result] = await prisma.$queryRaw<{ n: number; h: string }[]>(query);
  return `${result?.n ?? 0}:${result?.h ?? '0'}`;
}

/**
 * Load 1's version: a checksum of exactly the selected columns of the library's committed rows. Any
 * insert, delete or change of a selected value moves it, whatever its updated_at says (late commits,
 * same-millisecond writes, raw SQL); a write that changes nothing selected (the recently-added check
 * stamping last_scanned_at, a scan rewriting a row unchanged) leaves it, so the snapshot holds.
 */
export async function libraryRowsVersion(libraryId: string): Promise<string> {
  const columns = Prisma.raw(columnList('p', LIBRARY_ROW_COLUMNS));
  return contentVersion(Prisma.sql`
    select count(*)::int as n,
           coalesce(sum(hashtextextended(row(${columns})::text, 0)::numeric), 0)::text as h
    from plex_library p
    where p.plex_library_id = ${libraryId}`);
}

/** Load 2's version: the same checksum over the qualifying requests joined to their user and audiobook. */
export async function libraryRequestsVersion(): Promise<string> {
  const { request, user, audiobook } = LIBRARY_REQUEST_COLUMNS;
  const columns = Prisma.raw([columnList('r', request), columnList('u', user), columnList('a', audiobook)].join(', '));
  return contentVersion(Prisma.sql`
    select count(*)::int as n,
           coalesce(sum(hashtextextended(row(${columns})::text, 0)::numeric), 0)::text as h
    from requests r
    join users u on u.id = r.user_id
    join audiobooks a on a.id = r.audiobook_id
    where r.type = 'audiobook' and r.deleted_at is null and r.status <> 'cancelled'`);
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
  id: string;
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
    select: { id: true, audiobookId: true, status: true, progress: true, updatedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/** Every qualifying request of these books (id and createdAt only): live mode picks full mode's primary. */
export async function loadBookRequests(audiobookIds: string[]): Promise<{ id: string; audiobookId: string; createdAt: Date }[]> {
  if (audiobookIds.length === 0) return [];
  return prisma.request.findMany({
    where: { ...LIBRARY_REQUEST_WHERE, audiobookId: { in: audiobookIds } },
    select: { id: true, audiobookId: true, createdAt: true },
  });
}
