/**
 * Component: Library Scan, insert of a new library item (#222)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Used by both scan sites (full scan, recently-added check). Two jobs can both find no
 * row for a new item and both insert it; the second insert fails on the unique
 * plex_guid. That caller gets the row the other job inserted and updates it the way it
 * updates any existing row, so the job neither fails nor skips the item.
 */

import type { PlexLibrary } from '@/generated/prisma';
import { prisma } from '../db';

type LibraryRowData = Parameters<typeof prisma.plexLibrary.create>[0]['data'];

/** `created: false` means another job inserted the item first; `row` is that row. */
export type LibraryRowInsert = { created: boolean; row: PlexLibrary };

/** Prisma unique-constraint violation (P2002) */
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** Insert a new plex_library row, or return the row another job inserted for the same plex_guid. */
export async function createLibraryRowUnlessPresent(data: LibraryRowData): Promise<LibraryRowInsert> {
  try {
    return { created: true, row: await prisma.plexLibrary.create({ data }) };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const row = await prisma.plexLibrary.findUnique({ where: { plexGuid: data.plexGuid } });
    if (!row) throw error;
    return { created: false, row };
  }
}
