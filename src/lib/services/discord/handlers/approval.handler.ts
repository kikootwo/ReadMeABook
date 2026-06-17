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
import { processRequestApproval } from '@/lib/services/request-approval.service';
import { RMABLogger } from '@/lib/utils/logger';
import { getDiscordConfig, getApprovalChannelId } from '../discord-config';
import { resolveRmabUser } from '../discord-user.resolver';
import { buildApprovalMessage, errorEmbed, infoEmbed } from '../embeds';
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
    year?: number | null;
    series?: string | null;
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

    await channel.send({ content, embeds: [embed], components: [row] });
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
    // Stale/invalid: lock the buttons and note why
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

  // Lock the original message and append the outcome
  const outcome = action === 'approve' ? '✅ Approved' : '🚫 Denied';
  const decidedBy = interaction.user.username;
  await interaction.message
    .edit({
      content: `${outcome} by ${decidedBy}`,
      components: [disabledDecisionRow()],
    })
    .catch(() => undefined);

  const pastTense = action === 'approve' ? 'approved' : 'denied';
  logger.info(`Request ${pastTense} via Discord`, {
    ...actorMeta(interaction.user, rmabUserId),
    requestId,
    action,
  });

  // Notify the requester via DM (best-effort)
  if (action === 'approve') {
    await notifyRequester(interaction.client, requestId).catch(() => undefined);
  }
}

/** DM the original requester that their request was approved (best-effort). */
async function notifyRequester(client: Client, requestId: string): Promise<void> {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      audiobook: { select: { title: true } },
      user: { select: { discordUserId: true } },
    },
  });

  const discordUserId = request?.user.discordUserId;
  if (!discordUserId) return;

  try {
    const user = await client.users.fetch(discordUserId);
    await user.send({
      embeds: [
        infoEmbed(
          '✅ Request approved',
          `Your request for **${request?.audiobook.title}** has been approved and is now being processed.`
        ),
      ],
    });
  } catch (error) {
    logger.warn('Could not DM requester about approval', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
