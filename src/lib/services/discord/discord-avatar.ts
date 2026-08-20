/**
 * Component: Discord Avatar Capture
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Caches the Discord CDN avatar URL for a linked RMAB user so admin surfaces (e.g. Requests
 * Awaiting Approval) can show a real face instead of a generic placeholder.
 *
 * Discord CDN URLs are `/avatars/{userId}/{hash}` and the hash is not derivable from the user id,
 * so it can only come from Discord itself. Rather than calling the API, we take it from the
 * interaction we are already handling: every interaction carries the acting user, so the cache is
 * refreshed for free and self-heals when someone changes their avatar.
 *
 * Stored in `discordAvatarUrl`, deliberately separate from `avatarUrl`, so a Plex/OIDC avatar is
 * never overwritten.
 */

import type { User } from 'discord.js';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('Discord.Avatar');

/**
 * Refresh the cached avatar for whichever RMAB user is linked to this Discord account.
 *
 * Best-effort and non-blocking: never throws, and writes only when the URL actually changed so a
 * burst of interactions doesn't cause a write per click.
 */
export async function captureDiscordAvatar(discordUser: User): Promise<void> {
  try {
    // `avatar` is null when the account has no custom avatar; leave the cache empty in that case so
    // the UI keeps its own placeholder rather than pinning Discord's default image.
    const avatarUrl = discordUser.avatar
      ? discordUser.displayAvatarURL({ size: 64, extension: 'png' })
      : null;

    const linked = await prisma.user.findUnique({
      where: { discordUserId: discordUser.id },
      select: { id: true, discordAvatarUrl: true },
    });
    if (!linked || linked.discordAvatarUrl === avatarUrl) return;

    await prisma.user.update({
      where: { id: linked.id },
      data: { discordAvatarUrl: avatarUrl },
    });
    logger.info('Cached Discord avatar', { rmabUserId: linked.id, cleared: avatarUrl === null });
  } catch (error) {
    logger.warn('Could not cache Discord avatar', {
      discordUserId: discordUser.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
