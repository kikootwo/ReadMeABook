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
import { normalizeBotToken } from './discord-token-mask';

/** View Channels + Send Messages + Embed Links + Read Message History. Never Administrator. */
export const DISCORD_INVITE_PERMISSIONS = '84992';

const REST_TIMEOUT_MS = 10_000;

export const RATE_LIMITED_MESSAGE = 'Discord is rate limiting this bot; try again in a minute';

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
  constructor(public readonly kind: 'token-rejected' | 'unreachable' | 'rate-limited', message: string) {
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
  requesterRoleId: 'Requester role',
};

export async function checkDiscordBot(
  token: string,
  ids: Partial<Record<DiscordIdField, string>>
): Promise<DiscordCheckResult> {
  for (const value of Object.values(ids)) {
    if (value && !isSnowflake(value)) throw new Error('checkDiscordBot: unvalidated ID');
  }
  const { REST, Routes, RateLimitError } = await import('discord.js');
  // A 429 fails at once (by default the library waits out retry_after and tries again, with
  // no limit). No sweeper timers: they would keep this one-off client and its token alive.
  const rest = new REST({
    version: '10',
    timeout: REST_TIMEOUT_MS,
    retries: 0,
    rejectOnRateLimit: () => true,
    hashSweepInterval: 0,
    handlerSweepInterval: 0,
  }).setToken(normalizeBotToken(token));
  const failIfLimited = (error: unknown) => {
    if (error instanceof RateLimitError) throw new DiscordCheckError('rate-limited', RATE_LIMITED_MESSAGE);
  };

  let bot: { id: string; username: string };
  try {
    bot = (await rest.get(Routes.user('@me'))) as { id: string; username: string };
  } catch (error) {
    failIfLimited(error);
    if (statusOf(error) === 401) throw new DiscordCheckError('token-rejected', 'Discord rejected the bot token');
    throw new DiscordCheckError('unreachable', 'Could not reach Discord');
  }

  const warnings: string[] = [];
  let guilds: DiscordNamedItem[] = [];
  try {
    const list = (await rest.get(Routes.userGuilds())) as DiscordNamedItem[];
    guilds = list.map(({ id, name }) => ({ id, name }));
  } catch (error) {
    failIfLimited(error);
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

  // The server list already names it when the bot is in it; ask Discord only otherwise
  result.guild = guilds.find((guild) => guild.id === guildId) ?? null;
  if (!result.guild) {
    try {
      const guild = (await rest.get(Routes.guild(guildId))) as DiscordNamedItem;
      result.guild = { id: guild.id, name: guild.name };
    } catch (error) {
      failIfLimited(error);
      const status = statusOf(error);
      warnings.push(
        status === 403 || status === 404
          ? 'The bot is not in this server yet. Use the invite link, then test again.'
          : 'Could not check the server. Try again in a moment.'
      );
      return result;
    }
  }

  const listOrNull = (path: `/${string}`) =>
    (rest.get(path) as Promise<DiscordNamedItem[]>).catch((error: unknown) => {
      failIfLimited(error);
      return null;
    });
  const [channels, roles] = await Promise.all([listOrNull(Routes.guildChannels(guildId)), listOrNull(Routes.guildRoles(guildId))]);
  const lookups: Array<[Exclude<DiscordIdField, 'guildId'>, DiscordNamedItem[] | null]> = [
    ['requestChannelId', channels],
    ['adminNotifyChannelId', channels],
    ['adminRoleId', roles],
    ['requesterRoleId', roles],
  ];
  for (const [field, list] of lookups) {
    const id = ids[field];
    if (!id) continue;
    if (!list) {
      warnings.push(`Could not read the server's ${field.endsWith('RoleId') ? 'roles' : 'channels'}.`);
      continue;
    }
    const found = list.find((item) => item.id === id);
    if (found) result.names[field] = found.name;
    else warnings.push(`${LABELS[field]} ${id} was not found in this server.`);
  }
  result.warnings = [...new Set(warnings)];
  return result;
}
