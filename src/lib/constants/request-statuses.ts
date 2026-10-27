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
 * errorMessage of an audiobook request the library scan failed because the book
 * left the library and its organized folder is gone (#214). Users may request it
 * again; automatic callers (shelf sync, watched lists) never do.
 */
export const REMOVED_FROM_LIBRARY_MESSAGE = 'Removed from library: its files are gone too. Request it again to download it.';
