/**
 * Component: Discord Bot Settings
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The bot's configuration keys and how they are read. No discord.js import: the
 * settings route and the startup path read these without loading the library.
 */

import { getConfigService } from '@/lib/services/config.service';
import { isSnowflake } from './discord-snowflake';

export { isSnowflake };

export const DISCORD_KEYS = {
  enabled: 'discord.enabled',
  botToken: 'discord.bot_token',
  guildId: 'discord.guild_id',
  requestChannelId: 'discord.request_channel_id',
  adminRoleId: 'discord.admin_role_id',
  adminNotifyChannelId: 'discord.admin_notify_channel_id',
  requestCardMode: 'discord.request_card_mode',
} as const;

/** Where a request's status card goes once cards exist: the requester's DMs, the request channel, or both. */
export type DiscordCardMode = 'dm' | 'public' | 'both';
export const DEFAULT_CARD_MODE: DiscordCardMode = 'dm';

/** The IDs an admin enters on the Discord tab (guild, channels, role). */
export const DISCORD_ID_FIELDS = ['guildId', 'requestChannelId', 'adminRoleId', 'adminNotifyChannelId'] as const;
export type DiscordIdField = (typeof DISCORD_ID_FIELDS)[number];

export interface DiscordConfig {
  enabled: boolean;
  botToken: string;
  guildId: string;
  requestChannelId: string;
  adminRoleId: string;
  adminNotifyChannelId: string;
  requestCardMode: DiscordCardMode;
}

export function parseCardMode(value: string | null | undefined): DiscordCardMode {
  return value === 'public' || value === 'both' || value === 'dm' ? value : DEFAULT_CARD_MODE;
}

/** Reads every key (token decrypted). Missing keys read as empty / disabled. */
export async function loadDiscordConfig(): Promise<DiscordConfig> {
  const values = await getConfigService().getMany(Object.values(DISCORD_KEYS));
  const text = (key: string) => (values[key] ?? '').trim();
  return {
    enabled: values[DISCORD_KEYS.enabled] === 'true',
    botToken: text(DISCORD_KEYS.botToken),
    guildId: text(DISCORD_KEYS.guildId),
    requestChannelId: text(DISCORD_KEYS.requestChannelId),
    adminRoleId: text(DISCORD_KEYS.adminRoleId),
    adminNotifyChannelId: text(DISCORD_KEYS.adminNotifyChannelId),
    requestCardMode: parseCardMode(values[DISCORD_KEYS.requestCardMode]),
  };
}

/** The bot runs only when enabled with a token and a valid server ID. */
export function isDiscordConfigured(config: DiscordConfig): boolean {
  return config.enabled && config.botToken.length > 0 && isSnowflake(config.guildId);
}
