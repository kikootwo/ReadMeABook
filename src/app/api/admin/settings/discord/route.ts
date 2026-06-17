/**
 * Component: Admin Discord Settings API
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Persists Discord bot configuration (category 'discord'). The bot token is encrypted at rest and
 * only updated when a non-masked value is provided. Saving restarts the bot so changes take effect
 * immediately without a container restart.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { getConfigService } from '@/lib/services/config.service';
import { getDiscordBotService } from '@/lib/services/discord/discord-bot.service';
import { DISCORD_CONFIG_KEYS, asRequestCardMode, asDeletePermission } from '@/lib/services/discord/discord-config';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.Discord');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const {
          enabled,
          botToken,
          guildId,
          requestChannelId,
          adminRoleId,
          adminNotifyChannelId,
          requestCardMode,
          requesterRoleId,
          deletePermission,
        } = await request.json();

        // Plain (non-secret) keys
        const plainUpdates: Array<{ key: string; value: string }> = [
          { key: DISCORD_CONFIG_KEYS.enabled, value: enabled ? 'true' : 'false' },
          { key: DISCORD_CONFIG_KEYS.guildId, value: (guildId || '').trim() },
          { key: DISCORD_CONFIG_KEYS.requestChannelId, value: (requestChannelId || '').trim() },
          { key: DISCORD_CONFIG_KEYS.adminRoleId, value: (adminRoleId || '').trim() },
          { key: DISCORD_CONFIG_KEYS.adminNotifyChannelId, value: (adminNotifyChannelId || '').trim() },
          { key: DISCORD_CONFIG_KEYS.requestCardMode, value: asRequestCardMode(requestCardMode) },
          { key: DISCORD_CONFIG_KEYS.requesterRoleId, value: (requesterRoleId || '').trim() },
          { key: DISCORD_CONFIG_KEYS.deletePermission, value: asDeletePermission(deletePermission) },
        ];

        for (const { key, value } of plainUpdates) {
          await prisma.configuration.upsert({
            where: { key },
            update: { value },
            create: { key, value, category: 'discord' },
          });
        }

        // Only update the bot token if a new (non-masked) value was supplied
        if (botToken && !botToken.startsWith('••••')) {
          const encrypted = getEncryptionService().encrypt(botToken.trim());
          await prisma.configuration.upsert({
            where: { key: DISCORD_CONFIG_KEYS.botToken },
            update: { value: encrypted, encrypted: true },
            create: { key: DISCORD_CONFIG_KEYS.botToken, value: encrypted, encrypted: true, category: 'discord' },
          });
        }

        // These upserts wrote straight to the DB, bypassing the config service's cache invalidation.
        // Clear the cached discord.* values so the restart below reads the freshly persisted config
        // (otherwise a re-enable within the 60s cache TTL reads the stale 'disabled' value and the
        // bot never reconnects). See getConfigService() cache in config.service.ts.
        const configService = getConfigService();
        for (const key of Object.values(DISCORD_CONFIG_KEYS)) {
          configService.clearCache(key);
        }

        // Apply immediately: restart the gateway client with the new config
        await getDiscordBotService().restart();

        logger.info('Discord settings updated', { enabled: !!enabled });

        return NextResponse.json({
          success: true,
          message: 'Discord settings updated successfully',
        });
      } catch (error) {
        logger.error('Failed to update Discord settings', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update settings',
          },
          { status: 500 }
        );
      }
    });
  });
}
