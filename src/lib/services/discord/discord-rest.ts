/**
 * Component: Discord REST Check (settings Test button)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Admin-triggered only. Checks a bot token against Discord, lists the bot's servers and
 * turns the configured IDs into names. Callers pass IDs already validated as snowflakes;
 * every path is built with discord.js `Routes`. discord.js is loaded only when called.
 * The host is fixed (discord.com), so nothing here can be pointed elsewhere.
 */

import { isSnowflake, type DiscordIdField } from './discord-config';

/** View Channels + Send Messages + Embed Links + Read Message History. Never Administrator. */
export const DISCORD_INVITE_PERMISSIONS = '84992';

const REST_TIMEOUT_MS = 10_000;

export interface DiscordNamedItem {
  id: string;
  name: string;
}

export interface DiscordCheckResult {
  bot: { id: string; username: string };
  inviteUrl: string;
  /** Servers the bot is in. */
  guilds: DiscordNamedItem[];
  /** The configured server, or null when the bot cannot see it. */
  guild: DiscordNamedItem | null;
  /** Names for the configured channel and role IDs that were found. */
  names: Partial<Record<Exclude<DiscordIdField, 'guildId'>, string>>;
  warnings: string[];
}

export class DiscordCheckError extends Error {
  constructor(public readonly kind: 'token-rejected' | 'unreachable', message: string) {
    super(message);
  }
}

export function buildInviteUrl(botId: string, guildId?: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', botId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', DISCORD_INVITE_PERMISSIONS);
  if (guildId && isSnowflake(guildId)) url.searchParams.set('guild_id', guildId);
  return url.toString();
}

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
};

const LABELS: Record<Exclude<DiscordIdField, 'guildId'>, string> = {
  requestChannelId: 'Request channel',
  adminNotifyChannelId: 'Admin channel',
  adminRoleId: 'Admin role',
};

export async function checkDiscordBot(
  token: string,
  ids: Partial<Record<DiscordIdField, string>>
): Promise<DiscordCheckResult> {
  for (const value of Object.values(ids)) {
    if (value && !isSnowflake(value)) throw new Error('checkDiscordBot: unvalidated ID');
  }
  const { REST, Routes } = await import('discord.js');
  const rest = new REST({ version: '10', timeout: REST_TIMEOUT_MS, retries: 0 }).setToken(token);

  let bot: { id: string; username: string };
  try {
    bot = (await rest.get(Routes.user('@me'))) as { id: string; username: string };
  } catch (error) {
    if (statusOf(error) === 401) throw new DiscordCheckError('token-rejected', 'Discord rejected the bot token');
    throw new DiscordCheckError('unreachable', 'Could not reach Discord');
  }

  const warnings: string[] = [];
  let guilds: DiscordNamedItem[] = [];
  try {
    const list = (await rest.get(Routes.userGuilds())) as DiscordNamedItem[];
    guilds = list.map(({ id, name }) => ({ id, name }));
  } catch {
    warnings.push('Could not list the servers the bot is in.');
  }

  const result: DiscordCheckResult = {
    bot: { id: bot.id, username: bot.username },
    inviteUrl: buildInviteUrl(bot.id, ids.guildId),
    guilds,
    guild: null,
    names: {},
    warnings,
  };
  const guildId = ids.guildId;
  if (!guildId) return result;

  try {
    const guild = (await rest.get(Routes.guild(guildId))) as DiscordNamedItem;
    result.guild = { id: guild.id, name: guild.name };
  } catch {
    warnings.push('The bot is not in this server yet. Use the invite link, then test again.');
    return result;
  }

  const [channels, roles] = await Promise.all([
    rest.get(Routes.guildChannels(guildId)).catch(() => null) as Promise<DiscordNamedItem[] | null>,
    rest.get(Routes.guildRoles(guildId)).catch(() => null) as Promise<DiscordNamedItem[] | null>,
  ]);
  const lookups: Array<[Exclude<DiscordIdField, 'guildId'>, DiscordNamedItem[] | null]> = [
    ['requestChannelId', channels],
    ['adminNotifyChannelId', channels],
    ['adminRoleId', roles],
  ];
  for (const [field, list] of lookups) {
    const id = ids[field];
    if (!id) continue;
    if (!list) {
      warnings.push(`Could not read the server's ${field === 'adminRoleId' ? 'roles' : 'channels'}.`);
      continue;
    }
    const found = list.find((item) => item.id === id);
    if (found) result.names[field] = found.name;
    else warnings.push(`${LABELS[field]} ${id} was not found in this server.`);
  }
  result.warnings = [...new Set(warnings)];
  return result;
}
