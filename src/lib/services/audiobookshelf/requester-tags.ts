/**
 * Component: Audiobookshelf Requester Tags
 * Documentation: documentation/features/requester-tags.md
 *
 * Builds the `req:<username>` tag for a requester and refuses tags two users would share
 * (`john.smith` and `johnsmith` both become `req:johnsmith`). Admins use these tags to filter what
 * each user sees in Audiobookshelf, so a shared tag would show one user the other's books.
 */

import { prisma } from '@/lib/db';
import type { RMABLogger } from '@/lib/utils/logger';

export interface RequesterTagCollision {
  tag: string;
  usernames: string[];
}

/**
 * Format a requester tag from a username.
 * Lowercases, trims, converts spaces to underscores, and strips any character
 * outside [a-z0-9_-]. Example: "John Smith" -> "req:john_smith".
 *
 * Returns '' when the username sanitizes to nothing (e.g. all-symbol or
 * non-Latin usernames). Callers MUST skip empty results — otherwise every such
 * user would collapse onto a single bare `req:` tag, exposing their libraries
 * to each other. The whole point of the tag is per-user scoping.
 *
 * @param username - The requester's username
 * @returns The sanitized `req:<username>` tag, or '' if nothing usable remains
 */
export function formatRequesterTag(username: string): string {
  const sanitized = username
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return sanitized ? `req:${sanitized}` : '';
}

/**
 * Tags that two or more users (not deleted) would share, each with the usernames involved.
 */
export async function findRequesterTagCollisions(): Promise<RequesterTagCollision[]> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { plexUsername: true },
  });

  const usernamesByTag = new Map<string, string[]>();
  for (const { plexUsername } of users) {
    const tag = formatRequesterTag(plexUsername);
    if (tag) usernamesByTag.set(tag, [...(usernamesByTag.get(tag) ?? []), plexUsername]);
  }

  return [...usernamesByTag]
    .filter(([, usernames]) => usernames.length > 1)
    .map(([tag, usernames]) => ({ tag, usernames }));
}

/**
 * Returns a lookup for one scan or backfill run: the tag to write for a requester, or '' when the
 * username has no usable tag or shares it with another user. Users are loaded on the first call,
 * and each shared tag is logged once per run.
 */
export function createRequesterTagger(logger: Pick<RMABLogger, 'warn'>): (username: string) => Promise<string> {
  let collisions: Promise<Map<string, string[]>> | undefined;
  const warned = new Set<string>();

  return async (username) => {
    collisions ??= findRequesterTagCollisions().then(
      (found) => new Map(found.map(({ tag, usernames }) => [tag, usernames]))
    );

    const tag = formatRequesterTag(username);
    const sharedWith = (await collisions).get(tag);
    if (!sharedWith) return tag;

    if (!warned.has(tag)) {
      warned.add(tag);
      logger.warn(`Not tagging with ${tag}: users ${sharedWith.join(', ')} would share it. Rename one of them to tag their books.`);
    }
    return '';
  };
}
