/**
 * Component: Discord Actor Resolver
 * Documentation: documentation/backend/services/auth.md
 *
 * The only path from a Discord user ID to an RMAB account. Applies the same account
 * refusal as requireAuth (missing, deleted, pending approval, rejected) and takes admin
 * from the account's role in the database, read on every call (never cached).
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { getSessionRefusal } from '@/lib/services/auth/local-account-status';

const logger = RMABLogger.create('DiscordActor');

/** A Discord user ID (snowflake): digits only. */
export const DISCORD_USER_ID_PATTERN = /^\d{15,25}$/;

/** The RMAB account a Discord user acts as. */
export interface DiscordActor {
  userId: string;
  username: string;
  role: string;
  /** From the account role only (the setup-admin flag does not make an account admin). */
  isAdmin: boolean;
}

/**
 * Resolves the account linked to a Discord user ID, or null when none is linked or the
 * account is refused. Callers resolve again for every interaction.
 */
export async function resolveDiscordActor(discordUserId: string): Promise<DiscordActor | null> {
  if (typeof discordUserId !== 'string' || !DISCORD_USER_ID_PATTERN.test(discordUserId)) return null;

  const user = await prisma.user.findUnique({
    where: { discordUserId },
    select: { id: true, plexUsername: true, role: true, registrationStatus: true, deletedAt: true },
  });

  // No issue time: the revoked-sessions check applies to issued credentials only
  const refusal = getSessionRefusal(user, undefined);
  if (!user || refusal) {
    if (user) logger.debug('Discord link refused', { userId: user.id, reason: refusal });
    return null;
  }

  return {
    userId: user.id,
    username: user.plexUsername,
    role: user.role,
    isAdmin: user.role === 'admin',
  };
}
