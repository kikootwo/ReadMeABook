/**
 * Component: Discord User Resolver
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Maps a Discord account (snowflake) to its RMAB user and determines whether that user has
 * admin/root privileges (used to widen /status and /delete to "all requests" and to authorize
 * approve/deny buttons).
 */

import { prisma } from '@/lib/db';

export interface ResolvedDiscordUser {
  user: {
    id: string;
    plexUsername: string;
    role: string;
    isSetupAdmin: boolean;
    discordUserId: string | null;
  };
  /** True if the RMAB user is an admin or the protected setup admin. */
  isAdmin: boolean;
}

/**
 * Resolve a Discord user ID to the linked RMAB user. Returns null if no (non-deleted) user is
 * linked to that Discord account.
 */
export async function resolveRmabUser(
  discordUserId: string
): Promise<ResolvedDiscordUser | null> {
  const user = await prisma.user.findFirst({
    where: { discordUserId, deletedAt: null },
    select: {
      id: true,
      plexUsername: true,
      role: true,
      isSetupAdmin: true,
      discordUserId: true,
    },
  });

  if (!user) return null;

  return {
    user,
    isAdmin: user.role === 'admin' || user.isSetupAdmin,
  };
}
