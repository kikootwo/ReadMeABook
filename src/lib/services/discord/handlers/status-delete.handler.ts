/**
 * Component: Discord Status & Delete Handlers
 * Documentation: documentation/integrations/discord-bot.md
 *
 * /status lists the invoker's outstanding requests (admins see all) and lets them cancel their own
 * (admins: any) via the shared cancelRequest service. /delete is for RMAB admins only: it removes a
 * request and its files via the shared deleteRequest service.
 */

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { prisma } from '@/lib/db';
import { deleteRequest } from '@/lib/services/request-delete.service';
import { cancelRequest } from '@/lib/services/request-cancel.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveRmabUser, type ResolvedDiscordUser } from '../discord-user.resolver';
import {
  actorMeta,
  fetchDeletableRequests,
  fetchDeletePreviewItem,
  fetchOutstandingRequests,
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

  const result = await cancelRequest(requestId, { userId: resolved.user.id, discordUserId: interaction.user.id });
  logger.info('Request cancelled via /status', { ...meta, requestId, success: result.success });

  if (!result.success) {
    await interaction.followUp({ embeds: [errorEmbed(result.message || 'Could not cancel the request.')], ephemeral: true });
    return;
  }

  // Card + approval-embed rewrites are handled inside cancelRequest for every surface.

  const effectiveScope = resolved.isAdmin && scopeAll;
  const items = await fetchOutstandingRequests(resolved.user.id, effectiveScope);
  const { embeds, components } = buildStatusPage(items, effectiveScope, page);
  await interaction.editReply({ embeds, components });
}

/** Shown to non-admins: deleting removes library files, so users cancel instead. */
const DELETE_ADMIN_ONLY_MESSAGE =
  'Only admins can delete requests. To cancel one of your own, use /status or the Cancel button on its request card.';

/** /delete: present a dropdown of removable requests (RMAB admins only; they see every request). */
export async function handleDeleteCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()] });
    return;
  }

  if (!resolved.isAdmin) {
    await interaction.editReply({ embeds: [errorEmbed(DELETE_ADMIN_ONLY_MESSAGE)] });
    return;
  }

  const items = await fetchDeletableRequests(resolved.user.id, true);
  const { embeds, components } = buildDeletePage(items, true, 0);
  await interaction.editReply({ embeds, components });
}

/** Pagination button for /delete. */
export async function handleDeletePage(
  interaction: ButtonInteraction,
  page: number
): Promise<void> {
  await interaction.deferUpdate();

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  if (!resolved.isAdmin) {
    await interaction.editReply({ embeds: [errorEmbed(DELETE_ADMIN_ONLY_MESSAGE)], components: [] });
    return;
  }

  const items = await fetchDeletableRequests(resolved.user.id, true);
  const { embeds, components } = buildDeletePage(items, true, page);
  await interaction.editReply({ embeds, components });
}

/**
 * Shared gate for the /delete select + confirm interactions: the actor must be a linked RMAB admin.
 * Re-checked on every click because the customIds are untrusted. Replies with the error and
 * returns null when the actor isn't authorized.
 */
async function authorizeDelete(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  requestId: string
): Promise<{ resolved: ResolvedDiscordUser } | null> {
  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return null;
  }

  if (!resolved.isAdmin) {
    await interaction.editReply({ embeds: [errorEmbed(DELETE_ADMIN_ONLY_MESSAGE)], components: [] });
    logger.warn('Blocked non-admin delete attempt', {
      ...actorMeta(interaction.user, resolved.user.id),
      requestId,
    });
    return null;
  }

  return { resolved };
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
  const items = await fetchDeletableRequests(auth.resolved.user.id, true);
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

    const result = await deleteRequest(requestId, auth.resolved.user.id, interaction.user.id);
    logger.info('Request deleted via Discord', { ...meta, requestId, success: result.success });

    if (!result.success) {
      await interaction.editReply({
        embeds: [errorEmbed(result.message || 'Failed to delete the request.')],
        components: [],
      });
      return;
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
