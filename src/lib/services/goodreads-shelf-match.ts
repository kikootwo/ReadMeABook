/**
 * Component: Goodreads Shelf Duplicate Lookup
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Stored rows may hold an older form of the same feed (http://, bare goodreads.com),
 * so duplicates are found by comparing normalised feed URLs, not the raw column.
 */

import { prisma } from '@/lib/db';
import { toGoodreadsRssUrl } from '@/lib/utils/goodreads-rss-url';

/** Message for a feed the user already has as a shelf */
export const DUPLICATE_SHELF_MESSAGE = 'You have already added this shelf';

/** Prisma unique-constraint violation (P2002), e.g. a concurrent add of the same feed */
export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** The user's shelf with the same (normalised) feed URL, other than `excludeShelfId`. */
export async function findShelfWithSameFeed(
  userId: string,
  feedUrl: string,
  excludeShelfId?: string,
): Promise<{ id: string } | null> {
  const target = toGoodreadsRssUrl(feedUrl) ?? feedUrl;
  const shelves = await prisma.goodreadsShelf.findMany({
    where: { userId },
    select: { id: true, rssUrl: true },
  });
  const match = shelves.find(
    (shelf) => shelf.id !== excludeShelfId && (toGoodreadsRssUrl(shelf.rssUrl) ?? shelf.rssUrl) === target,
  );
  return match ? { id: match.id } : null;
}
