/**
 * Component: Request Delete: Child Ebook Requests and the Book's Stored Path (#526)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * An audiobook request delete leaves the ebook its sibling ebook request placed,
 * so that request stays when it delivered: it is unlinked (parentRequestId null),
 * and the book row keeps that ebook's folder and format, the state an ebook-only
 * import leaves (organize-files.processor.ts, ebook branch). Undelivered children
 * are soft-deleted with the audiobook request, as before. An ebook request delete
 * that removed the book's stored folder clears the stored path, so after both
 * deletes, in either order, nothing points at a removed folder. A later audiobook
 * import of the book links the surviving ebook request to the new request.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { canonicalPath } from '../utils/delete-guard';
import { readPlacements } from '../utils/ebook-placement';

const logger = RMABLogger.create('RequestDelete');

export interface ChildRequests {
  /** Delivered ebook requests: they stay. */
  delivered: string[];
  /** Everything else: soft-deleted with the audiobook request. */
  undelivered: string[];
  /** The newest recorded ebook of a delivered child still on disk: the book's stored path from now on. */
  survivorFolder: { folder: string; format: string } | null;
}

interface ChildRow {
  id: string;
  status?: string | null;
  completedAt?: Date | null;
  placedEbookFiles?: unknown;
}

function isDelivered(child: ChildRow): boolean {
  return readPlacements(child.placedEbookFiles) !== null || child.status === 'downloaded' || !!child.completedAt;
}

async function recordedEbookOnDisk(child: ChildRow): Promise<{ folder: string; format: string } | null> {
  const entries = readPlacements(child.placedEbookFiles)?.entries ?? [];
  for (const entry of [...entries].reverse()) {
    const stat = await fs.lstat(entry.path).catch(() => null);
    if (stat?.isFile()) return { folder: path.dirname(entry.path), format: path.extname(entry.path).slice(1).toLowerCase() };
  }
  return null;
}

/** Ebook requests linked to the audiobook request, and parentless ebook requests on the same book. Never throws. */
export async function findChildRequests(requestId: string, audiobookId: string): Promise<ChildRequests> {
  const none: ChildRequests = { delivered: [], undelivered: [], survivorFolder: null };
  try {
    const rows: ChildRow[] = (await prisma.request.findMany({
      where: {
        deletedAt: null,
        OR: [
          { parentRequestId: requestId },
          { type: 'ebook', parentRequestId: null, audiobookId },
        ],
      },
      select: { id: true, type: true, status: true, completedAt: true, placedEbookFiles: true },
      // Newest first: the survivor folder is the newest delivered child's recorded ebook still on disk
      orderBy: { createdAt: 'desc' },
    })) ?? [];
    const result: ChildRequests = { ...none, delivered: [], undelivered: [] };
    for (const child of rows) {
      if (!isDelivered(child)) {
        result.undelivered.push(child.id);
        continue;
      }
      result.delivered.push(child.id);
      result.survivorFolder ??= await recordedEbookOnDisk(child);
    }
    return result;
  } catch (error) {
    logger.error(`Error loading child requests for ${requestId}`, { error: error instanceof Error ? error.message : String(error) });
    return none;
  }
}

/** Soft-delete the undelivered children; unlink the delivered ones (they stay). Never throws. */
export async function keepDeliveredChildren(children: ChildRequests, adminUserId: string): Promise<void> {
  try {
    if (children.undelivered.length > 0) {
      await prisma.request.updateMany({
        where: { id: { in: children.undelivered } },
        data: { deletedAt: new Date(), deletedBy: adminUserId },
      });
      logger.info(`Soft-deleted ${children.undelivered.length} child request(s)`);
    }
    if (children.delivered.length > 0) {
      await prisma.request.updateMany({
        where: { id: { in: children.delivered } },
        data: { parentRequestId: null },
      });
      logger.info(`Kept ${children.delivered.length} delivered ebook request(s), now without a parent: ${children.delivered.join(', ')}`);
    }
  } catch (error) {
    logger.error('Error updating child requests', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * A new audiobook import of the book (organize-files.processor.ts): link the newest
 * parentless active ebook request of the book (one that outlived an earlier audiobook
 * request delete) to `requestId`, so the fetch-ebook, select-ebook and
 * interactive-search-ebook routes find it by parent instead of opening a second one.
 * Skipped when `requestId` already has an ebook request. Compare-and-set on
 * `parentRequestId: null`: of two imports, only one claims it. Returns the relinked id. Never throws.
 */
export async function relinkParentlessEbookRequest(requestId: string, audiobookId: string): Promise<string | null> {
  try {
    const own = await prisma.request.findFirst({
      where: { parentRequestId: requestId, type: 'ebook', deletedAt: null },
      select: { id: true },
    });
    if (own) return null;
    const parentless = await prisma.request.findFirst({
      where: { audiobookId, type: 'ebook', parentRequestId: null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!parentless) return null;
    const claimed = await prisma.request.updateMany({
      where: { id: parentless.id, parentRequestId: null, deletedAt: null },
      data: { parentRequestId: requestId },
    });
    if (claimed.count === 0) {
      logger.info(`Ebook request ${parentless.id} was linked to another request meanwhile; left as it is`);
      return null;
    }
    logger.info(`Linked ebook request ${parentless.id} (no parent) to audiobook request ${requestId}`);
    return parentless.id;
  } catch (error) {
    logger.error(`Error linking a parentless ebook request to ${requestId}`, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** True when an active ebook request of the book delivered its ebook. Never throws (false on error). */
export async function hasDeliveredEbookRequest(audiobookId: string): Promise<boolean> {
  try {
    const rows: ChildRow[] = (await prisma.request.findMany({
      where: { audiobookId, type: 'ebook', deletedAt: null },
      select: { id: true, status: true, completedAt: true, placedEbookFiles: true },
    })) ?? [];
    return rows.some(isDelivered);
  } catch (error) {
    logger.error(`Error loading the ebook requests of book ${audiobookId}`, { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * After an ebook delete removed folder(s): clear the book's stored path when it
 * was one of them (the same folder by canonical path). Never throws.
 */
export async function clearRemovedEbookFolder(book: { id: string; filePath: string | null }, removedFolders: string[]): Promise<void> {
  if (!book.filePath || removedFolders.length === 0) return;
  try {
    if (!removedFolders.includes(await canonicalPath(book.filePath))) return;
    await prisma.audiobook.update({
      where: { id: book.id },
      data: { filePath: null, fileFormat: null, filesHash: null, updatedAt: new Date() },
    });
    logger.info(`Cleared the stored folder of book ${book.id}: the ebook delete removed it`);
  } catch (error) {
    logger.error(`Error clearing the stored folder of book ${book.id}`, { error: error instanceof Error ? error.message : String(error) });
  }
}
