/**
 * Component: Followed Author Service
 * Documentation: documentation/features/followed-authors.md
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('FollowedAuthorService');

export interface FollowedAuthorData {
  asin: string;
  name: string;
  image?: string | null;
}

export interface FollowedAuthorResult {
  id: string;
  asin: string;
  name: string;
  image: string | null;
  createdAt: Date;
}

/**
 * Follow an author for a user
 */
export async function followAuthor(
  userId: string,
  data: FollowedAuthorData
): Promise<FollowedAuthorResult> {
  logger.info(`User ${userId} following author "${data.name}" (${data.asin})`);

  const followed = await prisma.followedAuthor.upsert({
    where: {
      userId_asin: { userId, asin: data.asin },
    },
    update: {
      name: data.name,
      image: data.image ?? null,
    },
    create: {
      userId,
      asin: data.asin,
      name: data.name,
      image: data.image ?? null,
    },
  });

  return followed;
}

/**
 * Unfollow an author for a user
 */
export async function unfollowAuthor(
  userId: string,
  asin: string
): Promise<boolean> {
  logger.info(`User ${userId} unfollowing author ASIN: ${asin}`);

  try {
    await prisma.followedAuthor.delete({
      where: {
        userId_asin: { userId, asin },
      },
    });
    return true;
  } catch {
    // Record not found — already unfollowed
    return false;
  }
}

/**
 * Get all followed authors for a user
 */
export async function getFollowedAuthors(
  userId: string
): Promise<FollowedAuthorResult[]> {
  return prisma.followedAuthor.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Check if a user follows a specific author
 */
export async function isFollowingAuthor(
  userId: string,
  asin: string
): Promise<boolean> {
  const count = await prisma.followedAuthor.count({
    where: { userId, asin },
  });
  return count > 0;
}

/**
 * Check follow status for multiple authors at once
 */
export async function getFollowedAsins(
  userId: string,
  asins: string[]
): Promise<Set<string>> {
  if (asins.length === 0) return new Set();

  const followed = await prisma.followedAuthor.findMany({
    where: { userId, asin: { in: asins } },
    select: { asin: true },
  });

  return new Set(followed.map((f) => f.asin));
}
