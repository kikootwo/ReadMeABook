/**
 * Component: Library Scan, requests of a book that left the library (#214)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Used by both scan sites that unlink a book whose library item disappeared
 * (stale library record, orphaned audiobook). Its 'available' requests move on:
 *   - no audio left in its organized folder (`Audiobook.filePath`), the folder
 *     is gone, or none is on record: 'failed' with REMOVED_FROM_LIBRARY_MESSAGE,
 *     so it can be requested again
 *   - audio still there: 'downloaded', matched again by the next scan
 * A failed request is still matched by the next scan if the book comes back.
 */

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db';
import { REMOVED_FROM_LIBRARY_MESSAGE } from '../constants/request-statuses';
import { isAudioFilename } from '../utils/files-hash';
import type { RMABLogger } from '../utils/logger';

export interface RemovedBook {
  title: string;
  filePath: string | null;
  requests: { id: string; status: string }[];
}

/**
 * Folder levels below the book folder that are searched for audio: the
 * organizer writes audio flat into the book folder, and a multi-disc book
 * keeps its audio one level down (disc folders).
 */
const AUDIO_SEARCH_DEPTH = 1;

/** True when `dir`, or a real child folder within `depth` levels, holds an audio file. Errors propagate. */
async function holdsAudio(dir: string, depth: number): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  // Anything that is not a folder (files, links to files) counts by its name
  if (entries.some((entry) => !entry.isDirectory() && isAudioFilename(entry.name))) return true;
  if (depth === 0) return false;
  for (const entry of entries) {
    if (entry.isDirectory() && (await holdsAudio(path.join(dir, entry.name), depth - 1))) return true;
  }
  return false;
}

/**
 * True when no audio file is left at the book's organized folder: the folder
 * is gone, none is on record, or only non-audio files (cover.jpg, ebooks)
 * remain. Anything unreadable (EACCES, EIO and the like) counts as present.
 */
export async function organizedAudioGone(filePath: string | null): Promise<boolean> {
  if (!filePath) return true;
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isDirectory()) return !isAudioFilename(filePath);
    return !(await holdsAudio(filePath, AUDIO_SEARCH_DEPTH));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

/** Move the book's 'available' requests on after its library item disappeared; returns how many moved. */
export async function resetRequestsAfterLibraryRemoval(book: RemovedBook, logger: RMABLogger): Promise<number> {
  const available = book.requests.filter((request) => request.status === 'available');
  if (available.length === 0) return 0;

  const gone = await organizedAudioGone(book.filePath);
  for (const request of available) {
    await prisma.request.update({
      where: { id: request.id },
      data: gone
        ? { status: 'failed', errorMessage: REMOVED_FROM_LIBRARY_MESSAGE, updatedAt: new Date() }
        : { status: 'downloaded', updatedAt: new Date() }, // audio still there: the next scan can match it
    });
  }
  logger.info(
    gone
      ? `"${book.title}" left the library and no audio is left (${book.filePath ?? 'no folder on record'}): ${available.length} request(s) failed, can be requested again`
      : `"${book.title}" left the library but its audio is still at ${book.filePath}: ${available.length} request(s) back to downloaded`
  );
  return available.length;
}
