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
import { resolveRmabUser, type ResolvedDiscordUser } from '../discord-user.resolver';
import {
  actorMeta,
  fetchDeletableRequests,
  fetchDeletePreviewItem,
  fetchOutstandingRequests,
  getRequestOwner,
} from '../discord-helpers';
import {
  buildDeleteConfirmButtons,
  buildDeleteConfirmEmbed,
  buildDeletePage,
  buildDeletePreviewEmbed,
  buildDeleteSelect,
  buildStatusPage,
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

/**
 * Shared gate for the /delete select + confirm interactions: enforces the deletePermission config
 * and (for non-admins, unless anyone_any) ownership of the target request. Replies with the
 * appropriate error and returns null when the actor isn't authorized.
 */
async function authorizeDelete(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  requestId: string
): Promise<{ resolved: ResolvedDiscordUser; scopeAll: boolean } | null> {
  const config = await getDiscordConfig();
  const perm = config.deletePermission;

  if (perm === 'disabled') {
    await interaction.editReply({
      embeds: [errorEmbed('The /delete command is disabled by the server administrator.')],
      components: [],
    });
    return null;
  }

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return null;
  }

  if (perm === 'admin_only' && !resolved.isAdmin) {
    await interaction.editReply({
      embeds: [errorEmbed('Only admins can use /delete on this server.')],
      components: [],
    });
    return null;
  }

  // Ownership check: anyone_any skips it for non-admins; own_only enforces it.
  if (!resolved.isAdmin && perm !== 'anyone_any') {
    const ownerId = await getRequestOwner(requestId);
    if (ownerId !== resolved.user.id) {
      await interaction.editReply({
        embeds: [errorEmbed('You can only delete your own requests.')],
        components: [],
      });
      logger.warn('Blocked cross-user delete attempt', {
        ...actorMeta(interaction.user, resolved.user.id),
        requestId,
      });
      return null;
    }
  }

  return { resolved, scopeAll: resolved.isAdmin || perm === 'anyone_any' };
}

/**
 * Dropdown select for /delete: authorize, then render a confirmation preview (enriched with
 * duration/series/format/genre/file size) with Confirm/Cancel buttons. Nothing is deleted yet — the
 * dropdown stays so the user can switch titles, and only the Confirm button commits the deletion.
 */
export async function handleDeleteSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  await interaction.deferUpdate();

  const requestId = interaction.values[0];
  const auth = await authorizeDelete(interaction, requestId);
  if (!auth) return;

  // Re-fetch the deletable set so the dropdown persists (letting the user pick a different title)
  // and to recover the requester name shown to admins.
  const items = await fetchDeletableRequests(auth.resolved.user.id, auth.scopeAll);
  const requestedBy = items.find((i) => i.id === requestId)?.requestedBy ?? null;

  const previewItem = await fetchDeletePreviewItem(requestId, requestedBy);
  if (!previewItem) {
    await interaction.editReply({
      embeds: [errorEmbed('That request no longer exists.')],
      components: [],
    });
    return;
  }

  const components = [];
  const selectRow = buildDeleteSelect(items);
  if (selectRow) components.push(selectRow);
  components.push(buildDeleteConfirmButtons(requestId));

  await interaction.editReply({ embeds: [buildDeletePreviewEmbed(previewItem)], components });
}

/** Confirm button on the /delete preview: re-authorize (the customId is untrusted) and delete. */
export async function handleDeleteConfirm(
  interaction: ButtonInteraction,
  requestId: string
): Promise<void> {
  await interaction.deferUpdate();

  const auth = await authorizeDelete(interaction, requestId);
  if (!auth) return;

  const meta = actorMeta(interaction.user, auth.resolved.user.id);

  try {
    // Capture the enriched item while the request still exists, so the final embed matches the
    // preview the user confirmed (and we know whether to retract a pending approval message).
    const item = await fetchDeletePreviewItem(requestId);
    if (!item) {
      await interaction.editReply({
        embeds: [errorEmbed('That request no longer exists.')],
        components: [],
      });
      return;
    }

    const result = await deleteRequest(requestId, auth.resolved.user.id);
    logger.info('Request deleted via Discord', { ...meta, requestId, success: result.success });

    if (!result.success) {
      await interaction.editReply({
        embeds: [errorEmbed(result.message || 'Failed to delete the request.')],
        components: [],
      });
      return;
    }

    if (item.status === 'awaiting_approval') {
      await cancelApprovalMessage(requestId, interaction.user.id).catch(() => undefined);
    }

    await interaction.editReply({ embeds: [buildDeleteConfirmEmbed(item)], components: [] });
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

/** Cancel button on the /delete preview: dismiss without deleting anything. */
export async function handleDeleteCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [infoEmbed('Deletion cancelled', 'Nothing was removed.')],
    components: [],
  }).catch(() => undefined);
}
