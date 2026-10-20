/**
 * Component: Plex Sign-in Identity Checks
 * Documentation: documentation/backend/services/auth.md
 *
 * A Plex sign-in writes the user row keyed by the identity Plex returned. These checks keep
 * that write to rows that belong to Plex sign-ins.
 */

import { prisma } from '@/lib/db';

/** Plex ids are numeric account ids or Plex uuids. */
export function isPlexIdentity(plexId: unknown): plexId is string {
  return (
    typeof plexId === 'string' &&
    plexId.length > 0 &&
    plexId.length <= 128 &&
    /^[A-Za-z0-9-]+$/.test(plexId) &&
    !plexId.toLowerCase().startsWith('local-')
  );
}

/**
 * True when a Plex sign-in may create or update the row for this plexId: the id has the
 * shape of a Plex id, an existing row was made by a Plex sign-in, and (for a Home profile)
 * the row is not tied to a different Home user.
 */
export async function canSignInAsPlexIdentity(
  plexId: unknown,
  { homeUserId }: { homeUserId?: string } = {}
): Promise<boolean> {
  if (!isPlexIdentity(plexId)) return false;
  const existing = await prisma.user.findUnique({
    where: { plexId },
    select: { authProvider: true, plexHomeUserId: true },
  });
  if (!existing) return true;
  if (existing.authProvider !== null && existing.authProvider !== undefined && existing.authProvider !== 'plex') {
    return false;
  }
  if (homeUserId !== undefined && existing.plexHomeUserId && existing.plexHomeUserId !== homeUserId) {
    return false;
  }
  return true;
}
