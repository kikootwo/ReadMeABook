/**
 * Component: Discord Status & Delete Handlers
 * Documentation: documentation/integrations/discord-bot.md
 *
 * /status lists the invoker's outstanding requests (admins see all). /delete lets the invoker
 * remove one of their requests (admins can remove any) via the shared deleteRequest service.
 */

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { prisma } from '@/lib/db';
import { deleteRequest } from '@/lib/services/request-delete.service';
import { RMABLogger } from '@/lib/utils/logger';
import { cancelApprovalMessage, editRequestCards } from '../discord-cards';
import { getDiscordConfig } from '../discord-config';
import { resolveRmabUser } from '../discord-user.resolver';
import {
  actorMeta,
  fetchDeletableRequests,
  fetchOutstandingRequests,
  getRequestOwner,
} from '../discord-helpers';
import {
  buildDeleteConfirmEmbed,
  buildDeletePage,
  buildStatusPage,
  errorEmbed,
  notLinkedEmbed,
  type RequestListItem,
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

  const { embeds, components } = buildStatusPage(items, resolved.isAdmin, 0);
  await interaction.editReply({ embeds, components });
}

/** Pagination button for /status. */
export async function handleStatusPage(
  interaction: ButtonInteraction,
  page: number,
  scopeAll: boolean
): Promise<void> {
  await interaction.deferUpdate();

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  const effectiveScope = resolved.isAdmin && scopeAll;
  const items = await fetchOutstandingRequests(resolved.user.id, effectiveScope);
  const { embeds, components } = buildStatusPage(items, effectiveScope, page);
  await interaction.editReply({ embeds, components });
}

/** Cancel-from-status select menu: cancel a request and re-render the /status page. */
export async function handleStatusCancel(
  interaction: StringSelectMenuInteraction,
  page: number,
  scopeAll: boolean
): Promise<void> {
  await interaction.deferUpdate();

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  const requestId = interaction.values[0];
  const meta = actorMeta(interaction.user, resolved.user.id);

  const request = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null },
    select: { userId: true, status: true },
  });

  if (!request) {
    await interaction.followUp({ embeds: [errorEmbed('That request no longer exists.')], ephemeral: true });
    return;
  }

  if (!resolved.isAdmin && request.userId !== resolved.user.id) {
    await interaction.followUp({ embeds: [errorEmbed('You can only cancel your own requests.')], ephemeral: true });
    logger.warn('Blocked cross-user cancel attempt', { ...meta, requestId });
    return;
  }

  const wasAwaitingApproval = request.status === 'awaiting_approval';
  const result = await deleteRequest(requestId, resolved.user.id);
  logger.info('Request cancelled via /status', { ...meta, requestId, success: result.success });

  if (!result.success) {
    await interaction.followUp({ embeds: [errorEmbed(result.message || 'Could not cancel the request.')], ephemeral: true });
    return;
  }

  await editRequestCards(requestId, 'cancelled').catch(() => undefined);
  if (wasAwaitingApproval) {
    await cancelApprovalMessage(requestId, interaction.user.id).catch(() => undefined);
  }

  const effectiveScope = resolved.isAdmin && scopeAll;
  const items = await fetchOutstandingRequests(resolved.user.id, effectiveScope);
  const { embeds, components } = buildStatusPage(items, effectiveScope, page);
  await interaction.editReply({ embeds, components });
}

/** /delete: present a dropdown of removable requests, gated by deletePermission config. */
export async function handleDeleteCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const config = await getDiscordConfig();
  const perm = config.deletePermission;

  if (perm === 'disabled') {
    await interaction.editReply({
      embeds: [errorEmbed('The /delete command is disabled by the server administrator.')],
    });
    return;
  }

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()] });
    return;
  }

  if (perm === 'admin_only' && !resolved.isAdmin) {
    await interaction.editReply({
      embeds: [errorEmbed('Only admins can use /delete on this server.')],
    });
    return;
  }

  // anyone_any: admins see all, non-admins see all too
  // own_only: admins see all, non-admins see only their own
  // admin_only: only admins reach here (checked above), always see all
  const scopeAll = resolved.isAdmin || perm === 'anyone_any';

  const items = await fetchDeletableRequests(resolved.user.id, scopeAll);
  const { embeds, components } = buildDeletePage(items, scopeAll, 0);
  await interaction.editReply({ embeds, components });
}

/** Pagination button for /delete. */
export async function handleDeletePage(
  interaction: ButtonInteraction,
  page: number,
  scopeAll: boolean
): Promise<void> {
  await interaction.deferUpdate();

  const config = await getDiscordConfig();
  const perm = config.deletePermission;

  if (perm === 'disabled') {
    await interaction.editReply({
      embeds: [errorEmbed('The /delete command is disabled by the server administrator.')],
      components: [],
    });
    return;
  }

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  if (perm === 'admin_only' && !resolved.isAdmin) {
    await interaction.editReply({
      embeds: [errorEmbed('Only admins can use /delete on this server.')],
      components: [],
    });
    return;
  }

  const effectiveScope = resolved.isAdmin || perm === 'anyone_any';
  const items = await fetchDeletableRequests(resolved.user.id, effectiveScope);
  const { embeds, components } = buildDeletePage(items, effectiveScope, page);
  await interaction.editReply({ embeds, components });
}

/** Dropdown select for /delete: authorize ownership + permission level, then delete. */
export async function handleDeleteSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  await interaction.deferUpdate();

  const config = await getDiscordConfig();
  const perm = config.deletePermission;

  if (perm === 'disabled') {
    await interaction.editReply({
      embeds: [errorEmbed('The /delete command is disabled by the server administrator.')],
      components: [],
    });
    return;
  }

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  if (perm === 'admin_only' && !resolved.isAdmin) {
    await interaction.editReply({
      embeds: [errorEmbed('Only admins can use /delete on this server.')],
      components: [],
    });
    return;
  }

  const requestId = interaction.values[0];
  const meta = actorMeta(interaction.user, resolved.user.id);

  // Ownership check: anyone_any skips it for non-admins; own_only enforces it
  if (!resolved.isAdmin && perm !== 'anyone_any') {
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
    const before = await prisma.request.findUnique({
      where: { id: requestId },
      select: {
        status: true,
        type: true,
        audiobook: {
          select: {
            title: true,
            author: true,
            narrator: true,
            year: true,
            series: true,
            seriesPart: true,
            coverArtUrl: true,
          },
        },
      },
    });

    const result = await deleteRequest(requestId, resolved.user.id);
    logger.info('Request deleted via Discord', { ...meta, requestId, success: result.success });

    if (result.success && before?.status === 'awaiting_approval') {
      await cancelApprovalMessage(requestId, interaction.user.id).catch(() => undefined);
    }

    if (result.success && before) {
      const item: RequestListItem = {
        id: requestId,
        title: before.audiobook.title,
        author: before.audiobook.author,
        type: before.type,
        status: before.status,
        createdAt: new Date(),
        narrator: before.audiobook.narrator,
        year: before.audiobook.year,
        series: before.audiobook.series,
        seriesPart: before.audiobook.seriesPart,
        coverArtUrl: before.audiobook.coverArtUrl,
      };
      await interaction.editReply({
        embeds: [buildDeleteConfirmEmbed(item)],
        components: [],
      });
    } else {
      await interaction.editReply({
        embeds: [errorEmbed(result.message || 'Failed to delete the request.')],
        components: [],
      });
    }
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
