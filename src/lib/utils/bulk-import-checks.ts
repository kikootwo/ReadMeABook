/**
 * Component: Bulk Import checks (importable book, ASIN resolve, media-folder rows)
 * Documentation: documentation/features/bulk-import.md
 *
 * One meaning of "importable" for the scan, the match search and the import: a book is blocked
 * when it is in the library (ASIN match, as findPlexMatch) or any user has a request for it in
 * IMPORT_BLOCKING_STATUSES. Server-only (Prisma, fs).
 */

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/db';
import { IMPORT_BLOCKING_STATUSES } from '@/lib/constants/request-statuses';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { getMediaDir } from '@/lib/utils/media-dir';

export interface ImportBlock {
  inLibrary: boolean;
  hasActiveRequest: boolean;
}

/**
 * Library and request flags for each ASIN, in two queries (one per table). In Library:
 * plex_library.asin equal ignoring case (in the query, not only in the JS check: Postgres `in` is
 * case-sensitive), or the ASIN inside plex_guid (as findPlexMatch).
 */
export async function getImportBlocks(asins: string[]): Promise<Map<string, ImportBlock>> {
  const unique = [...new Set(asins.filter(Boolean))];
  const blocks = new Map<string, ImportBlock>();
  if (unique.length === 0) return blocks;

  const [libraryRows, requestRows] = await Promise.all([
    prisma.plexLibrary.findMany({
      where: {
        OR: [
          ...unique.map((asin) => ({ asin: { equals: asin, mode: 'insensitive' as const } })),
          ...unique.map((asin) => ({ plexGuid: { contains: asin } })),
        ],
      },
      select: { asin: true, plexGuid: true },
    }),
    prisma.request.findMany({
      where: {
        audiobook: { audibleAsin: { in: unique } },
        type: 'audiobook',
        status: { in: [...IMPORT_BLOCKING_STATUSES] },
        deletedAt: null,
      },
      select: { audiobook: { select: { audibleAsin: true } } },
    }),
  ]);

  const requested = new Set(requestRows.map((r) => r.audiobook?.audibleAsin).filter(Boolean));
  for (const asin of unique) {
    const lower = asin.toLowerCase();
    blocks.set(asin, {
      inLibrary: libraryRows.some((row) => row.asin?.toLowerCase() === lower || !!row.plexGuid?.includes(asin)),
      hasActiveRequest: requested.has(asin),
    });
  }
  return blocks;
}

/** getImportBlocks for one ASIN. */
export async function getImportBlock(asin: string): Promise<ImportBlock> {
  return (await getImportBlocks([asin])).get(asin) ?? { inLibrary: false, hasActiveRequest: false };
}

/** What the review row shows for a book. */
export interface BookMatch {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
}

/** An audiobooks row to create for a book found in the Audible cache or live (not yet in the database). */
export interface NewAudiobookData {
  audibleAsin: string;
  title: string;
  author: string;
  narrator?: string | null;
  coverArtUrl?: string | null;
  series?: string;
  seriesPart?: string;
  seriesAsin?: string;
  year?: number;
}

export interface ResolvedBook {
  match: BookMatch;
  /** The existing audiobooks row (database hit). */
  audiobookId?: string;
  /** Set when there is no audiobooks row yet: the import creates it from this. */
  newRecord?: NewAudiobookData;
}

const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

/**
 * Read-only resolve in the import's order: audiobooks row, then audible_cache, then a live lookup
 * (Audnexus, then the catalog, in the configured region). Null when not found; a live lookup that
 * throws propagates. The match dialog shows exactly what the import would store.
 */
export async function resolveBookByAsin(asin: string, { fillSeries = true }: { fillSeries?: boolean } = {}): Promise<ResolvedBook | null> {
  const existing = await prisma.audiobook.findFirst({ where: { audibleAsin: asin } });
  if (existing) {
    return {
      audiobookId: existing.id,
      match: { asin, title: existing.title, author: existing.author, narrator: orUndefined(existing.narrator), coverArtUrl: orUndefined(existing.coverArtUrl) },
    };
  }

  const cached = await prisma.audibleCache.findUnique({ where: { asin } });
  if (cached) {
    return {
      match: {
        asin, title: cached.title, author: cached.author, narrator: orUndefined(cached.narrator),
        coverArtUrl: orUndefined(cached.coverArtUrl), durationMinutes: orUndefined(cached.durationMinutes),
      },
      newRecord: { audibleAsin: asin, title: cached.title, author: cached.author, coverArtUrl: cached.coverArtUrl, narrator: cached.narrator },
    };
  }

  const live = await getAudibleService().getAudiobookDetails(asin, { fillSeries });
  if (!live) return null;
  return {
    match: { asin, title: live.title, author: live.author, narrator: live.narrator, coverArtUrl: live.coverArtUrl, durationMinutes: live.durationMinutes },
    newRecord: {
      audibleAsin: asin, title: live.title, author: live.author, coverArtUrl: live.coverArtUrl, narrator: live.narrator,
      series: live.series, seriesPart: live.seriesPart, seriesAsin: live.seriesAsin,
      year: live.releaseDate ? new Date(live.releaseDate).getFullYear() || undefined : undefined,
    },
  };
}

// ---- Media-folder rows (the review screen offers no Change match on them) ----

const BOOKDROP_PATH = '/bookdrop';

/** Scan roots for classification, each resolved through symlinks, `/`-separated. */
export interface ImportRoots {
  media: string[];
  others: string[];
}

const toPosix = (p: string) => p.replace(/\\/g, '/');

/** The real path (symlinks resolved) when it exists, else the resolved path. */
async function realPath(p: string): Promise<string> {
  const resolved = path.resolve(p);
  try {
    return toPosix(await fs.realpath(resolved));
  } catch {
    return toPosix(resolved);
  }
}

function isUnder(p: string, root: string): boolean {
  if (root === '/' || /^[A-Za-z]:\/$/.test(root)) return p.startsWith(root);
  return p === root || p.startsWith(`${root}/`);
}

/** The media folder (getMediaDir) and the other roots (download_dir, /bookdrop when mounted). */
export async function loadImportRoots(): Promise<ImportRoots> {
  const [downloadDir, mediaDir] = await Promise.all([
    prisma.configuration.findUnique({ where: { key: 'download_dir' } }),
    getMediaDir(),
  ]);
  const others: string[] = [];
  if (downloadDir?.value) others.push(await realPath(downloadDir.value));
  try {
    if ((await fs.stat(BOOKDROP_PATH)).isDirectory()) others.push(await realPath(BOOKDROP_PATH));
  } catch {
    /* not mounted */
  }
  return { media: [await realPath(mediaDir)], others };
}

/** The deepest root holding the path decides; media wins a tie (download_dir equal to media_dir). */
export function rootKind(realP: string, roots: ImportRoots): 'media' | 'other' | null {
  const longest = (list: string[]) => Math.max(-1, ...list.filter((r) => isUnder(realP, r)).map((r) => r.length));
  const media = longest(roots.media);
  const other = longest(roots.others);
  if (media < 0 && other < 0) return null;
  return media >= other ? 'media' : 'other';
}

/**
 * True when the folder, or the folder of any of its audio files (a merged entry can hold files from
 * both sides), sits in the media folder by rootKind, after symlinks are resolved.
 */
export async function isInMediaFolder(folderPath: string, audioFiles: string[], roots: ImportRoots): Promise<boolean> {
  const folder = path.resolve(folderPath);
  const dirs = new Set([folder, ...audioFiles.map((file) => path.resolve(folder, path.dirname(file)))]);
  for (const dir of dirs) {
    if (rootKind(await realPath(dir), roots) === 'media') return true;
  }
  return false;
}
