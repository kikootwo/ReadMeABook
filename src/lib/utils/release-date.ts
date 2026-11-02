/**
 * Component: Release Date Utilities
 * Documentation: documentation/backend/database.md
 *
 * Pure helpers for reasoning about a book's release date relative to "today".
 * Date-only comparison in UTC — no local-timezone arithmetic and no string slicing.
 */

/**
 * Returns true when the given release date is strictly after today (UTC date-only).
 * Null, undefined, empty, or malformed input returns false (safe fallback).
 */
export function isUnreleased(
  releaseDate: Date | string | null | undefined
): boolean {
  if (releaseDate === null || releaseDate === undefined || releaseDate === '') {
    return false;
  }

  try {
    const date = releaseDate instanceof Date ? releaseDate : new Date(releaseDate);
    if (isNaN(date.getTime())) {
      return false;
    }

    const now = new Date();
    const releaseY = date.getUTCFullYear();
    const releaseM = date.getUTCMonth();
    const releaseD = date.getUTCDate();
    const nowY = now.getUTCFullYear();
    const nowM = now.getUTCMonth();
    const nowD = now.getUTCDate();

    if (releaseY !== nowY) return releaseY > nowY;
    if (releaseM !== nowM) return releaseM > nowM;
    return releaseD > nowD;
  } catch {
    return false;
  }
}

/**
 * Normalizes a release date to its `YYYY-MM-DD` day, or null when it can't be read safely.
 * Accepts ISO dates (`2021-01-28`, catalog API and modern series rows), ISO datetimes
 * (`2021-01-28T00:00:00.000Z`, Audnexus; the date part is kept) and Date objects (UTC day).
 * Anything else (`01-28-21` legacy labels, locale text, impossible dates) returns null:
 * day/month order differs per marketplace, so guessing could misdate a book.
 */
export function toReleaseDay(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return null;

  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const valid =
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d);
  return valid ? `${y}-${m}-${d}` : null;
}

/**
 * Decides whether auto-search should be skipped because the book is unreleased.
 * Short-circuits when the admin toggle is off.
 */
export function shouldSkipAutoSearch(
  request: { releaseDate?: Date | string | null },
  settingOn: boolean
): { skip: boolean; reason?: 'unreleased' } {
  if (!settingOn) return { skip: false };
  if (isUnreleased(request.releaseDate)) {
    return { skip: true, reason: 'unreleased' };
  }
  return { skip: false };
}
