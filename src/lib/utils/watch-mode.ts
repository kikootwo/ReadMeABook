/**
 * Component: Watch Mode (Entire catalog / New releases only)
 * Documentation: documentation/features/watched-lists.md
 *
 * Pure helpers for a watched author or series' request mode. A watch stores one
 * nullable `newReleasesSince`: null = entire catalog, a date = new releases only.
 */

import { toReleaseDay } from './release-date';

export interface WatchModeFields {
  newReleasesOnly: boolean;
  newReleasesSince: Date | null;
}

/**
 * The cutoff to store when a watch is created or its mode changes.
 * Turning new-only on starts a cutoff now; asking for new-only again keeps the existing one;
 * entire catalog clears it.
 */
export function nextNewReleasesSince(
  current: Date | null | undefined,
  newReleasesOnly: boolean,
  now: Date = new Date()
): Date | null {
  if (!newReleasesOnly) return null;
  return current ?? now;
}

/** API shape of a watch's mode. */
export function watchModeFields(row: { newReleasesSince?: Date | null }): WatchModeFields {
  const since = row.newReleasesSince ?? null;
  return { newReleasesOnly: since !== null, newReleasesSince: since };
}

/**
 * Earliest release day requested under new-only: the cutoff's UTC day minus one.
 * The day of grace keeps "from today on" true in every time zone (an evening watch
 * in the Americas is already the next day in UTC).
 */
export function newReleaseFloorDay(since: Date): string {
  const floor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate() - 1));
  return floor.toISOString().slice(0, 10);
}

/** Whether a book counts as a new release for a cutoff. Undated books never do. */
export function isNewRelease(releaseDate: string | null | undefined, since: Date): boolean {
  const day = toReleaseDay(releaseDate);
  return day !== null && day >= newReleaseFloorDay(since);
}
