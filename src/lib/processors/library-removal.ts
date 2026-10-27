/**
 * Component: Library Scan, requests of a book that left the library (#214)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Used by both scan sites that unlink a book whose library item disappeared
 * (stale library record, orphaned audiobook). Its 'available' requests move on:
 *   - organized folder (`Audiobook.filePath`) gone, or none on record: 'failed'
 *     with REMOVED_FROM_LIBRARY_MESSAGE, so it can be requested again
 *   - folder still there: 'downloaded', matched again by the next scan
 * A failed request is still matched by the next scan if the book comes back.
 */

import * as fs from 'fs/promises';
import { prisma } from '../db';
import { REMOVED_FROM_LIBRARY_MESSAGE } from '../constants/request-statuses';
import type { RMABLogger } from '../utils/logger';

export interface RemovedBook {
  title: string;
  filePath: string | null;
  requests: { id: string; status: string }[];
}

/** True when nothing is at the folder (or none is on record). An unreadable path (EACCES, EIO) counts as present. */
export async function organizedFolderGone(filePath: string | null): Promise<boolean> {
  if (!filePath) return true;
  try {
    await fs.stat(filePath);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

/** Move the book's 'available' requests on after its library item disappeared; returns how many moved. */
export async function resetRequestsAfterLibraryRemoval(book: RemovedBook, logger: RMABLogger): Promise<number> {
  const available = book.requests.filter((request) => request.status === 'available');
  if (available.length === 0) return 0;

  const gone = await organizedFolderGone(book.filePath);
  for (const request of available) {
    await prisma.request.update({
      where: { id: request.id },
      data: gone
        ? { status: 'failed', errorMessage: REMOVED_FROM_LIBRARY_MESSAGE, updatedAt: new Date() }
        : { status: 'downloaded', updatedAt: new Date() }, // files still there: the next scan can match them
    });
  }
  logger.info(
    gone
      ? `"${book.title}" left the library and its files are gone (${book.filePath ?? 'no folder on record'}): ${available.length} request(s) failed, can be requested again`
      : `"${book.title}" left the library but its files are still at ${book.filePath}: ${available.length} request(s) back to downloaded`
  );
  return available.length;
}
