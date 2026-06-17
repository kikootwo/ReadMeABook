/**
 * Component: Discord REST Helper
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Token-based REST calls used by the settings Test/Resolve endpoints, which run inside API routes
 * without a gateway connection (and may run before the bot is started). Proactive sends that occur
 * during a live interaction use the gateway client directly instead of this helper.
 */

import { REST, Routes } from 'discord.js';

function makeRest(token: string): REST {
  return new REST({ version: '10' }).setToken(token);
}

export interface ResolvedName {
  id: string;
  name: string;
}

/** A guild member matched by the member-search endpoint, shaped for the user-mapping UI. */
export interface DiscordMemberResult {
  id: string;
  /** Discord account username (the global handle). */
  username: string;
  /** Best display name: server nickname → global display name → username. */
  displayName: string;
  /** A 64px avatar URL (guild avatar → user avatar → default embed avatar). */
  avatarUrl: string;
}

interface RawGuildMember {
  user?: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
    discriminator?: string;
  };
  nick?: string | null;
  avatar?: string | null;
  roles?: string[];
}

/** Resolve a 64px avatar URL for a guild member (guild avatar → user avatar → default). */
function memberAvatarUrl(guildId: string, member: RawGuildMember): string {
  const user = member.user!;
  if (member.avatar) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=64`;
  }
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  }
  let index = 0;
  if (user.discriminator && user.discriminator !== '0') {
    index = Number(user.discriminator) % 5;
  } else {
    try {
      index = Number((BigInt(user.id) >> BigInt(22)) % BigInt(6));
    } catch {
      index = 0;
    }
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Resolve a single member by ID to the mapping-UI shape. Falls back to a bare user fetch, then ID. */
export async function resolveMemberById(
  token: string,
  guildId: string,
  userId: string
): Promise<DiscordMemberResult> {
  const rest = makeRest(token);
  try {
    const member = (await rest.get(Routes.guildMember(guildId, userId))) as RawGuildMember;
    if (member.user) {
      return {
        id: member.user.id,
        username: member.user.username,
        displayName: member.nick || member.user.global_name || member.user.username,
        avatarUrl: memberAvatarUrl(guildId, member),
      };
    }
  } catch {
    // Not a guild member (or no access) — fall through to a plain user lookup.
  }
  try {
    const user = (await rest.get(Routes.user(userId))) as RawGuildMember['user'];
    if (user) {
      return {
        id: user.id,
        username: user.username,
        displayName: user.global_name || user.username,
        avatarUrl: memberAvatarUrl(guildId, { user }),
      };
    }
  } catch {
    // Unknown user — return a minimal placeholder so the UI still renders something.
  }
  return {
    id: userId,
    username: userId,
    displayName: userId,
    avatarUrl: memberAvatarUrl(guildId, { user: { id: userId, username: userId } }),
  };
}

/** Resolve many member IDs at once (best-effort per ID). */
export async function resolveMembersByIds(
  token: string,
  guildId: string,
  ids: string[]
): Promise<DiscordMemberResult[]> {
  return Promise.all(ids.map((id) => resolveMemberById(token, guildId, id)));
}

/**
 * Search a guild's members by name (matches username and server nickname). Optionally restrict to
 * members holding `roleId`. Requires the bot to be in the guild with the Server Members intent.
 */
export async function searchGuildMembers(
  token: string,
  guildId: string,
  query: string,
  roleId?: string | null
): Promise<DiscordMemberResult[]> {
  const rest = makeRest(token);
  const members = (await rest.get(`/guilds/${guildId}/members/search`, {
    query: new URLSearchParams({ query, limit: '10' }),
  })) as RawGuildMember[];

  return members
    .filter((m) => m.user && (!roleId || (m.roles ?? []).includes(roleId)))
    .map((m) => {
      const user = m.user!;
      return {
        id: user.id,
        username: user.username,
        displayName: m.nick || user.global_name || user.username,
        avatarUrl: memberAvatarUrl(guildId, m),
      };
    });
}

/**
 * Validate a bot token by fetching the bot's own user. Throws on invalid token.
 * Returns the bot's id (== its application id for bot accounts), username, and a 64px avatar URL.
 */
export async function fetchBotUser(
  token: string
): Promise<{ id: string; username: string; avatarUrl: string }> {
  const rest = makeRest(token);
  const user = (await rest.get(Routes.user('@me'))) as {
    id: string;
    username: string;
    avatar?: string | null;
    discriminator?: string;
  };
  return {
    id: user.id,
    username: user.username,
    avatarUrl: memberAvatarUrl('', { user }),
  };
}

/**
 * Resolve a channel ID to its name (e.g. "#general").
 *
 * Prefers the guild-level listing (`GET /guilds/{id}/channels`), which returns every channel for a
 * bot that's a member of the guild regardless of per-channel View permission. This is consistent
 * with role resolution and avoids 50001 "Missing Access" when confirming a restricted/private
 * channel the bot can't directly fetch. Falls back to the direct channel fetch when no guildId is
 * available (or the channel isn't in the listing, e.g. a thread).
 */
export async function resolveChannel(
  token: string,
  channelId: string,
  guildId?: string
): Promise<ResolvedName> {
  const rest = makeRest(token);

  if (guildId) {
    const channels = (await rest.get(Routes.guildChannels(guildId))) as Array<{
      id: string;
      name?: string;
    }>;
    const match = channels.find((c) => c.id === channelId);
    if (match) {
      return { id: match.id, name: match.name ? `#${match.name}` : match.id };
    }
  }

  const channel = (await rest.get(Routes.channel(channelId))) as { id: string; name?: string };
  return { id: channel.id, name: channel.name ? `#${channel.name}` : channel.id };
}

/** Resolve a user ID to a display name. */
export async function resolveUser(token: string, userId: string): Promise<ResolvedName> {
  const rest = makeRest(token);
  const user = (await rest.get(Routes.user(userId))) as {
    id: string;
    username: string;
    global_name?: string | null;
  };
  return { id: user.id, name: user.global_name || user.username };
}

/** Resolve a guild (server) ID to its name. */
export async function resolveGuild(token: string, guildId: string): Promise<ResolvedName> {
  const rest = makeRest(token);
  const guild = (await rest.get(`/guilds/${guildId}`)) as { id: string; name: string };
  return { id: guild.id, name: guild.name };
}

/** Resolve a role ID (within a guild) to its name. */
export async function resolveRole(
  token: string,
  guildId: string,
  roleId: string
): Promise<ResolvedName> {
  const rest = makeRest(token);
  const roles = (await rest.get(Routes.guildRoles(guildId))) as Array<{ id: string; name: string }>;
  const role = roles.find((r) => r.id === roleId);
  if (!role) {
    throw new Error('Role not found in guild');
  }
  return { id: role.id, name: `@${role.name}` };
}
