/**
 * Component: Request Detail Query Shapes (GET /api/requests/[id])
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Every caller gets the job summary (JOB_SUMMARY_SELECT: no Job.payload/result/stackTrace) and
 * the selected download row without DownloadHistory.magnetLink/torrentUrl/downloadPath.
 * Non-admin callers (owners, API tokens) get an explicit field list that also leaves out
 * Audiobook.filePath and Request.selectedTorrent. Request.placedEbookFiles,
 * Request.approvalBypassedBy and Request.discordCards are left out for every caller.
 * Both shapes go through withRequestLibraryDisplay: a followed audiobook request (#325a) shows
 * the linked library item's title, author, narrator and cover, and `audiobook.libraryAsin` is the
 * effective value (null when the overlay does not apply).
 */

import type { Prisma } from '@/generated/prisma/client';
import { loadLinkedRows, withLibraryDisplay, type DisplayAudiobook, type DisplayRequest } from '@/lib/services/library/library-display';

// Newest first: a request that moved on after a client failure keeps earlier selected rows (#332)
const LATEST_SELECTED_DOWNLOAD = { where: { selected: true }, orderBy: { createdAt: 'desc' }, take: 1 } as const;
const JOB_SUMMARY_SELECT = {
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
} as const;
const RECENT_JOBS = { orderBy: { createdAt: 'desc' }, take: 5, select: JOB_SUMMARY_SELECT } as const;

export const ADMIN_REQUEST_DETAIL_INCLUDE = {
  // libraryAsin: read by withRequestLibraryDisplay (#325a); fileSizeBytes: the route converts it (toJsonSafe)
  audiobook: { omit: { libraryAsin: false, fileSizeBytes: false } },
  user: { select: { id: true, plexUsername: true } },
  downloadHistory: { ...LATEST_SELECTED_DOWNLOAD, omit: { magnetLink: true, torrentUrl: true, downloadPath: true } },
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
  explicit: true, // #542
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
  jobs: RECENT_JOBS,
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
 * library paths and hashes), the approval record (Request.approvalBypassedBy,
 * #232) and the Discord message references (Request.discordCards) from a request
 * returned to any caller, admins included. Only the request delete reads the
 * first; only the server reads the other two.
 */
export function hidePlacementRecord<T>(record: T): T {
  if (!record || typeof record !== 'object') return record;
  return { ...record, placedEbookFiles: undefined, approvalBypassedBy: undefined, discordCards: undefined };
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
