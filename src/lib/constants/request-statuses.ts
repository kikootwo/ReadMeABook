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

/**
 * errorMessage of an audiobook request the library scan failed because the book
 * left the library and no audio is left in its organized folder (#214). Users
 * may request it again; automatic callers (shelf sync, watched lists) never do.
 * Do not reword: auto-rerequest.ts finds these requests by equality on this
 * exact text, so a reworded constant silently stops matching existing rows.
 */
export const REMOVED_FROM_LIBRARY_MESSAGE = 'Removed from library. Request it again to download it.';
