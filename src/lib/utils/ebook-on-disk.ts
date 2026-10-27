/**
 * Component: Ebook On Disk Check (#313)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Answers "does this book's folder already hold an ebook" for the automatic
 * ebook paths (auto-grab after an audiobook import, find_missing_ebooks).
 * Read-only: never moves, renames or deletes anything.
 */

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db';
import { RMABLogger } from './logger';
import { preferredEbookFile } from './import-inventory';
import { canonicalPath, type CanonicalPath, isSameEntry } from './delete-guard';

const moduleLogger = RMABLogger.create('EbookOnDisk');

const ROW_BATCH = 50;

/** Canonical path and identity of an existing folder, or null when nothing is there. */
async function folderEntry(p: string): Promise<CanonicalPath | null> {
  const stats = await fs.stat(p, { bigint: true }).catch(() => null);
  if (!stats) return null;
  return { path: await canonicalPath(p), id: { dev: stats.dev, ino: stats.ino }, ancestors: [] };
}

/**
 * True when another Audiobook row stores the same folder (canonical path or
 * same filesystem entry, as library-delete-guard rule c compares them). Rows
 * whose folder no longer exists are skipped.
 */
async function folderSharedWithAnotherBook(bookPath: string, audiobookId: string): Promise<boolean> {
  const own = await folderEntry(bookPath);
  if (!own) return false;
  const rows = await prisma.audiobook.findMany({
    where: { id: { not: audiobookId }, filePath: { not: null } },
    select: { filePath: true },
  });
  for (let i = 0; i < rows.length; i += ROW_BATCH) {
    const batch = await Promise.all(
      rows.slice(i, i + ROW_BATCH).map(async (row) => (row.filePath ? folderEntry(row.filePath) : null))
    );
    if (batch.some((other) => other && isSameEntry(other, own))) return true;
  }
  return false;
}

/**
 * Name of an ebook file (EBOOK_EXTENSIONS, any case) at the top level of the
 * book folder `bookPath` (Audiobook.filePath), or null. Subfolders are not
 * searched, and dotfiles (macOS `._` sidecars) do not count. A `.pdf` alone
 * does not count (audiobooks often ship a PDF booklet); any other ebook format
 * does, with or without a PDF beside it. Null, with one debug line, also when:
 * no folder is on record; the folder is missing, unreadable or not a folder;
 * another book row stores the same folder (the file may be that book's); or
 * that lookup fails. Null means the caller fetches as before.
 */
export async function findEbookOnDisk(
  bookPath: string | null | undefined,
  audiobookId: string,
  logger: Pick<RMABLogger, 'debug'> = moduleLogger
): Promise<string | null> {
  if (!bookPath) {
    logger.debug('No book folder on record; ebook-on-disk check answers no');
    return null;
  }
  let entries;
  try {
    entries = await fs.readdir(bookPath, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
    logger.debug(`Book folder not readable (${code}); ebook-on-disk check answers no`, { bookPath });
    return null;
  }
  const names = entries
    .filter((entry) => !entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((name) => path.extname(name).toLowerCase() !== '.pdf');
  const found = preferredEbookFile(names);
  if (!found) return null;

  try {
    if (await folderSharedWithAnotherBook(bookPath, audiobookId)) {
      logger.debug(`Book folder is also another book's folder; ${found} may be theirs, ebook-on-disk check answers no`, { bookPath });
      return null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`Could not check other books' folders (${message}); ebook-on-disk check answers no`, { bookPath });
    return null;
  }
  return found;
}
