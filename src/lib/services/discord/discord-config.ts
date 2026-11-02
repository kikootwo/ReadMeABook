/**
 * Component: Discord Bot Config
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Typed accessor for the Discord bot configuration stored in the Configuration table
 * (category 'discord'). The bot token is encrypted at rest; getConfigService().get()
 * transparently decrypts it. Keys are flat strings to match the rest of the settings system.
 */

import { getConfigService } from '@/lib/services/config.service';

/** Configuration keys for the Discord bot (category: 'discord'). */
export const DISCORD_CONFIG_KEYS = {
  enabled: 'discord.enabled',
  botToken: 'discord.bot_token',
  guildId: 'discord.guild_id',
  requestChannelId: 'discord.request_channel_id',
  adminRoleId: 'discord.admin_role_id',
  adminNotifyChannelId: 'discord.admin_notify_channel_id',
  requestCardMode: 'discord.request_card_mode',
  requesterRoleId: 'discord.requester_role_id',
} as const;

/** How the persistent, auto-updating request card is delivered to the requester. */
export type RequestCardMode = 'public' | 'dm' | 'both';

const REQUEST_CARD_MODES: readonly RequestCardMode[] = ['public', 'dm', 'both'];

/** Coerce an arbitrary stored value into a valid RequestCardMode (defaults to 'public'). */
export function asRequestCardMode(value: string | null | undefined): RequestCardMode {
  return REQUEST_CARD_MODES.includes(value as RequestCardMode)
    ? (value as RequestCardMode)
    : 'public';
}

export interface DiscordConfig {
  enabled: boolean;
  botToken: string | null;
  guildId: string | null;
  /** Channel where /request requests post their admin-approval embeds. */
  requestChannelId: string | null;
  /** Role pinged for approvals; also grants Approve/Deny button authority. */
  adminRoleId: string | null;
  /** Optional separate channel for admin approval pings (falls back to requestChannelId). */
  adminNotifyChannelId: string | null;
  /** Delivery mode for the persistent request card: public channel, DM, or both. */
  requestCardMode: RequestCardMode;
  /** Optional role that gates who may make requests. Blank = any linked user. Admins always bypass. */
  requesterRoleId: string | null;
}

/**
 * Load the full Discord bot configuration (decrypted).
 */
export async function getDiscordConfig(): Promise<DiscordConfig> {
  const config = getConfigService();
  const values = await config.getMany([
    DISCORD_CONFIG_KEYS.enabled,
    DISCORD_CONFIG_KEYS.botToken,
    DISCORD_CONFIG_KEYS.guildId,
    DISCORD_CONFIG_KEYS.requestChannelId,
    DISCORD_CONFIG_KEYS.adminRoleId,
    DISCORD_CONFIG_KEYS.adminNotifyChannelId,
    DISCORD_CONFIG_KEYS.requestCardMode,
    DISCORD_CONFIG_KEYS.requesterRoleId,
  ]);

  return {
    enabled: values[DISCORD_CONFIG_KEYS.enabled] === 'true',
    botToken: values[DISCORD_CONFIG_KEYS.botToken] || null,
    guildId: values[DISCORD_CONFIG_KEYS.guildId] || null,
    requestChannelId: values[DISCORD_CONFIG_KEYS.requestChannelId] || null,
    adminRoleId: values[DISCORD_CONFIG_KEYS.adminRoleId] || null,
    adminNotifyChannelId: values[DISCORD_CONFIG_KEYS.adminNotifyChannelId] || null,
    requestCardMode: asRequestCardMode(values[DISCORD_CONFIG_KEYS.requestCardMode]),
    requesterRoleId: values[DISCORD_CONFIG_KEYS.requesterRoleId] || null,
  };
}

/**
 * Whether the bot has the minimum config required to start (enabled + token + guild).
 */
export function isDiscordBotConfigured(config: DiscordConfig): boolean {
  return config.enabled && !!config.botToken && !!config.guildId;
}

/** The channel approval pings should go to (dedicated notify channel, else request channel). */
export function getApprovalChannelId(config: DiscordConfig): string | null {
  return config.adminNotifyChannelId || config.requestChannelId;
}
