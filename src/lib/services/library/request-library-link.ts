/**
 * Component: Delivered request → Audiobookshelf item link (#284)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * After RMAB delivered a book, the library item that holds RMAB's folder is the record, whatever
 * ASIN Audiobookshelf gave it. The rule: never link an item that might be another copy or another
 * book; when unsure, link nothing (the ASIN match still applies, and the next run tries again).
 *   - path: a row whose ABS path is the RMAB folder links on its own. A row whose path only ends
 *     with the folder's media_dir-relative path (another mount, another ABS library folder) needs
 *     the files hash, or an item added in the window (one-segment folders: the hash, always).
 *     Several qualify: the files hash decides. A folder on record that may be the ebook's
 *     (fileFormat is an ebook format) is trusted by hash only.
 *   - no qualifying path candidate: the files hash over rows added in the window, not linked to
 *     another audiobook and not at another audiobook's folder, oldest 20; exactly one equal links.
 *   - window: delivery - 1 h to delivery + 72 h.
 * Missing and gone (404) items are skipped; an item the run can't read makes the result
 * `unknown`; several equal items make it `ambiguous`. Neither links.
 */

import { prisma } from '@/lib/db';
import { EBOOK_EXTENSIONS } from '@/lib/constants/audio-formats';
import { getMediaDir } from '@/lib/utils/media-dir';
import { canonicalPath } from '@/lib/utils/delete-guard';
import { normalizeItemPath, relativeInside } from '@/lib/utils/library-item-path';
import { getABSItem } from '@/lib/services/audiobookshelf/api';
import type { RMABLogger } from '@/lib/utils/logger';
import type { LibraryItem } from './ILibraryService';
import { lookupItem, sharedItemCache, type ItemCache, type LookupState } from './library-item-lookup';

export { LINK_HASH_LOOKUP_BUDGET } from './library-item-lookup';
/** A link may use items added up to this long before the delivery... */
export const LINK_WINDOW_BEFORE_MS = 60 * 60 * 1000;
/** ...and up to this long after it (ABS scans late when no scan is triggered after import). */
export const LINK_WINDOW_AFTER_MS = 72 * 60 * 60 * 1000;
/** The hash fallback looks at no more than this many rows per book. */
export const HASH_FALLBACK_LIMIT = 20;

export interface LinkRow {
  plexGuid: string;
  filePath: string | null;
  addedAt: Date | null;
}

export interface DeliveredBook {
  id: string;
  title: string;
  filePath: string | null;
  filesHash: string | null;
  fileFormat?: string | null;
}

/** An audiobook as the run sees it: which item it is linked to, which folder RMAB put it in. */
export interface LinkAudiobook {
  id: string;
  absItemId?: string | null;
  filePath?: string | null;
}

export type LinkResult =
  | { status: 'linked'; plexGuid: string; via: 'path' | 'hash' }
  | { status: 'ambiguous'; ids: string[] }
  | { status: 'unknown' }
  | { status: 'none' };

const NONE: LinkResult = { status: 'none' };
const UNKNOWN: LinkResult = { status: 'unknown' };

type Logger = Pick<RMABLogger, 'info' | 'warn' | 'debug'>;

/** Everything one run (scan or recently-added check) shares: loaded once, fetched at most once. */
export interface LinkContext {
  rows: LinkRow[];
  /** plex_library id → the audiobook linked to it (absItemId), this run's links and ASIN matches included */
  linked: Map<string, string>;
  audiobooks: LinkAudiobook[];
  /** audiobook folder (absolute, and relative to media_dir) → audiobook ids; built on first use */
  folderOwners: Map<string, Set<string>> | null;
  mediaDir: string;
  canonicalMediaDir: string | null;
  /** isMissing of the items listed by this run (no fetch needed) */
  listed: Map<string, { isMissing?: boolean }>;
  lookups: LookupState;
}

export function newLinkContext(init: {
  rows: LinkRow[];
  mediaDir: string;
  audiobooks?: LinkAudiobook[];
  listedItems: Pick<LibraryItem, 'externalId' | 'isMissing'>[];
  fetchItem: (id: string) => Promise<unknown>;
  logger: Logger;
  cache?: ItemCache;
  now?: () => number;
}): LinkContext {
  const audiobooks = init.audiobooks ?? [];
  return {
    rows: init.rows,
    linked: new Map(audiobooks.filter((a) => !!a.absItemId).map((a) => [a.absItemId!, a.id])),
    audiobooks,
    folderOwners: null,
    mediaDir: init.mediaDir,
    canonicalMediaDir: null,
    listed: new Map(init.listedItems.map((i) => [i.externalId, { isMissing: i.isMissing }])),
    lookups: {
      run: new Map(),
      cache: init.cache ?? new Map(),
      now: init.now ?? Date.now,
      lookups: 0,
      budgetLogged: false,
      fetchItem: init.fetchItem,
      logger: init.logger,
    },
  };
}

/** Load this library's rows, the audiobooks' links and folders, and media_dir once for the run. */
export async function createLinkContext(opts: { libraryId: string; listedItems: LibraryItem[]; logger: Logger }): Promise<LinkContext> {
  const [rows, audiobooks, mediaDir] = await Promise.all([
    prisma.plexLibrary.findMany({
      where: { plexLibraryId: opts.libraryId },
      select: { plexGuid: true, filePath: true, addedAt: true },
    }),
    prisma.audiobook.findMany({
      where: { OR: [{ absItemId: { not: null } }, { filePath: { not: null } }] },
      select: { id: true, absItemId: true, filePath: true },
    }),
    getMediaDir(),
  ]);
  return newLinkContext({
    rows,
    mediaDir,
    audiobooks,
    listedItems: opts.listedItems,
    fetchItem: getABSItem,
    logger: opts.logger,
    cache: sharedItemCache(),
  });
}

/** When the audio was delivered: the audiobook request's completion time (set at `downloaded`). */
export function deliveryTime(request: { completedAt: Date | null; updatedAt: Date }): Date {
  return request.completedAt ?? request.updatedAt;
}

interface Window { start: number; end: number }

function inWindow(row: LinkRow, window: Window): boolean {
  const t = row.addedAt?.getTime();
  return t !== undefined && t >= window.start && t <= window.end;
}

function isEbookFormat(format: string | null | undefined): boolean {
  return !!format && (EBOOK_EXTENSIONS as readonly string[]).includes(`.${format.toLowerCase()}`);
}

async function canonicalMediaDir(ctx: LinkContext): Promise<string> {
  ctx.canonicalMediaDir ??= normalizeItemPath(await canonicalPath(ctx.mediaDir));
  return ctx.canonicalMediaDir;
}

/** The item's files hash; null when it is gone, missing or has no audio; 'unknown' when unreadable. */
async function hashOf(id: string, ctx: LinkContext): Promise<string | null | 'unknown'> {
  const lookup = await lookupItem(id, ctx.lookups);
  if (lookup === 'unknown') return 'unknown';
  if (lookup === 'gone' || lookup.isMissing) return null;
  return lookup.hash || null;
}

interface PathCandidate {
  plexGuid: string;
  exact: boolean;
  inWindow: boolean;
}

/** Rows whose ABS path is the RMAB folder or ends with its media_dir-relative path, not missing. */
async function pathCandidates(book: DeliveredBook & { filePath: string }, window: Window, ctx: LinkContext) {
  const folder = normalizeItemPath(await canonicalPath(book.filePath));
  const rel = relativeInside(folder, await canonicalMediaDir(ctx));
  const candidates: PathCandidate[] = [];
  if (!rel) return { rel, candidates, unknown: false };
  const folders = new Set([normalizeItemPath(book.filePath), folder]);
  let unknown = false;
  for (const row of ctx.rows) {
    if (!row.filePath) continue;
    const p = normalizeItemPath(row.filePath);
    const exact = folders.has(p);
    if (!exact && p !== rel && !p.endsWith(`/${rel}`)) continue;

    let isMissing = ctx.listed.get(row.plexGuid)?.isMissing;
    if (isMissing === undefined) {
      const lookup = await lookupItem(row.plexGuid, ctx.lookups);
      if (lookup === 'unknown') {
        unknown = true; // it may be a second candidate: no link this run
        continue;
      }
      if (lookup === 'gone') continue;
      isMissing = lookup.isMissing;
    }
    if (isMissing) continue;
    candidates.push({ plexGuid: row.plexGuid, exact, inWindow: inWindow(row, window) });
  }
  return { rel, candidates, unknown };
}

/** Folder keys → audiobook ids: each audiobook's folder, and that folder relative to media_dir. */
async function folderOwners(ctx: LinkContext): Promise<Map<string, Set<string>>> {
  if (ctx.folderOwners) return ctx.folderOwners;
  const dirs = [...new Set([normalizeItemPath(ctx.mediaDir), await canonicalMediaDir(ctx)])];
  const owners = new Map<string, Set<string>>();
  const add = (key: string, id: string) => {
    if (!key) return;
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key)!.add(id);
  };
  for (const a of ctx.audiobooks) {
    if (!a.filePath) continue;
    const folder = normalizeItemPath(a.filePath);
    add(folder, a.id);
    for (const dir of dirs) if (folder.startsWith(`${dir}/`)) add(folder.slice(dir.length + 1), a.id);
  }
  ctx.folderOwners = owners;
  return owners;
}

/** True when the row's path is another audiobook's folder (as is, or under another mount). */
function atAnotherBooksFolder(rowPath: string, bookId: string, owners: Map<string, Set<string>>): boolean {
  const other = (key: string) => [...(owners.get(key) ?? [])].some((id) => id !== bookId);
  if (other(rowPath)) return true;
  for (let i = rowPath.indexOf('/'); i !== -1; i = rowPath.indexOf('/', i + 1)) {
    if (other(rowPath.slice(i + 1))) return true;
  }
  return false;
}

function linkedToAnother(plexGuid: string, bookId: string, ctx: LinkContext): boolean {
  const owner = ctx.linked.get(plexGuid);
  return owner !== undefined && owner !== bookId;
}

/** Files hash over rows added in the window that no other audiobook holds, oldest first, at most 20. */
async function hashFallback(book: DeliveredBook, window: Window, ctx: LinkContext): Promise<LinkResult> {
  if (!book.filesHash) return NONE;
  const owners = await folderOwners(ctx);
  const pool = ctx.rows
    .filter((r) => inWindow(r, window) && !linkedToAnother(r.plexGuid, book.id, ctx))
    .filter((r) => !r.filePath || !atAnotherBooksFolder(normalizeItemPath(r.filePath), book.id, owners))
    .sort((a, b) => a.addedAt!.getTime() - b.addedAt!.getTime())
    .slice(0, HASH_FALLBACK_LIMIT);
  const equal: string[] = [];
  for (const row of pool) {
    const hash = await hashOf(row.plexGuid, ctx);
    if (hash === 'unknown') return UNKNOWN;
    if (hash !== book.filesHash) continue;
    equal.push(row.plexGuid);
    if (equal.length > 1) break;
  }
  if (equal.length === 1) return { status: 'linked', plexGuid: equal[0], via: 'hash' };
  return equal.length > 1 ? { status: 'ambiguous', ids: equal } : NONE;
}

/**
 * The library item that holds a delivered book's RMAB folder, or none/unknown/ambiguous.
 * `deliveredAt` is the audiobook request's delivery time (see deliveryTime), never the audiobook
 * row's completedAt: an ebook import on the same row overwrites that and filePath.
 */
export async function findDeliveredLibraryItem(book: DeliveredBook, deliveredAt: Date, ctx: LinkContext): Promise<LinkResult> {
  if (!book.filePath) return NONE;
  const window = { start: deliveredAt.getTime() - LINK_WINDOW_BEFORE_MS, end: deliveredAt.getTime() + LINK_WINDOW_AFTER_MS };
  const scan = await pathCandidates({ ...book, filePath: book.filePath }, window, ctx);
  if (scan.unknown) return UNKNOWN;

  const hashOnly = isEbookFormat(book.fileFormat); // the folder on record may be the ebook's
  const oneSegment = !!scan.rel && !scan.rel.includes('/'); // template {title}: a folder name alone
  const qualified: (PathCandidate & { byHash: boolean })[] = [];
  for (const c of scan.candidates) {
    if (!hashOnly && (c.exact || (c.inWindow && !oneSegment))) {
      qualified.push({ ...c, byHash: false });
      continue;
    }
    if (!book.filesHash) continue;
    const hash = await hashOf(c.plexGuid, ctx);
    if (hash === 'unknown') return UNKNOWN;
    if (hash === book.filesHash) qualified.push({ ...c, byHash: true });
  }

  if (qualified.length === 1) {
    return { status: 'linked', plexGuid: qualified[0].plexGuid, via: qualified[0].byHash ? 'hash' : 'path' };
  }
  if (qualified.length > 1) {
    const equal: string[] = [];
    if (book.filesHash) {
      for (const c of qualified) {
        const hash = await hashOf(c.plexGuid, ctx);
        if (hash === 'unknown') return UNKNOWN;
        if (hash === book.filesHash) equal.push(c.plexGuid);
      }
    }
    if (equal.length === 1) return { status: 'linked', plexGuid: equal[0], via: 'hash' };
    return { status: 'ambiguous', ids: qualified.map((c) => c.plexGuid) };
  }
  return hashFallback(book, window, ctx);
}

/** Record that an item now belongs to an audiobook (link or ASIN match), so later fallbacks skip it. */
export function markLinked(ctx: LinkContext, plexGuid: string, audiobookId: string): void {
  ctx.linked.set(plexGuid, audiobookId);
}

const warnedAmbiguous = new Set<string>();

/** Ambiguous links are retried every run: warn once per audiobook per process, then debug. */
export function logAmbiguousLink(book: { id: string; title: string }, ids: string[], logger: Logger): void {
  const message = `Library link: "${book.title}" matches several Audiobookshelf items (${ids.join(', ')}); not linked, the ASIN match still applies`;
  if (warnedAmbiguous.has(book.id)) {
    logger.debug(message);
    return;
  }
  warnedAmbiguous.add(book.id);
  logger.warn(message);
}
