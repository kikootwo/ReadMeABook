/**
 * Component: Discord Approval Handler
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Posts admin-approval requests (role ping + embed + Approve/Deny buttons) for Discord-originated
 * requests that need approval, and handles the button clicks by running the shared approval service.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { prisma } from '@/lib/db';
import { processRequestApproval, type ApprovalAction } from '@/lib/services/request-approval.service';
import { cancelRequest } from '@/lib/services/request-cancel.service';
import { RMABLogger } from '@/lib/utils/logger';
import { getDiscordConfig, getApprovalChannelId } from '../discord-config';
import { resolveRmabUser } from '../discord-user.resolver';
import { buildApprovalMessage, errorEmbed } from '../embeds';
import {
  editRequestCards,
  recordApprovalMessage,
  reconcileApprovalMessage,
} from '../discord-cards';
import { actorMeta } from '../discord-helpers';

const logger = RMABLogger.create('Discord.Approval');

/**
 * Post an approval request to the configured admin channel, pinging the admin role.
 * Best-effort: logs and returns on misconfiguration rather than throwing into the command flow.
 */
export async function postApprovalRequest(
  client: Client,
  params: {
    requestId: string;
    title: string;
    author: string;
    mediaType: string;
    requestedBy: string;
    narrator?: string | null;
    durationMinutes?: number | null;
    year?: number | null;
    series?: string | null;
    seriesPart?: string | null;
    formatType?: string | null;
    genres?: string[] | null;
    coverArtUrl?: string | null;
  }
): Promise<void> {
  try {
    const config = await getDiscordConfig();
    const channelId = getApprovalChannelId(config);

    if (!channelId) {
      logger.warn('Request needs approval but no approval channel is configured', {
        requestId: params.requestId,
      });
      return;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      logger.warn('Approval channel is missing or not a text channel', { channelId });
      return;
    }

    const { embed, row } = buildApprovalMessage(params);
    const content = config.adminRoleId ? `<@&${config.adminRoleId}>` : undefined;

    const sent = await channel.send({ content, embeds: [embed], components: [row] });
    // Persist the approval message location so it can be rewritten if the request is cancelled
    // before a decision is made.
    await recordApprovalMessage(params.requestId, sent.channelId, sent.id);
    logger.info('Posted approval request to admin channel', {
      requestId: params.requestId,
      channelId,
    });
  } catch (error) {
    logger.error('Failed to post approval request', {
      requestId: params.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Whether the clicking Discord user may approve/deny: their Discord account must be linked to an
 * RMAB admin. The admin role only decides who gets pinged; holding it grants no authority, since a
 * Discord role is handed out outside RMAB.
 */
async function isAuthorizedApprover(
  interaction: ButtonInteraction
): Promise<{ authorized: boolean; rmabUserId?: string }> {
  const resolved = await resolveRmabUser(interaction.user.id);
  return { authorized: !!resolved?.isAdmin, rmabUserId: resolved?.user.id };
}

/** Build a disabled copy of the Approve/Deny row to lock the message after a decision. */
function disabledDecisionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('disabled:approve').setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(true),
    new ButtonBuilder().setCustomId('disabled:deny').setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(true)
  );
}

/** Handle an Approve/Deny button click. */
export async function handleApprovalButton(
  interaction: ButtonInteraction,
  action: 'approve' | 'deny',
  requestId: string
): Promise<void> {
  const { authorized, rmabUserId } = await isAuthorizedApprover(interaction);

  if (!authorized || !rmabUserId) {
    await interaction.reply({
      embeds: [errorEmbed('You do not have permission to approve or deny requests.')],
      ephemeral: true,
    });
    logger.warn('Unauthorized approval attempt', {
      ...actorMeta(interaction.user, rmabUserId),
      requestId,
      action,
    });
    return;
  }

  await interaction.deferUpdate();

  const result = await processRequestApproval({
    requestId,
    action,
    adminUserId: rmabUserId,
  });

  if (!result.success) {
    // Stale/invalid: re-render the message from the request's current persisted state. Merely
    // disabling the buttons left the embed reading "Pending" for a request that was already
    // decided or cancelled elsewhere, which looked like nothing had happened at all.
    await reconcileApprovalMessage(requestId).catch(() => undefined);
    await interaction.message
      .edit({ components: [disabledDecisionRow()] })
      .catch(() => undefined);
    await interaction.followUp({
      embeds: [errorEmbed(result.message)],
      ephemeral: true,
    });
    logger.info('Approval action could not be applied', {
      ...actorMeta(interaction.user, rmabUserId),
      requestId,
      action,
      reason: result.reason,
    });
    return;
  }

  // The approval message rewrite, card refresh, and requester DM all happen inside
  // processRequestApproval now, so every surface (Web UI, buttons) converges on the same
  // result. Nothing message-specific is done here.
  const pastTense = action === 'approve' ? 'approved' : 'denied';
  logger.info(`Request ${pastTense} via Discord`, {
    ...actorMeta(interaction.user, rmabUserId),
    requestId,
    action,
  });
}

/**
 * Handle the "Cancel Request" button on a live request card. Authorized for the original requester
 * or a Discord user linked to an RMAB admin. Cancels via the shared cancelRequest service (status →
 * 'cancelled', background jobs stop; nothing is deleted) and re-renders the card(s) to the
 * cancelled state.
 */
export async function handleCancelRequestButton(
  interaction: ButtonInteraction,
  requestId: string
): Promise<void> {
  await interaction.deferUpdate();

  const request = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null },
    select: { userId: true, status: true },
  });

  if (!request) {
    await interaction.followUp({
      embeds: [errorEmbed('That request no longer exists.')],
      ephemeral: true,
    });
    // The card is stale -- rewrite it to cancelled so the dead button does not linger.
    await editRequestCards(requestId, 'cancelled').catch(() => undefined);
    return;
  }

  // Authorize: the original requester, or a Discord user linked to an RMAB admin (a role alone
  // isn't enough).
  const resolved = await resolveRmabUser(interaction.user.id);
  const rmabUserId = resolved?.user.id;
  const authorized = !!resolved && (resolved.user.id === request.userId || resolved.isAdmin);

  if (!authorized) {
    await interaction.followUp({
      embeds: [errorEmbed('You can only cancel your own requests (admins can cancel any).')],
      ephemeral: true,
    });
    logger.warn('Unauthorized cancel attempt', {
      ...actorMeta(interaction.user, rmabUserId),
      requestId,
    });
    return;
  }

  // The Discord id attributes the "Cancelled by" mention on a pending approval message.
  const result = await cancelRequest(requestId, { userId: resolved.user.id, discordUserId: interaction.user.id });
  logger.info('Request cancelled via Discord', {
    ...actorMeta(interaction.user, rmabUserId),
    requestId,
    success: result.success,
  });

  if (!result.success) {
    await interaction.followUp({
      embeds: [errorEmbed(result.message || 'Could not cancel the request.')],
      ephemeral: true,
    });
    return;
  }

  // The card and approval-embed rewrites live inside cancelRequest, so every cancel path
  // (Web UI, card button, /status) converges on the same cleanup.
}

