/**
 * Component: Request Detail Query Shapes (GET /api/requests/[id])
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Non-admin callers (owners, API tokens) get an explicit field list that leaves out
 * internal job/download data: Job.payload/result/stackTrace,
 * DownloadHistory.magnetLink/torrentUrl/downloadPath, Audiobook.filePath and
 * Request.selectedTorrent. Request.placedEbookFiles is left out for every caller.
 * Both shapes go through withRequestLibraryDisplay: a followed audiobook request (#325a) shows
 * the linked library item's title, author, narrator and cover, and `audiobook.libraryAsin` is the
 * effective value (null when the overlay does not apply).
 */

import type { Prisma } from '@/generated/prisma/client';
import { loadLinkedRows, withLibraryDisplay, type DisplayAudiobook, type DisplayRequest } from '@/lib/services/library/library-display';

const LATEST_SELECTED_DOWNLOAD = { where: { selected: true }, take: 1 } as const;
const RECENT_JOBS = { orderBy: { createdAt: 'desc' }, take: 5 } as const;

export const ADMIN_REQUEST_DETAIL_INCLUDE = {
  audiobook: { omit: { libraryAsin: false } }, // read by withRequestLibraryDisplay (#325a)
  user: { select: { id: true, plexUsername: true } },
  downloadHistory: LATEST_SELECTED_DOWNLOAD,
  jobs: RECENT_JOBS,
} satisfies Prisma.RequestInclude;

export const OWNER_REQUEST_DETAIL_SELECT = {
  id: true,
  userId: true,
  audiobookId: true,
  status: true,
  progress: true,
  priority: true,
  errorMessage: true,
  searchAttempts: true,
  downloadAttempts: true,
  importAttempts: true,
  maxImportRetries: true,
  ebookAutoRetryCount: true,
  lastSearchAt: true,
  customSearchTerms: true,
  lastImportAt: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  releaseDate: true,
  type: true,
  parentRequestId: true,
  deletedAt: true,
  // Same fields as the admin view minus the library file path (GET /api/requests strips it too)
  audiobook: {
    select: {
      id: true,
      audibleAsin: true,
      title: true,
      author: true,
      narrator: true,
      description: true,
      coverArtUrl: true,
      year: true,
      series: true,
      seriesPart: true,
      seriesAsin: true,
      status: true,
      fileFormat: true,
      fileSizeBytes: true,
      plexGuid: true,
      plexLibraryId: true,
      absItemId: true,
      libraryAsin: true, // effective value, set by withRequestLibraryDisplay
      filesHash: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  },
  user: { select: { id: true, plexUsername: true } },
  downloadHistory: {
    ...LATEST_SELECTED_DOWNLOAD,
    select: {
      id: true,
      requestId: true,
      indexerName: true,
      indexerId: true,
      torrentName: true,
      torrentHash: true,
      nzbId: true,
      torrentSizeBytes: true,
      seeders: true,
      leechers: true,
      qualityScore: true,
      selected: true,
      downloadClient: true,
      downloadClientId: true,
      downloadStatus: true,
      downloadError: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  },
  jobs: {
    ...RECENT_JOBS,
    select: {
      id: true,
      requestId: true,
      type: true,
      status: true,
      priority: true,
      attempts: true,
      maxAttempts: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.RequestSelect;

/**
 * Drop the stored release pick from a request returned to a non-admin. It is
 * internal (download link) and only admins act on it.
 */
export function hideStoredPick<T>(record: T, role: string | undefined): T {
  const shown = hidePlacementRecord(record);
  if (role === 'admin' || !shown || typeof shown !== 'object') return shown;
  return { ...shown, selectedTorrent: undefined };
}

/**
 * Drop the ebook placement record (Request.placedEbookFiles, #497: absolute
 * library paths and hashes) from a request returned to any caller, admins
 * included. Only the request delete reads it.
 */
export function hidePlacementRecord<T>(record: T): T {
  if (!record || typeof record !== 'object') return record;
  return { ...record, placedEbookFiles: undefined };
}

/**
 * The detail as shown (#325a): the library overlay on the audiobook of an audiobook request, and
 * the effective `audiobook.libraryAsin`. `audibleAsin`, series, year and description stay as requested.
 */
export async function withRequestLibraryDisplay<R extends DisplayRequest & { audiobook?: DisplayAudiobook | null }>(
  record: R
): Promise<R> {
  if (!record.audiobook) return record;
  const rows = await loadLinkedRows([record]);
  return { ...record, audiobook: withLibraryDisplay(record.audiobook, rows, record) };
}
