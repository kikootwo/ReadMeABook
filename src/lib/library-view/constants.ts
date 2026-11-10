/**
 * Component: Library view constants
 * Documentation: documentation/features/library-view.md
 *
 * Request status sets shared with other routes live in src/lib/constants/request-statuses.ts.
 */

export const STATUS_GROUPS = [
  'available',
  'on_the_way',
  'needs_approval',
  'awaiting_release',
  'problem',
  'denied',
] as const;

/** Request status → status group (a library row always means `available`). */
export const STATUS_GROUP_OF: Readonly<Record<string, (typeof STATUS_GROUPS)[number]>> = {
  available: 'available',
  pending: 'on_the_way',
  awaiting_search: 'on_the_way',
  searching: 'on_the_way',
  downloading: 'on_the_way',
  processing: 'on_the_way',
  downloaded: 'on_the_way',
  awaiting_import: 'on_the_way',
  awaiting_approval: 'needs_approval',
  awaiting_release: 'awaiting_release',
  failed: 'problem',
  warn: 'problem',
  denied: 'denied',
};

/** Status sort rank (asc): problem first, denied last. */
export const STATUS_GROUP_RANK: Readonly<Record<(typeof STATUS_GROUPS)[number], number>> = {
  problem: 0,
  needs_approval: 1,
  on_the_way: 2,
  awaiting_release: 3,
  available: 4,
  denied: 5,
};

export const SOURCES = ['scan', 'rmab'] as const;
export const SORT_KEYS = ['added', 'title', 'author', 'year', 'duration', 'status'] as const;
export const SORT_ORDERS = ['asc', 'desc'] as const;
export const GROUP_MODES = ['none', 'author'] as const;

/** Natural order per sort key when `order` is not given. */
export const NATURAL_ORDER: Readonly<Record<(typeof SORT_KEYS)[number], 'asc' | 'desc'>> = {
  added: 'desc',
  title: 'asc',
  author: 'asc',
  year: 'desc',
  duration: 'desc',
  status: 'asc',
};

export const DEFAULT_LIMIT = 60;
export const MAX_LIMIT = 120;
export const MAX_QUERY_LENGTH = 200;
export const MAX_REQUESTED_BY = 50;
export const MAX_CURSOR_LENGTH = 2048;
/** Sort/group keys are truncated to this many characters (keeps cursors small). */
export const SORT_KEY_LENGTH = 120;

/**
 * Ebook request statuses that mean the ebook organize ran (or may have run) and wrote the shared
 * audiobook row's file_path; the admin path is withheld for that book.
 */
export const EBOOK_ORGANIZE_REACHED_STATUSES = [
  'processing',
  'downloaded',
  'available',
  'awaiting_import',
  'warn',
] as const;

/** Live mode poll interval while any request is searching/downloading/processing. */
export const LIVE_FAST_REFRESH_MS = 5000;
/** Live mode poll interval while only slower live statuses remain. */
export const LIVE_SLOW_REFRESH_MS = 30000;
export const LIVE_FAST_STATUSES = ['searching', 'downloading', 'processing'] as const;

/** Safety TTL for the cached library-row snapshot (snapshot.ts); the version key normally decides. */
export const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
