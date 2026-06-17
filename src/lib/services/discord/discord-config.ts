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
} as const;

export interface DiscordConfig {
  enabled: boolean;
  botToken: string | null;
  guildId: string | null;
  /** Channel where /checkout requests post their admin-approval embeds. */
  requestChannelId: string | null;
  /** Role pinged for approvals; also grants Approve/Deny button authority. */
  adminRoleId: string | null;
  /** Optional separate channel for admin approval pings (falls back to requestChannelId). */
  adminNotifyChannelId: string | null;
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
  ]);

  return {
    enabled: values[DISCORD_CONFIG_KEYS.enabled] === 'true',
    botToken: values[DISCORD_CONFIG_KEYS.botToken] || null,
    guildId: values[DISCORD_CONFIG_KEYS.guildId] || null,
    requestChannelId: values[DISCORD_CONFIG_KEYS.requestChannelId] || null,
    adminRoleId: values[DISCORD_CONFIG_KEYS.adminRoleId] || null,
    adminNotifyChannelId: values[DISCORD_CONFIG_KEYS.adminNotifyChannelId] || null,
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
