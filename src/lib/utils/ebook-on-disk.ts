/**
 * Component: Ebook On Disk Check (#313)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Answers "does this book's folder already hold an ebook" for the automatic
 * ebook paths (auto-grab after an audiobook import, find_missing_ebooks).
 * Read-only: never moves, renames or deletes anything.
 */

import fs from 'fs/promises';
import { RMABLogger } from './logger';
import { preferredEbookFile } from './import-inventory';

const moduleLogger = RMABLogger.create('EbookOnDisk');

/**
 * Name of an ebook file (EBOOK_EXTENSIONS, any case) at the top level of the
 * book folder `bookPath` (Audiobook.filePath), or null. Subfolders are not
 * searched, and dotfiles (macOS `._` sidecars) do not count. No folder on
 * record, a missing or unreadable folder, or a path that is not a folder
 * answers null (fetch as before) with one debug line.
 */
export async function findEbookOnDisk(
  bookPath: string | null | undefined,
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
    .map((entry) => entry.name);
  return preferredEbookFile(names) ?? null;
}
