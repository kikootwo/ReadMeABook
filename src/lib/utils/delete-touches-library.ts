/**
 * Component: Delete Touches Library (bulk delete refusal, admin list flag)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Whether deleting a request could touch the library, judged by data, not by the
 * request's own status: its book has a stored folder or a library item (audiobook
 * request), its imports placed ebook files (ebook request), or a live request on the
 * same book is being imported. deleteRequest refuses on it when asked (bulk delete),
 * and GET /api/admin/requests derives its `inLibrary` flag from it.
 */

/** The fields the rule reads; stored paths and placement records never leave the server. */
export interface DeleteTouchesLibraryRow {
  type?: string | null;
  placedEbookFiles?: unknown;
  audiobook: {
    filePath?: string | null;
    absItemId?: string | null;
    plexGuid?: string | null;
  };
}

/** Prisma filter for the live requests that mark a book as being imported. */
export const BEING_IMPORTED_WHERE = { status: 'processing', deletedAt: null } as const;

/**
 * True when deleting `row` could remove library files or a library item, or race an
 * import: the book holds a folder or item (audiobook), the request placed ebook files
 * (ebook; any stored record but an empty list counts), or `bookBeingImported` (a live
 * request on the same book, this one included, is `processing`).
 */
export function deleteTouchesLibrary(row: DeleteTouchesLibraryRow, bookBeingImported: boolean): boolean {
  if (bookBeingImported) return true;
  if ((row.type || 'audiobook') === 'ebook') {
    const placed = row.placedEbookFiles;
    return placed !== null && placed !== undefined && !(Array.isArray(placed) && placed.length === 0);
  }
  const book = row.audiobook;
  return !!(book.filePath || book.absItemId || book.plexGuid);
}
