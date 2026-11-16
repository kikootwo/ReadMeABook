/**
 * Component: Discord Approval Decision Sync
 * Documentation: documentation/integrations/discord-bot.md
 *
 * After an approve or deny (web or Discord), reached only through the running-check facade,
 * in the background: the approval message shows the decision and loses its buttons, the
 * request's cards show the new status, and the requester gets a DM. The DM goes only for a
 * request made in Discord (`discordCards` set) to the Discord account linked to the requester
 * now. Never throws: every failure is logged.
 */

import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import type { DiscordBotService } from '../discord-bot.service';
import { isSnowflake } from '../discord-snowflake';
import { decisionDmBody } from './discord-card-embeds';
import { CardMessenger } from './discord-card-messages';
import { refreshRequestCards } from './discord-cards';

const logger = RMABLogger.create('Discord.Decision');

export async function syncApprovalDecision(
  bot: DiscordBotService,
  requestId: string,
  decision: 'approved' | 'denied'
): Promise<void> {
  try {
    const request = await refreshRequestCards(bot, requestId, decision);
    const client = bot.getClient();
    if (!request || request.discordCards === null || !client) return;
    const discordUserId = request.user.discordUserId;
    if (!isSnowflake(discordUserId)) return;
    await CardMessenger.fromClient(client).sendDm('dm', discordUserId, decisionDmBody(request, decision));
  } catch (error) {
    logger.warn('Discord approval decision update failed', { requestId, decision, error: errorForLog(error) });
  }
}
