/**
 * Component: Discord Cancel/Delete Sync
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Rewrites the Discord surfaces for a request that has just been cancelled or deleted: renders the
 * live request card as cancelled and strips the Approve/Deny buttons from any pending approval
 * embed. Shared by deleteRequest() and cancelRequest() so every path converges -- the Web UI, the
 * admin route, the Discord Cancel button, /status and /delete, and the reported-issue cleanup.
 * Previously a web-side delete left a live "Cancel Request" button and, worse, a live approval
 * embed whose Approve button still worked against the deleted request.
 *
 * Dynamically imports the bot and card modules, gated on a running bot, so discord.js stays
 * unloaded when the bot is disabled. Never throws: a Discord failure must not fail the caller.
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('Discord.CancelSync');

export async function syncDiscordOnCancel(
  requestId: string,
  wasAwaitingApproval: boolean,
  actorUserId: string | null,
  actorDiscordUserId?: string | null
): Promise<void> {
  try {
    const { getDiscordBotService } = await import('./discord-bot.service');
    if (!getDiscordBotService().getClient()) {
      logger.info(`Skipping Discord sync for cancelled/deleted request ${requestId}: bot not running`);
      return;
    }

    const { editRequestCards, cancelApprovalMessage } = await import('./discord-cards');

    // Soft delete leaves `status` untouched, so the cancelled render has to be forced.
    await editRequestCards(requestId, 'cancelled');

    if (wasAwaitingApproval) {
      // Prefer the Discord actor from the interaction; otherwise fall back to the acting user's
      // linked Discord account, and accept no attribution at all when neither exists.
      let mentionId = actorDiscordUserId ?? null;
      if (!mentionId && actorUserId) {
        const actor = await prisma.user.findUnique({
          where: { id: actorUserId },
          select: { discordUserId: true },
        });
        mentionId = actor?.discordUserId ?? null;
      }
      await cancelApprovalMessage(requestId, mentionId);
    }
  } catch (error) {
    logger.warn(`Could not sync Discord surfaces for cancelled/deleted request ${requestId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
