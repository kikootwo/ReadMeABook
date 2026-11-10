/**
 * Component: Library card display rules (pure): cover tone, pill, meta line, labels
 * Documentation: documentation/features/library-view.md
 */

import type { CoverTone } from '@/components/audiobooks/BookCover';
import { statusLabel } from '@/components/requests/StatusBadge';
import type { LibraryItem, StatusGroup } from '@/lib/library-view/types';

const AMBER = new Set(['downloading', 'processing', 'downloaded', 'awaiting_import']);
const BLUE = new Set(['pending', 'awaiting_search', 'searching', 'awaiting_approval', 'awaiting_release']);
const RED = new Set(['failed', 'warn', 'denied']);

/** Status group labels (filter rail, chips, stats). */
export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  available: 'Available',
  on_the_way: 'On the way',
  needs_approval: 'Needs approval',
  awaiting_release: 'Awaiting release',
  problem: 'Problem',
  denied: 'Denied',
};

/** Dot colour per status group (filter rail, chips). */
export const STATUS_GROUP_DOTS: Record<StatusGroup, string> = {
  available: 'bg-emerald-400',
  on_the_way: 'bg-amber-400',
  needs_approval: 'bg-blue-400',
  awaiting_release: 'bg-blue-400',
  problem: 'bg-red-400',
  denied: 'bg-red-400',
};

export const SOURCE_LABELS = { scan: 'Found by library scan', rmab: 'Requested in ReadMeABook' } as const;

/** Text colour of a card's status meta line, per tone. */
export const TONE_TEXT: Record<CoverTone, string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  red: 'text-red-600 dark:text-red-400',
};

export function coverTone(item: Pick<LibraryItem, 'inLibrary' | 'status'>): CoverTone | null {
  if (item.inLibrary || item.status === 'available') return 'emerald';
  if (AMBER.has(item.status)) return 'amber';
  if (BLUE.has(item.status)) return 'blue';
  if (RED.has(item.status)) return 'red';
  return null;
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

/** The card's status label (StatusBadge's wording); "In your library" for library books. */
export function cardLabel(item: Pick<LibraryItem, 'inLibrary' | 'status' | 'progress'>): string {
  if (item.inLibrary || item.status === 'available') return 'In your library';
  return statusLabel(item.status, item.progress ?? undefined);
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
