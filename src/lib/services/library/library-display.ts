/**
 * Component: Request display follows the library (#325a, #284 part B)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * An audiobook request whose book has a library ASIN (follow-library-asin.ts) shows the linked
 * Audiobookshelf item's title, author, narrator and cover. Applies only when `libraryAsin` is set
 * AND the linked plex_library row exists; every other request looks exactly as stored. The
 * returned `libraryAsin` is the effective value: set only when the overlay applies, else null.
 * `audibleAsin`, series, year and description stay as requested (the details modal and its
 * actions key on `audibleAsin`).
 */

import { prisma } from '@/lib/db';

export interface LibraryDisplayRow {
  plexGuid: string;
  title: string;
  author: string;
  narrator: string | null;
  cachedLibraryCoverPath: string | null;
}

/** The audiobook fields the overlay reads and writes. */
export interface DisplayAudiobook {
  absItemId?: string | null;
  libraryAsin?: string | null;
  title: string;
  author: string;
  narrator?: string | null;
  coverArtUrl?: string | null;
}

type MaybeBook = { absItemId?: string | null; libraryAsin?: string | null } | null | undefined;

/** One query for every followed book in the list (none when no book has a library ASIN). */
export async function loadLinkedRows(audiobooks: MaybeBook[]): Promise<Map<string, LibraryDisplayRow>> {
  const ids = [...new Set(audiobooks.filter((a) => a?.libraryAsin && a.absItemId).map((a) => a!.absItemId!))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.plexLibrary.findMany({
    where: { plexGuid: { in: ids } },
    select: { plexGuid: true, title: true, author: true, narrator: true, cachedLibraryCoverPath: true },
  });
  return new Map(rows.map((r) => [r.plexGuid, r]));
}

/** A value from the library row, or null when it is empty (ABS's 'Unknown Author' counts as empty). */
function shown(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && v !== 'Unknown Author' ? v : null;
}

/** The cached library cover, served by /api/cache/library/[filename] (as bookdate/library does). */
export function libraryCoverUrl(cachedPath: string | null | undefined): string | null {
  const filename = cachedPath?.split('/').pop();
  return filename ? `/api/cache/library/${filename}` : null;
}

/** The audiobook as shown for a request of `requestType`, with the effective `libraryAsin`. */
export function withLibraryDisplay<T extends DisplayAudiobook>(
  audiobook: T,
  rows: Map<string, LibraryDisplayRow>,
  requestType: string | null | undefined
): T & { libraryAsin: string | null } {
  const row = audiobook.absItemId ? rows.get(audiobook.absItemId) : undefined;
  const applies = (requestType || 'audiobook') === 'audiobook' && !!audiobook.libraryAsin && !!row;
  if (!applies || !row) return { ...audiobook, libraryAsin: null };
  return {
    ...audiobook,
    libraryAsin: audiobook.libraryAsin!,
    title: shown(row.title) ?? audiobook.title,
    author: shown(row.author) ?? audiobook.author,
    narrator: shown(row.narrator) ?? audiobook.narrator ?? null,
    coverArtUrl: libraryCoverUrl(row.cachedLibraryCoverPath) ?? audiobook.coverArtUrl ?? null,
  };
}

/** The overlay for a list of requests (one query), keeping each request's other fields. */
export async function withLibraryDisplayAll<R extends { type?: string | null; audiobook: DisplayAudiobook | null }>(
  requests: R[]
): Promise<R[]> {
  const rows = await loadLinkedRows(requests.map((r) => r.audiobook));
  return requests.map((r) => (r.audiobook ? { ...r, audiobook: withLibraryDisplay(r.audiobook, rows, r.type) } : r));
}
