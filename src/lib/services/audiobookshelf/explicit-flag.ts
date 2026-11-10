/**
 * Component: Explicit flag on Audiobookshelf items (#542), guard and immediate write
 * Documentation: documentation/features/explicit-flag.md
 *
 * A request marked Explicit turns on its ABS item's Explicit flag (never off). ABS hides explicit
 * books from any user without "Can access explicit content", including the user behind RMAB's API
 * key, so every write first checks that user (canKeyUserSeeExplicit) and is skipped with a warning
 * when it can't see them. The scan step writes through the shared item writer; the mark route
 * writes at once for a book already available (markItemExplicitNow).
 */

import { prisma } from '@/lib/db';
import type { RMABLogger } from '@/lib/utils/logger';
import { canKeyUserSeeExplicit, writeABSItem } from './api';

const ACCESS_HINT = 'turn on "Can access explicit content" for that user in Audiobookshelf';

/** Why nothing was written when the API key's user can't see explicit books (or the check failed). */
export const EXPLICIT_ACCESS_REASON =
  `the Audiobookshelf API key's user can't see explicit books (or the check failed), so ReadMeABook would lose sight of the book; ${ACCESS_HINT}`;

/** The marked, available audiobook requests whose book has an ABS item: the ones a scan writes. */
export const MARKED_AVAILABLE_WHERE = {
  deletedAt: null,
  type: 'audiobook',
  status: 'available',
  explicit: true,
  audiobook: { absItemId: { not: null } },
} as const;

/**
 * One guard per scan run: reads the key user's access once, records the books it held back and
 * logs one warning at the end that says what would have happened and what follows from it.
 */
export function createExplicitGuard(logger: RMABLogger) {
  let allowed: boolean | undefined;
  const heldBack: string[] = [];
  return {
    async allowed(): Promise<boolean> {
      if (allowed === undefined) allowed = await canKeyUserSeeExplicit();
      return allowed;
    },
    checked: () => allowed !== undefined,
    holdBack(title: string) {
      heldBack.push(title);
    },
    /** Logs the run's warning when the check failed; returns the number of books held back. */
    finish(): number {
      if (allowed !== false) return heldBack.length;
      const shown = heldBack.slice(0, 5).map((t) => `"${t}"`).join(', ');
      const more = heldBack.length > 5 ? ` and ${heldBack.length - 5} more` : '';
      const what = heldBack.length > 0 ? `Not marking ${shown}${more} explicit` : 'Not marking books explicit';
      logger.warn(
        `${what}: the Audiobookshelf API key's user can't see explicit books (or the check failed). ` +
        'Books already marked explicit in Audiobookshelf are hidden from ReadMeABook, and a full library scan ' +
        `can treat them as removed from the library. To fix: ${ACCESS_HINT}`
      );
      return heldBack.length;
    },
  };
}

export type ExplicitGuard = ReturnType<typeof createExplicitGuard>;

/** Any marked, available request with an ABS item (one count query). */
export async function hasMarkedAvailableRequests(): Promise<boolean> {
  return (await prisma.request.count({ where: MARKED_AVAILABLE_WHERE })) > 0;
}

/**
 * The mark route's write for a book already in the library: guard, then `{explicit: true}` alone
 * (no GET). Idempotent: ABS answers `updated: false` when the flag is already on. Never throws.
 */
export async function markItemExplicitNow(absItemId: string): Promise<{ written: true } | { written: false; reason: string }> {
  if (!(await canKeyUserSeeExplicit())) return { written: false, reason: EXPLICIT_ACCESS_REASON };
  const outcome = await writeABSItem(absItemId, { explicit: true });
  if (outcome.explicit === 'set' || outcome.explicit === 'present') return { written: true };
  if (outcome.httpStatus === 403) {
    return { written: false, reason: "the Audiobookshelf API key's user needs permission to update items" };
  }
  return { written: false, reason: `Audiobookshelf answered: ${outcome.error ?? 'unknown error'}` };
}
