/**
 * Component: Discord Shared Helpers
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Shared constants, actor-logging context, and request queries used by the bot's command handlers.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '@/lib/db';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { RMABLogger } from '@/lib/utils/logger';
import type { RequestListItem } from './embeds';

const helperLogger = RMABLogger.create('Discord.Helpers');

/** Statuses considered "outstanding/ongoing" for /status. */
export const OUTSTANDING_STATUSES = [
  'pending',
  'awaiting_approval',
  'searching',
  'downloading',
  'processing',
  'awaiting_search',
  'awaiting_import',
  'awaiting_release',
  'warn',
] as const;

/** Statuses shown in the /delete dropdown (outstanding + completed). */
export const DELETABLE_STATUSES = [
  ...OUTSTANDING_STATUSES,
  'available',
  'downloaded',
] as const;

/** Build a consistent actor context for logs (Discord ID + display name + RMAB user when known). */
export function actorMeta(
  discordUser: { id: string; username: string },
  rmabUserId?: string
): { discordUserId: string; discordUsername: string; rmabUserId?: string } {
  return {
    discordUserId: discordUser.id,
    discordUsername: discordUser.username,
    ...(rmabUserId ? { rmabUserId } : {}),
  };
}

/**
 * Fetch outstanding requests for the status/delete lists. When scopeAll is true (admins), returns
 * every user's requests; otherwise only the given user's.
 */
export async function fetchOutstandingRequests(
  rmabUserId: string,
  scopeAll: boolean
): Promise<RequestListItem[]> {
  const requests = await prisma.request.findMany({
    where: {
      deletedAt: null,
      status: { in: [...OUTSTANDING_STATUSES] },
      ...(scopeAll ? {} : { userId: rmabUserId }),
    },
    include: {
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
      user: { select: { plexUsername: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return requests.map((r) => ({
    id: r.id,
    title: r.audiobook.title,
    author: r.audiobook.author,
    type: r.type,
    status: r.status,
    createdAt: r.createdAt,
    narrator: r.audiobook.narrator,
    year: r.audiobook.year,
    series: r.audiobook.series,
    seriesPart: r.audiobook.seriesPart,
    coverArtUrl: r.audiobook.coverArtUrl,
    requestedBy: scopeAll ? r.user.plexUsername : null,
  }));
}

/**
 * Whether the member who triggered a command holds the given role. Handles both a cached GuildMember
 * (roles manager) and the raw APIInteractionGuildMember (string[] of role IDs), falling back to a
 * guild member fetch when neither is available.
 */
export async function memberHasRole(
  interaction: ChatInputCommandInteraction,
  roleId: string
): Promise<boolean> {
  const member = interaction.member;
  if (member) {
    const roles = (member as { roles?: unknown }).roles;
    if (Array.isArray(roles)) return roles.includes(roleId);
    if (roles && typeof roles === 'object' && 'cache' in roles) {
      const cache = (roles as { cache: { has(id: string): boolean } }).cache;
      if (cache.has(roleId)) return true;
    }
  }
  try {
    if (interaction.guild) {
      const fetched = await interaction.guild.members.fetch(interaction.user.id);
      return fetched.roles.cache.has(roleId);
    }
  } catch {
    // Member not fetchable (left guild, missing intent) — treat as not holding the role.
  }
  return false;
}

/**
 * Fetch deletable requests for the /delete dropdown. Includes completed (available/downloaded)
 * requests in addition to outstanding ones. Scoping controlled by deletePermission config.
 */
export async function fetchDeletableRequests(
  rmabUserId: string,
  scopeAll: boolean
): Promise<RequestListItem[]> {
  const requests = await prisma.request.findMany({
    where: {
      deletedAt: null,
      status: { in: [...DELETABLE_STATUSES] },
      ...(scopeAll ? {} : { userId: rmabUserId }),
    },
    include: {
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
      user: { select: { plexUsername: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return requests.map((r) => ({
    id: r.id,
    title: r.audiobook.title,
    author: r.audiobook.author,
    type: r.type,
    status: r.status,
    createdAt: r.createdAt,
    narrator: r.audiobook.narrator,
    year: r.audiobook.year,
    series: r.audiobook.series,
    seriesPart: r.audiobook.seriesPart,
    coverArtUrl: r.audiobook.coverArtUrl,
    requestedBy: scopeAll ? r.user.plexUsername : null,
  }));
}

/** Return the owning userId of a non-deleted request, or null. Used to authorize /delete. */
export async function getRequestOwner(requestId: string): Promise<string | null> {
  const request = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null },
    select: { userId: true },
  });
  return request?.userId ?? null;
}

/**
 * Build an enriched RequestListItem for the /delete confirmation preview. Loads the request +
 * cached audiobook (incl. file size/format) and best-effort merges live Audible metadata
 * (duration, abridgement format, genres) that isn't persisted in the DB. Returns null if the
 * request no longer exists. Enrichment failures degrade gracefully to the cached fields only.
 */
export async function fetchDeletePreviewItem(
  requestId: string,
  requestedBy?: string | null
): Promise<RequestListItem | null> {
  const request = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null },
    include: {
      audiobook: {
        select: {
          title: true,
          author: true,
          narrator: true,
          year: true,
          series: true,
          seriesPart: true,
          coverArtUrl: true,
          audibleAsin: true,
          fileSizeBytes: true,
          fileFormat: true,
        },
      },
    },
  });

  if (!request) return null;
  const book = request.audiobook;

  const item: RequestListItem = {
    id: request.id,
    title: book.title,
    author: book.author,
    type: request.type,
    status: request.status,
    createdAt: request.createdAt,
    narrator: book.narrator,
    year: book.year,
    series: book.series,
    seriesPart: book.seriesPart,
    coverArtUrl: book.coverArtUrl,
    fileSizeBytes: book.fileSizeBytes != null ? Number(book.fileSizeBytes) : null,
    fileFormat: book.fileFormat,
    requestedBy: requestedBy ?? null,
  };

  // Duration / abridgement format / genres aren't stored — pull them from live Audible metadata.
  if (book.audibleAsin) {
    try {
      const details = await getAudibleService().getAudiobookDetails(book.audibleAsin);
      if (details) {
        item.durationMinutes = details.durationMinutes ?? null;
        item.formatType = details.formatType ?? null;
        item.genres = details.genres ?? null;
        // Prefer richer live series data when the cached row is missing it.
        item.series = item.series ?? details.series ?? null;
        item.seriesPart = item.seriesPart ?? details.seriesPart ?? null;
      }
    } catch (error) {
      helperLogger.warn('Audible enrichment failed for delete preview', {
        requestId,
        asin: book.audibleAsin,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return item;
}
