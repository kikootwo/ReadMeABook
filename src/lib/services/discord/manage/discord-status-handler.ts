/**
 * Component: Discord /status and Cancel
 * Documentation: documentation/integrations/discord-bot.md
 *
 * `/status` lists the linked account's requests (an RMAB admin's lists every user's) with page
 * buttons and a Cancel menu for the ones that can still be cancelled. A request card and an
 * approval message carry a Cancel button too. Every step acknowledges Discord first (a cancel
 * can take up to 10 s while the download client answers), then resolves the clicking user to an
 * RMAB account (no cache) and, for a cancel, reads the request again: only its requester or an
 * RMAB admin (database role) may cancel it. Then the shared cancel service runs, exactly as the
 * web cancel does. Holding a Discord role grants nothing here. Cards follow through the service.
 */

import { prisma } from '@/lib/db';
import { cancelLoadedRequest, cancelMessage, type CancelAudience, type CancelResult } from '@/lib/services/request-cancel.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveDiscordActor, type DiscordActor } from '../discord-actor';
import { decodeManageCustomId, isRequestId } from '../discord-custom-id';
import { textOnly } from '../discord-format';
import { statusLabel } from '../cards/discord-card-embeds';
import { EPHEMERAL, MANAGE_TEXT, failQuietly, type ManageInteraction } from './discord-manage-common';
import { pageReply, readRequestPage } from './discord-request-list';

const logger = RMABLogger.create('Discord.Status');

/** What the cancel service needs, plus the requester, for the requester check. */
const CANCEL_RECORD_SELECT = {
  id: true,
  userId: true,
  status: true,
  audiobookId: true,
  type: true,
  audiobook: { select: { title: true, author: true } },
  user: { select: { plexUsername: true } },
} as const;

/**
 * The fixed reply for a cancel result, chosen by its result fields. The download client is never
 * named, and a requester is never told that another request shares the download.
 */
export function cancelReplyText(result: CancelResult, audience: CancelAudience): string {
  if (!result.success) {
    if (result.reason === 'not_found') return MANAGE_TEXT.notFound;
    return `This request can no longer be cancelled. Status: ${statusLabel({ status: result.status, deletedAt: null })}.`;
  }
  if (result.alreadyCancelled) return MANAGE_TEXT.alreadyCancelled;
  if (result.download === 'kept') return 'Request cancelled. Its download stays in the download client.';
  return cancelMessage(result.download, audience);
}

/** Cancels the request as `actor` when it is theirs or they are an RMAB admin; returns the reply text. */
export async function cancelAsActor(actor: DiscordActor, requestId: string): Promise<string> {
  const record = await prisma.request.findFirst({ where: { id: requestId, deletedAt: null }, select: CANCEL_RECORD_SELECT });
  if (!record) return MANAGE_TEXT.notFound;
  if (record.userId !== actor.userId && !actor.isAdmin) {
    logger.info('Refused a Discord cancel of another user\'s request', { userId: actor.userId, requestId });
    return MANAGE_TEXT.notYours;
  }
  const audience: CancelAudience = actor.isAdmin ? 'admin' : 'owner';
  const result = await cancelLoadedRequest(record, { audience });
  logger.info('Discord cancel', { userId: actor.userId, requestId, outcome: result.success ? (result.alreadyCancelled ? 'already' : 'cancelled') : result.reason });
  return cancelReplyText(result, audience);
}

/** Slash command `/status`. */
export async function handleStatusCommand(interaction: ManageInteraction): Promise<void> {
  if (interaction.guildId === null || !interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply(EPHEMERAL);
    const actor = await resolveDiscordActor(interaction.user.id);
    if (!actor) {
      await interaction.editReply(textOnly(MANAGE_TEXT.notLinked));
      return;
    }
    await interaction.editReply(pageReply('status', actor, await readRequestPage(actor, 0)));
  } catch (error) {
    await failQuietly(interaction, 'status', error);
  }
}

/**
 * Status page buttons, the Cancel menu on a page, and the Cancel button on a card or approval
 * message (custom_id `rmab:sts:`). A card can sit in a DM; the checks below do not depend on where.
 */
export async function handleStatusComponent(interaction: ManageInteraction): Promise<void> {
  const id = decodeManageCustomId(interaction.customId);
  if (!id || id.area !== 'status') {
    logger.debug('Ignored a status interaction with an unknown custom id');
    return;
  }

  try {
    if (id.action === 'cancel' && interaction.isButton()) {
      // A new ephemeral reply: the card itself is updated by the cancel
      await interaction.deferReply(EPHEMERAL);
      const actor = await resolveDiscordActor(interaction.user.id);
      await interaction.editReply(textOnly(actor ? await cancelAsActor(actor, id.requestId) : MANAGE_TEXT.notLinked));
      return;
    }

    const isPage = id.action === 'page' && interaction.isButton();
    const isMenu = id.action === 'menu' && interaction.isStringSelectMenu();
    if (!isPage && !isMenu) {
      logger.debug('Ignored a status interaction whose kind does not match its custom id', { action: id.action });
      return;
    }

    await interaction.deferUpdate();
    const actor = await resolveDiscordActor(interaction.user.id);
    if (!actor) {
      await interaction.editReply(textOnly(MANAGE_TEXT.notLinked));
      return;
    }
    let notice = '';
    if (isMenu) {
      const requestId = interaction.values?.[0];
      notice = isRequestId(requestId) ? await cancelAsActor(actor, requestId) : MANAGE_TEXT.staleChoice;
    }
    // The page is listed for the account acting now, whatever page the custom_id names
    await interaction.editReply(pageReply('status', actor, await readRequestPage(actor, id.page), notice));
  } catch (error) {
    await failQuietly(interaction, `status ${id.action}`, error);
  }
}
