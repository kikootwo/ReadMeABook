/**
 * Component: Discord Status & Delete Handlers
 * Documentation: documentation/integrations/discord-bot.md
 *
 * /status lists the invoker's outstanding requests (admins see all). /delete lets the invoker
 * remove one of their requests (admins can remove any) via the shared deleteRequest service.
 */

import type {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { prisma } from '@/lib/db';
import { deleteRequest } from '@/lib/services/request-delete.service';
import { RMABLogger } from '@/lib/utils/logger';
import { cancelApprovalMessage } from '../discord-cards';
import { resolveRmabUser } from '../discord-user.resolver';
import {
  actorMeta,
  fetchOutstandingRequests,
  getRequestOwner,
} from '../discord-helpers';
import {
  buildDeleteSelect,
  buildStatusEmbed,
  errorEmbed,
  infoEmbed,
  notLinkedEmbed,
} from '../embeds';

const logger = RMABLogger.create('Discord.StatusDelete');

/** /status: show outstanding requests (own by default; all for admins). */
export async function handleStatusCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()] });
    return;
  }

  const items = await fetchOutstandingRequests(resolved.user.id, resolved.isAdmin);
  logger.info('Status viewed', { ...actorMeta(interaction.user, resolved.user.id), scopeAll: resolved.isAdmin, count: items.length });

  await interaction.editReply({ embeds: [buildStatusEmbed(items, resolved.isAdmin)] });
}

/** /delete: present a dropdown of removable requests. */
export async function handleDeleteCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()] });
    return;
  }

  const items = await fetchOutstandingRequests(resolved.user.id, resolved.isAdmin);
  const row = buildDeleteSelect(items);

  if (!row) {
    await interaction.editReply({
      embeds: [infoEmbed('Nothing to delete', 'You have no outstanding requests.')],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      infoEmbed(
        resolved.isAdmin ? 'Delete a request' : 'Delete one of your requests',
        'Select a request below to remove it from ReadMeABook.'
      ),
    ],
    components: [row],
  });
}

/** Dropdown select for /delete: authorize ownership, then delete. */
export async function handleDeleteSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  await interaction.deferUpdate();

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  const requestId = interaction.values[0];
  const meta = actorMeta(interaction.user, resolved.user.id);

  // Non-admins may only delete their own requests
  if (!resolved.isAdmin) {
    const ownerId = await getRequestOwner(requestId);
    if (ownerId !== resolved.user.id) {
      await interaction.editReply({
        embeds: [errorEmbed('You can only delete your own requests.')],
        components: [],
      });
      logger.warn('Blocked cross-user delete attempt', { ...meta, requestId });
      return;
    }
  }

  try {
    // Capture status before deletion so we can update the approval message if it was still pending.
    const before = await prisma.request.findUnique({
      where: { id: requestId },
      select: { status: true },
    });

    const result = await deleteRequest(requestId, resolved.user.id);
    logger.info('Request deleted via Discord', { ...meta, requestId, success: result.success });

    if (result.success && before?.status === 'awaiting_approval') {
      await cancelApprovalMessage(requestId, interaction.user.id).catch(() => undefined);
    }

    await interaction.editReply({
      embeds: [
        result.success
          ? infoEmbed('🗑️ Request deleted', result.message)
          : errorEmbed(result.message || 'Failed to delete the request.'),
      ],
      components: [],
    });
  } catch (error) {
    logger.error('Failed to delete request', {
      ...meta,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    await interaction.editReply({
      embeds: [errorEmbed('Failed to delete the request. Please try again.')],
      components: [],
    });
  }
}
