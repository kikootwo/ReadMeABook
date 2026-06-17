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

/** Validate a bot token by fetching the bot's own user. Throws on invalid token. */
export async function fetchBotUser(token: string): Promise<{ id: string; username: string }> {
  const rest = makeRest(token);
  const user = (await rest.get(Routes.user('@me'))) as { id: string; username: string };
  return { id: user.id, username: user.username };
}

/** Resolve a channel ID to its name (e.g. "general"). */
export async function resolveChannel(token: string, channelId: string): Promise<ResolvedName> {
  const rest = makeRest(token);
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
