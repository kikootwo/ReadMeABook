/**
 * Component: Request Status Constants
 * Documentation: documentation/backend/database.md
 */

/** Terminal statuses indicating a request has been fulfilled and files are ready */
export const COMPLETED_STATUSES = ['available', 'downloaded'] as const;

/** Statuses from which a request can be cancelled (server-enforced and UI-gated) */
export const CANCELLABLE_STATUSES = [
  'pending',
  'searching',
  'downloading',
  'awaiting_search',
  'awaiting_approval',
  'awaiting_release',
] as const;

/**
 * Statuses a request has before (or instead of) an approval. A request that leaves one of
 * these without being approved is recorded in Request.approvalBypassedBy.
 */
export const UNAPPROVED_STATUSES = ['awaiting_approval', 'denied', 'cancelled'] as const;

/**
 * Bulk Import: a book with a request (any user's) in one of these statuses is shown as Requested
 * on the review screen and refused by the import (documentation/features/bulk-import.md).
 */
export const IMPORT_BLOCKING_STATUSES = [
  'pending', 'searching', 'downloading', 'processing',
  'awaiting_search', 'awaiting_import', 'awaiting_approval',
  'downloaded', 'available',
] as const;

/** The paths that can complete a request without its approval (ASIN match, manual and bulk import). */
export type ApprovalBypassPath = 'asin_match' | 'manual_import' | 'bulk_import';

/**
 * The Request.approvalBypassedBy value (`<path>:<fromStatus>`) for a request taken out of
 * `fromStatus` by `path`, or null when `fromStatus` is not an unapproved status.
 */
export function approvalBypassMark(path: ApprovalBypassPath, fromStatus: string): string | null {
  return (UNAPPROVED_STATUSES as readonly string[]).includes(fromStatus) ? `${path}:${fromStatus}` : null;
}

/**
 * Statuses where an own (or admin-acted) request can be advanced via Interactive
 * Search → Download by routing to /api/requests/[id]/select-torrent.
 * Outside this set, the modal falls back to today's create-new-request path.
 */
export const ADVANCEABLE_FROM_INTERACTIVE_SEARCH = [
  'pending',
  'failed',
  'awaiting_search',
  'awaiting_release',
] as const;

/**
 * Ebook request statuses where Interactive Search picks for that request via
 * /api/requests/[id]/interactive-search-ebook + select-ebook (the statuses
 * those routes accept for a direct ebook search).
 */
export const EBOOK_ADVANCEABLE_FROM_INTERACTIVE_SEARCH = [
  'pending',
  'failed',
  'awaiting_search',
] as const;

/** Statuses POST /api/requests/[id]/manual-search accepts (owner or admin). */
export const SEARCHABLE_STATUSES = [
  'pending',
  'failed',
  'awaiting_search',
  'awaiting_release',
] as const;

/**
 * Past searching: a download is under way or done (#591). A queued automatic search skips a
 * request in one of these (no `searching` write, nothing queued). Not COMPLETED_STATUSES:
 * that list lacks the two in-flight statuses, where a search would add a second download.
 */
export const PAST_SEARCH_STATUSES = ['downloading', 'processing', 'downloaded', 'available'] as const;

/** Audiobook request statuses POST /api/requests/[id]/fetch-ebook accepts (admin). */
export const EBOOK_FETCHABLE_STATUSES = ['downloaded', 'available'] as const;

/**
 * Library live set (documentation/features/library-view.md): requests in these statuses are
 * always polled by GET /api/library?live=1.
 */
export const LIVE_ALWAYS_STATUSES = ['pending', 'searching', 'downloading', 'processing'] as const;

/** Live only while the request's updatedAt is within LIVE_RECENT_WINDOW_MS. */
export const LIVE_RECENT_STATUSES = ['downloaded', 'awaiting_import'] as const;

/** How long a downloaded/awaiting_import request stays live after its last update. */
export const LIVE_RECENT_WINDOW_MS = 15 * 60 * 1000;

/**
 * What a processing request is doing (#216), shown beside its badge. Only the
 * chapter merge can be measured, so it is the only phase with a percent.
 *
 * Contract for `request.progress` while `processing`: every write that sets status
 * 'processing' also sets progress 100. Only the chapter merge lowers it (0-99 while
 * its ffmpeg runs, src/lib/utils/merge-progress.ts) and it is back at 100 the
 * moment ffmpeg exits. A new writer must keep this, or the request reads
 * "Merging chapters N%" (tests/constants/processing-progress-invariant.test.ts).
 */
export interface RequestPhase {
  label: 'Organizing files' | 'Merging chapters';
  /** 0-99 while merging, otherwise null (no bar). */
  percent: number | null;
}

export function requestPhase(status: string, progress: number | null | undefined): RequestPhase | null {
  if (status !== 'processing') return null;
  if (typeof progress === 'number' && progress >= 0 && progress < 100) {
    return { label: 'Merging chapters', percent: Math.floor(progress) };
  }
  return { label: 'Organizing files', percent: null };
}

/** One-line text for a phase: "Merging chapters · 42%" or "Organizing files". */
export function requestPhaseText(phase: RequestPhase): string {
  return phase.percent === null ? phase.label : `${phase.label} · ${phase.percent}%`;
}

/**
 * errorMessage of an audiobook request the library scan failed because the book
 * left the library and no audio is left in its organized folder (#214). Users
 * may request it again; automatic callers (shelf sync, watched lists) never do.
 * Do not reword: auto-rerequest.ts finds these requests by equality on this
 * exact text, so a reworded constant silently stops matching existing rows.
 */
export const REMOVED_FROM_LIBRARY_MESSAGE = 'Removed from library. Request it again to download it.';
