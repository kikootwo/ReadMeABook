/**
 * Component: Audiobookshelf E-Reader Item Lookup
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Finds the Audiobookshelf library item whose ebook gets emailed. Emailing the wrong book is worse
 * than not delivering, so a guess is never accepted:
 *   - folder known (the organize job's target, else the request's placement record): only an item
 *     at that folder. Its ABS path is the folder, or ends with the folder's media_dir-relative path
 *     (ABS mounts the library somewhere else).
 *   - no folder: an exact title match (and author, when known), as before.
 * Libraries searched, in order: the ebook library (when set), the audiobook library and, with a
 * folder, every other book library (an ebook library ABS watches that RMAB was never told about).
 * The book's linked item (`absItemId`) is tried first. A "not found" result means retry: ABS may
 * still be scanning the new file.
 */

import { getConfigService } from '../config.service';
import { ABSApiError, getABSItem, getABSLibraries, searchABSItems } from './api';
import { canonicalPath } from '@/lib/utils/delete-guard';
import { normalizeItemPath, relativeInside } from '@/lib/utils/library-item-path';
import { getMediaDir } from '@/lib/utils/media-dir';
import type { RMABLogger } from '@/lib/utils/logger';

export interface EbookItemQuery {
  title: string;
  author: string;
  /** The book's linked ABS item, if any (usually the audiobook's) */
  absItemId?: string | null;
  /** Absolute library folder RMAB put the ebook in, when known */
  folder?: string | null;
}

export type EbookItemLookup = { found: true; itemId: string } | { found: false; reason: string };

type Logger = Pick<RMABLogger, 'info' | 'warn'>;

const NO_EBOOK_HINT =
  'the scan may still be running. If this keeps happening, check that the library isn\'t set to "Audiobooks only"';

/** Configured libraries first (ebook, then audiobook), then other book libraries when wanted. */
async function librariesToSearch(includeOthers: boolean, logger: Logger): Promise<string[]> {
  const configService = getConfigService();
  const ids = [
    await configService.get('audiobookshelf.ebook_library_id'),
    await configService.get('audiobookshelf.library_id'),
  ].filter((id): id is string => !!id);

  if (includeOthers) {
    try {
      for (const library of (await getABSLibraries()) ?? []) {
        if (library?.id && (library.mediaType ?? 'book') === 'book') ids.push(library.id);
      }
    } catch (error) {
      logger.warn(`Could not list Audiobookshelf libraries; searching the configured ones only (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return [...new Set(ids)];
}

/** The full item, or null when ABS no longer has it (404). Other errors throw (the job retries). */
async function fetchItem(itemId: string): Promise<any | null> {
  try {
    return await getABSItem(itemId);
  } catch (error) {
    if (error instanceof ABSApiError && error.status === 404) return null;
    throw error;
  }
}

/** Library items from a title search across the given libraries, de-duplicated, in order. */
async function searchItems(libraryIds: string[], title: string): Promise<any[]> {
  const seen = new Set<string>();
  const items: any[] = [];
  for (const libraryId of libraryIds) {
    for (const hit of await searchABSItems(libraryId, title)) {
      const item = hit?.libraryItem ?? hit;
      if (item?.id && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  return items;
}

/** Whether an ABS item path is the RMAB folder (same path, or the same media_dir-relative tail). */
async function folderMatcher(folder: string): Promise<(itemPath: unknown) => boolean> {
  const canonical = normalizeItemPath(await canonicalPath(folder));
  const exact = new Set([normalizeItemPath(folder), canonical]);
  const rel = relativeInside(canonical, normalizeItemPath(await canonicalPath(await getMediaDir())));
  return (itemPath) => {
    if (typeof itemPath !== 'string' || !itemPath) return false;
    const p = normalizeItemPath(itemPath);
    return exact.has(p) || (!!rel && (p === rel || p.endsWith(`/${rel}`)));
  };
}

async function findByFolder(query: EbookItemQuery & { folder: string }, logger: Logger): Promise<EbookItemLookup> {
  const atFolder = await folderMatcher(query.folder);

  let item = query.absItemId ? await fetchItem(query.absItemId) : null;
  if (!atFolder(item?.path)) {
    const hit = (await searchItems(await librariesToSearch(true, logger), query.title)).find((it) => atFolder(it.path));
    item = hit ? await fetchItem(hit.id) : null;
  }

  if (!item?.id) {
    return { found: false, reason: `"${query.title}" isn't in Audiobookshelf at ${query.folder} yet; the library scan may still be running` };
  }
  if (!item.media?.ebookFile) {
    return { found: false, reason: `Audiobookshelf item ${item.id} (${query.folder}) has no ebook yet; ${NO_EBOOK_HINT}` };
  }
  return { found: true, itemId: item.id };
}

async function findByTitle(query: EbookItemQuery, logger: Logger): Promise<EbookItemLookup> {
  const linked = query.absItemId ? await fetchItem(query.absItemId) : null;
  if (linked?.media?.ebookFile) return { found: true, itemId: linked.id };

  const libraryIds = await librariesToSearch(false, logger);
  if (libraryIds.length === 0) {
    return { found: false, reason: 'No Audiobookshelf library is configured; cannot look up the ebook' };
  }

  const normalize = (value?: string) => (value || '').trim().toLowerCase();
  const matches = (await searchItems(libraryIds, query.title)).filter((it) =>
    normalize(it?.media?.metadata?.title) === normalize(query.title)
    && (!query.author || normalize(it?.media?.metadata?.authorName) === normalize(query.author))
  );
  if (matches.length === 0) {
    logger.warn(`No exact Audiobookshelf match for "${query.title}" by ${query.author || 'unknown author'}`);
    return { found: false, reason: `"${query.title}" isn't in Audiobookshelf yet; the library scan may still be running` };
  }

  for (const match of matches) {
    const item = await fetchItem(match.id);
    if (item?.media?.ebookFile) return { found: true, itemId: item.id };
  }
  return { found: false, reason: `Audiobookshelf item ${matches[0].id} has no ebook yet; ${NO_EBOOK_HINT}` };
}

/** Find the ABS item holding this book's ebook (see the header for the rules). */
export async function findEbookItem(query: EbookItemQuery, logger: Logger): Promise<EbookItemLookup> {
  return query.folder ? findByFolder({ ...query, folder: query.folder }, logger) : findByTitle(query, logger);
}
