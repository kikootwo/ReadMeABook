/**
 * Component: Library card display rules (pure): cover tone, pill, meta line, labels
 * Documentation: documentation/features/library-view.md
 */

import type { CoverTone } from '@/components/audiobooks/BookCover';
import { statusLabel } from '@/components/requests/StatusBadge';
import { STATUS_GROUP_OF } from '@/lib/library-view/constants';
import type { LibraryItem, StatusGroup } from '@/lib/library-view/types';

/**
 * One colour per status group: the card's dot, the stat tiles, the rail, the chips and the detail's
 * dot and badge all use it (a pending or searching book is "On the way", so amber).
 */
export const GROUP_TONE: Record<StatusGroup, CoverTone> = {
  available: 'emerald',
  on_the_way: 'amber',
  needs_approval: 'blue',
  awaiting_release: 'blue',
  problem: 'red',
  denied: 'red',
};

/** Dot classes per tone (keep in step with BookCover's dot). */
export const TONE_DOT: Record<CoverTone, string> = {
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
  blue: 'bg-blue-400',
  red: 'bg-red-400',
};

/** Badge colours per tone (the detail's status badge; its text stays StatusBadge's). */
export const TONE_BADGE: Record<CoverTone, string> = {
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

/** Status group labels (filter rail, chips), worded like the cards and tiles. */
export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  available: 'In your library',
  on_the_way: 'On the way',
  needs_approval: 'Pending approval',
  awaiting_release: 'Awaiting release',
  problem: 'Problem',
  denied: 'Request denied',
};

/** Dot colour per status group (filter rail, chips). */
export const STATUS_GROUP_DOTS = Object.fromEntries(
  Object.entries(GROUP_TONE).map(([group, tone]) => [group, TONE_DOT[tone]])
) as Record<StatusGroup, string>;

export const SOURCE_LABELS = { scan: 'Found by library scan', rmab: 'Requested in ReadMeABook' } as const;

/** Text colour of a card's status meta line, per tone (at least 4.5:1 for small text in light mode). */
export const TONE_TEXT: Record<CoverTone, string> = {
  emerald: 'text-emerald-700 dark:text-emerald-400',
  amber: 'text-amber-700 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  red: 'text-red-600 dark:text-red-400',
};

/** The status group a card shows: from its status (a live patch), else the list's group. */
export function shownGroup(item: Pick<LibraryItem, 'inLibrary' | 'status' | 'statusGroup'>): StatusGroup {
  if (item.inLibrary || item.status === 'available') return 'available';
  return STATUS_GROUP_OF[item.status] ?? item.statusGroup;
}

export function coverTone(item: Pick<LibraryItem, 'inLibrary' | 'status' | 'statusGroup'>): CoverTone {
  return GROUP_TONE[shownGroup(item)];
}

/** "12h 4m", "45m"; null when unknown. */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "Out Nov 12" (the year added when it is not this year); null without a date. */
export function releaseLabel(releaseDate: string | null, now: Date = new Date()): string | null {
  if (!releaseDate) return null;
  const date = new Date(releaseDate);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  const text = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `Out ${text}`;
}

/** "1.2 GB" from a byte count sent as a string; null when unknown. */
export function sizeLabel(bytes: string | null | undefined): string | null {
  if (!bytes) return null;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function percent(item: Pick<LibraryItem, 'status' | 'progress'>): string | null {
  return item.status === 'downloading' && item.progress != null && item.progress > 0
    ? `${Math.round(item.progress)}%`
    : null;
}

/** "Pending Approval" → "Pending approval": the page's labels are in sentence case. */
function sentenceCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

/** The card's status label (StatusBadge's wording, sentence case); "In your library" for library books. */
export function cardLabel(item: Pick<LibraryItem, 'inLibrary' | 'status' | 'progress'>): string {
  if (item.inLibrary || item.status === 'available') return 'In your library';
  return sentenceCase(statusLabel(item.status, item.progress ?? undefined));
}

/** The cover pill for books not in the library; null for library books. */
export function cardPill(item: LibraryItem, now?: Date): string | null {
  if (item.inLibrary || item.status === 'available') return null;
  if (item.status === 'awaiting_release') return releaseLabel(item.releaseDate, now) ?? cardLabel(item);
  const pct = percent(item);
  return pct ? `${cardLabel(item)} ${pct}` : cardLabel(item);
}

/** The line under the author: duration (else year) in the library, else the status. */
export function cardMeta(item: LibraryItem): string {
  if (item.inLibrary || item.status === 'available') {
    return formatDuration(item.durationMinutes) ?? (item.year ? String(item.year) : '');
  }
  const pct = percent(item);
  return pct ? `${cardLabel(item)} · ${pct}` : cardLabel(item);
}

export function cardAriaLabel(item: LibraryItem): string {
  return `${item.title} by ${item.author}, ${cardLabel(item)}`;
}

/** Shows the moving bar under the cover. */
export function showsProgress(item: Pick<LibraryItem, 'inLibrary' | 'status'>): boolean {
  return !item.inLibrary && item.status === 'downloading';
}

/** A requester's name in the rail and chips ("name (deleted)" for a removed account). */
export function requesterLabel(facet: { username: string; deleted?: true }): string {
  return facet.deleted ? `${facet.username} (deleted)` : facet.username;
}
