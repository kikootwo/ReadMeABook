/**
 * Component: Discord Shared Helpers
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Shared constants, actor-logging context, and request queries used by the bot's command handlers.
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '@/lib/db';
import type { RequestListItem } from './embeds';

/** Statuses considered "outstanding/ongoing" for /status and /delete. */
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
    include: { audiobook: { select: { title: true, author: true } } },
    orderBy: { createdAt: 'desc' },
    take: 25, // Discord select-menu cap
  });

  return requests.map((r) => ({
    id: r.id,
    title: r.audiobook.title,
    author: r.audiobook.author,
    type: r.type,
    status: r.status,
    createdAt: r.createdAt,
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

/** Return the owning userId of a non-deleted request, or null. Used to authorize /delete. */
export async function getRequestOwner(requestId: string): Promise<string | null> {
  const request = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null },
    select: { userId: true },
  });
  return request?.userId ?? null;
}
