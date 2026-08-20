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
import { deleteRequest } from '@/lib/services/request-delete.service';
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

/** Whether the clicking member is authorized to approve/deny (RMAB admin or holds the admin role). */
async function isAuthorizedApprover(
  interaction: ButtonInteraction
): Promise<{ authorized: boolean; rmabUserId?: string }> {
  const config = await getDiscordConfig();

  const resolved = await resolveRmabUser(interaction.user.id);
  if (resolved?.isAdmin) {
    return { authorized: true, rmabUserId: resolved.user.id };
  }

  // Fall back to Discord role check
  if (config.adminRoleId && interaction.inCachedGuild()) {
    if (interaction.member.roles.cache.has(config.adminRoleId)) {
      return { authorized: true, rmabUserId: resolved?.user.id };
    }
  }

  return { authorized: false, rmabUserId: resolved?.user.id };
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

  if (!authorized) {
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
    adminUserId: rmabUserId ?? `discord:${interaction.user.id}`,
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
  // processRequestApproval now, so every surface (Web UI, API token, buttons) converges on the same
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
 * or any admin (RMAB admin / admin role). Cancels via the shared deleteRequest service (stops
 * search/download, handles seeding) and re-renders the card(s) to the cancelled state.
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

  // Authorize: the original requester, or an admin (RMAB admin / admin role).
  const resolved = await resolveRmabUser(interaction.user.id);
  let authorized = !!resolved && resolved.user.id === request.userId;
  let rmabUserId = resolved?.user.id;
  if (!authorized) {
    const adminCheck = await isAuthorizedApprover(interaction);
    authorized = adminCheck.authorized;
    rmabUserId = rmabUserId ?? adminCheck.rmabUserId;
  }

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

  // Record the RMAB user id as the actor; null when an admin-role holder has no linked account so we
  // never persist a non-RMAB identifier as deletedBy. The Discord id is passed separately purely to
  // attribute the "Cancelled by" mention.
  const result = await deleteRequest(requestId, rmabUserId ?? null, interaction.user.id);
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

  // The card and approval-embed rewrites now live inside deleteRequest, so every deletion path
  // (Web UI, API token, /status, /delete) converges on the same cleanup.
}

