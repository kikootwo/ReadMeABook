/**
 * Component: Delivered requests follow the library's ASIN (#325a, #284 part B)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * Audiobookshelf only. A book linked to an ABS item (absItemId) with a live `available` audiobook
 * request takes the ASIN that item holds now (plex_library.asin) as `library_asin`, so request
 * cards and lists show the edition ABS matched it to. Runs right after the request match in both
 * scan jobs and reads only the database. The requested ASIN (audible_asin), title, author,
 * narrator, series and year are never written: ownership, folder naming and the ebook search
 * keep using them.
 *   - item ASIN differs from the requested one (case-insensitive) → library_asin = it
 *   - item ASIN is the requested one again → library_asin cleared
 *   - no item row, or its ASIN is empty or not ASIN-shaped (an ISBN) → nothing written
 * Every write is a compare-and-set on (id, absItemId, libraryAsin): a lost race writes nothing.
 * A book that is no longer linked (request delete, replace) keeps nothing: the run clears it.
 */

import { prisma } from '@/lib/db';
import type { RMABLogger } from '@/lib/utils/logger';
import { ASIN_PATTERN } from '@/lib/services/audiobookshelf/match-missing-asins';

export interface FollowLibraryAsinResult {
  /** linked books with a live available audiobook request */
  considered: number;
  /** books whose library ASIN was set or moved */
  followed: number;
  /** books whose library ASIN was cleared (back to the requested ASIN) */
  cleared: number;
  /** unlinked books whose leftover library ASIN was cleared */
  unlinked: number;
}

const sameAsin = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toUpperCase() === b.toUpperCase();

/**
 * The library ASIN to store for a linked book: a value to write (null = clear), or undefined
 * when nothing changes. A missing or invalid item ASIN never blanks a stored one.
 */
export function nextLibraryAsin(
  audibleAsin: string | null | undefined,
  current: string | null | undefined,
  itemAsin: string | null | undefined
): string | null | undefined {
  const asin = itemAsin?.trim();
  if (!asin || !ASIN_PATTERN.test(asin)) return undefined;
  if (sameAsin(asin, audibleAsin)) return current ? null : undefined;
  if (sameAsin(asin, current)) return undefined;
  return asin;
}

export async function followLibraryAsins(backendMode: string, logger: RMABLogger): Promise<FollowLibraryAsinResult> {
  const result: FollowLibraryAsinResult = { considered: 0, followed: 0, cleared: 0, unlinked: 0 };
  if (backendMode !== 'audiobookshelf') return result;

  try {
    const { count } = await prisma.audiobook.updateMany({
      where: { absItemId: null, libraryAsin: { not: null } },
      data: { libraryAsin: null, updatedAt: new Date() },
    });
    result.unlinked = count;

    const books = await prisma.audiobook.findMany({
      where: {
        absItemId: { not: null },
        requests: { some: { type: 'audiobook', status: 'available', deletedAt: null } },
      },
      select: { id: true, title: true, audibleAsin: true, libraryAsin: true, absItemId: true },
    });
    result.considered = books.length;
    if (books.length === 0) return result;

    const rows = await prisma.plexLibrary.findMany({
      where: { plexGuid: { in: books.map((b) => b.absItemId!) } },
      select: { plexGuid: true, asin: true },
    });
    const itemAsin = new Map(rows.map((r) => [r.plexGuid, r.asin]));

    for (const book of books) {
      if (!itemAsin.has(book.absItemId!)) continue; // item gone: the stale and orphan resets handle it
      const next = nextLibraryAsin(book.audibleAsin, book.libraryAsin, itemAsin.get(book.absItemId!));
      if (next === undefined) continue;
      try {
        const write = await prisma.audiobook.updateMany({
          where: { id: book.id, absItemId: book.absItemId, libraryAsin: book.libraryAsin },
          data: { libraryAsin: next, updatedAt: new Date() },
        });
        if (write.count !== 1) {
          logger.debug(`Library ASIN of "${book.title}" changed meanwhile; left for the next run`);
          continue;
        }
        if (next === null) result.cleared++;
        else result.followed++;
        const from = book.libraryAsin || book.audibleAsin || 'none';
        logger.info(`Following Audiobookshelf: "${book.title}" library ASIN ${from} -> ${next ?? book.audibleAsin ?? 'none'}`);
      } catch (error) {
        logger.error(`Library ASIN of "${book.title}" not saved: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    logger.error(`Following library ASINs failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}
