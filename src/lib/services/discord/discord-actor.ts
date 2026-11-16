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
import { DISCORD_SNOWFLAKE_PATTERN, isSnowflake } from './discord-snowflake';

const logger = RMABLogger.create('DiscordActor');

/** A Discord user ID (snowflake): 15 to 20 digits, no leading zero. */
export const DISCORD_USER_ID_PATTERN = DISCORD_SNOWFLAKE_PATTERN;

/** The RMAB account a Discord user acts as. */
export interface DiscordActor {
  userId: string;
  username: string;
  /** From the account role only (the setup-admin flag does not make an account admin). */
  isAdmin: boolean;
}

/**
 * Resolves the account linked to a Discord user ID, or null when none is linked or the
 * account is refused. Callers resolve again for every interaction.
 *
 * Pass only the ID Discord reports for the person acting (`interaction.user.id`), never an
 * ID taken from command options, a component custom_id or message text (the sender
 * chooses those).
 */
export async function resolveDiscordActor(discordUserId: string): Promise<DiscordActor | null> {
  if (!isSnowflake(discordUserId)) return null;

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
    isAdmin: user.role === 'admin',
  };
}
