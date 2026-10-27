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
