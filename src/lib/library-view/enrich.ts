/**
 * Component: Library view page enrichment (returned page only): covers, download size, admin path
 * Documentation: documentation/features/library-view.md
 */

import { prisma } from '@/lib/db';
import { followedCoverUrl, libraryCoverUrl } from '@/lib/services/library/library-display';
import { sameAsin } from '@/lib/utils/asin';
import { EBOOK_ORGANIZE_REACHED_STATUSES } from './constants';
import type { LibraryEntry, LibraryViewer, PageEnrichment } from './types';

/** A followed Audiobookshelf book (#562): an available request linked to an item with a library ASIN. */
function follows(entry: LibraryEntry): boolean {
  const p = entry.primary;
  return !!p && p.status === 'available' && !!p.audiobook.absItemId && !!p.audiobook.libraryAsin;
}

/** The row's own cached cover; for a followed book only a file named for its library ASIN. */
function rowCover(entry: LibraryEntry): string | null {
  const cached = entry.row!.cachedLibraryCoverPath;
  return follows(entry) ? followedCoverUrl(cached, entry.primary!.audiobook.libraryAsin!) : libraryCoverUrl(cached);
}

/**
 * In library: row cover → audible_cache by the ROW's ASIN → the stored request cover only when the
 * request ASIN is the row's → null. Never the requested edition's cover for a rematched book.
 * Request-only: stored cover → audible_cache by ASIN → null.
 */
export function coverFor(entry: LibraryEntry, audible: ReadonlyMap<string, string>): string | null {
  const book = entry.primary?.audiobook ?? null;
  if (entry.row) {
    const own = rowCover(entry);
    if (own) return own;
    const rowAsin = entry.row.asin?.trim().toUpperCase();
    const byRow = rowAsin ? audible.get(rowAsin) : undefined;
    if (byRow) return byRow;
    return book?.coverArtUrl && sameAsin(book.audibleAsin?.trim(), entry.row.asin?.trim()) ? book.coverArtUrl : null;
  }
  if (book?.coverArtUrl) return book.coverArtUrl;
  const asin = book?.audibleAsin?.trim().toUpperCase();
  return (asin && audible.get(asin)) || null;
}

/** ASINs whose audible_cache cover the page may need. */
function coverLookupAsins(page: readonly LibraryEntry[]): string[] {
  const asins = new Set<string>();
  for (const entry of page) {
    const asin = entry.row
      ? (rowCover(entry) ? null : entry.row.asin)
      : (entry.primary?.audiobook.coverArtUrl ? null : entry.primary?.audiobook.audibleAsin);
    const v = asin?.trim();
    if (v) {
      asins.add(v);
      asins.add(v.toUpperCase());
    }
  }
  return [...asins];
}

async function loadAudibleCovers(asins: string[]): Promise<Map<string, string>> {
  if (asins.length === 0) return new Map();
  const cached = await prisma.audibleCache.findMany({
    where: { asin: { in: asins } },
    select: { asin: true, coverArtUrl: true },
  });
  const covers = new Map<string, string>();
  for (const c of cached) if (c.coverArtUrl) covers.set(c.asin.toUpperCase(), c.coverArtUrl);
  return covers;
}

/** Latest selected download size per request (explicit createdAt desc), as a string. */
async function loadSizes(requestIds: string[]): Promise<Map<string, string | null>> {
  const sizes = new Map<string, string | null>();
  if (requestIds.length === 0) return sizes;
  const rows = await prisma.downloadHistory.findMany({
    where: { requestId: { in: requestIds }, selected: true },
    orderBy: { createdAt: 'desc' },
    select: { requestId: true, torrentSizeBytes: true },
  });
  for (const row of rows) {
    if (!sizes.has(row.requestId)) {
      sizes.set(row.requestId, row.torrentSizeBytes != null ? row.torrentSizeBytes.toString() : null);
    }
  }
  return sizes;
}

/**
 * Admin path: audiobooks.file_path unless an ebook request on that book (any parent, deleted or
 * not) reached the ebook organize, which overwrites the shared row's file_path.
 */
async function loadAdminPaths(audiobookIds: string[]): Promise<Map<string, string | null>> {
  const paths = new Map<string, string | null>();
  if (audiobookIds.length === 0) return paths;
  const [books, ebookTouched] = await Promise.all([
    prisma.audiobook.findMany({ where: { id: { in: audiobookIds } }, select: { id: true, filePath: true } }),
    prisma.request.findMany({
      where: { audiobookId: { in: audiobookIds }, type: 'ebook', status: { in: [...EBOOK_ORGANIZE_REACHED_STATUSES] } },
      select: { audiobookId: true },
    }),
  ]);
  const touched = new Set(ebookTouched.map((r) => r.audiobookId));
  for (const book of books) paths.set(book.id, touched.has(book.id) ? null : book.filePath ?? null);
  return paths;
}

export async function enrichPage(page: readonly LibraryEntry[], viewer: LibraryViewer): Promise<PageEnrichment> {
  const gatedRequestIds = page
    .filter((e) => e.primary && (viewer.isAdmin || e.primary.user.id === viewer.id))
    .map((e) => e.primary!.id);
  const audiobookIds = viewer.isAdmin ? page.filter((e) => e.primary).map((e) => e.primary!.audiobookId) : [];

  const [audible, sizesByRequest, pathsByBook] = await Promise.all([
    loadAudibleCovers(coverLookupAsins(page)),
    loadSizes(gatedRequestIds),
    loadAdminPaths(audiobookIds),
  ]);

  const covers = new Map<string, string | null>();
  const sizes = new Map<string, string | null>();
  const paths = new Map<string, string | null>();
  for (const entry of page) {
    covers.set(entry.id, coverFor(entry, audible));
    if (entry.primary) sizes.set(entry.id, sizesByRequest.get(entry.primary.id) ?? null);
    if (viewer.isAdmin) paths.set(entry.id, entry.primary ? pathsByBook.get(entry.primary.audiobookId) ?? null : null);
  }
  return { covers, sizes, paths };
}
