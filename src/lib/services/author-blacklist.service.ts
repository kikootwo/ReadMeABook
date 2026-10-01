/**
 * Component: Author Blacklist Service
 * Documentation: documentation/admin-features/author-blacklist.md
 *
 * Global admin author blacklist (name-based). User/auto request paths call
 * isAuthorBlocked before creating requests.
 */

import { prisma } from '@/lib/db';
import type { BlockedAuthor } from '@/generated/prisma';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('AuthorBlacklist');

export const AUTHOR_BLOCKED_MESSAGE =
  'This author is blocked by the administrator';

/**
 * Normalize an author name for blacklist matching.
 */
export function normalizeAuthorKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Split a book author field into normalized name keys (comma-separated).
 * Empty segments after trim are dropped; duplicates collapsed.
 */
export function parseAuthorNames(authorField: string): string[] {
  if (!authorField) return [];
  const keys = authorField
    .split(',')
    .map((part) => normalizeAuthorKey(part))
    .filter((key) => key.length > 0);
  return [...new Set(keys)];
}

/**
 * True if any comma-separated author segment matches a blacklisted key.
 */
export async function isAuthorBlocked(authorField: string): Promise<boolean> {
  const names = parseAuthorNames(authorField);
  if (names.length === 0) return false;

  const match = await prisma.blockedAuthor.findFirst({
    where: { authorKey: { in: names } },
    select: { id: true },
  });
  return match !== null;
}

export interface AddBlockedAuthorInput {
  authorName: string;
  createdById?: string | null;
}

export interface AddBlockedAuthorResult {
  entry: BlockedAuthor;
  wasNew: boolean;
}

/**
 * Upsert a blocked author by normalized key. Returns wasNew=false on duplicate.
 */
export async function addBlockedAuthor(
  input: AddBlockedAuthorInput
): Promise<AddBlockedAuthorResult> {
  const authorName = input.authorName.trim();
  const authorKey = normalizeAuthorKey(authorName);
  if (!authorKey) {
    throw new Error('Author name is required');
  }

  const existing = await prisma.blockedAuthor.findUnique({
    where: { authorKey },
  });
  if (existing) {
    return { entry: existing, wasNew: false };
  }

  const entry = await prisma.blockedAuthor.create({
    data: {
      authorName,
      authorKey,
      createdById: input.createdById ?? null,
    },
  });

  logger.info('Author added to blacklist', {
    authorName: entry.authorName,
    authorKey: entry.authorKey,
    id: entry.id,
  });

  return { entry, wasNew: true };
}

export async function removeBlockedAuthor(id: string): Promise<boolean> {
  try {
    await prisma.blockedAuthor.delete({ where: { id } });
    logger.info('Author removed from blacklist', { id });
    return true;
  } catch {
    return false;
  }
}

export async function listBlockedAuthors(): Promise<BlockedAuthor[]> {
  return prisma.blockedAuthor.findMany({
    orderBy: { createdAt: 'desc' },
  });
}
