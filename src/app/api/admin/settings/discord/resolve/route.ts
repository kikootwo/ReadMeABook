/**
 * Component: Admin Discord Resolve API
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Resolves the human-readable names for Discord role/channel/user IDs entered in the settings tab,
 * so admins can confirm they pasted the right snowflakes. Uses the saved bot token (or a non-masked
 * one passed in the body). Each lookup is best-effort: failures are reported per-field, not fatal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import {
  resolveChannel,
  resolveRole,
  resolveUser,
} from '@/lib/services/discord/discord-rest.helper';
import { DISCORD_CONFIG_KEYS } from '@/lib/services/discord/discord-config';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.DiscordResolve');

interface ResolveField {
  name: string | null;
  error?: string;
}

async function safeResolve(fn: () => Promise<{ name: string }>): Promise<ResolveField> {
  try {
    const { name } = await fn();
    return { name };
  } catch (error) {
    return { name: null, error: error instanceof Error ? error.message : 'Could not resolve' };
  }
}

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const {
          botToken,
          guildId,
          roleId,
          channelId,
          adminNotifyChannelId,
          userId,
        } = await request.json();

        // Resolve the token to use (masked/absent → stored value)
        let token: string | null = botToken && !botToken.startsWith('••••') ? botToken.trim() : null;
        if (!token) {
          token = await getConfigService().get(DISCORD_CONFIG_KEYS.botToken);
        }
        if (!token) {
          return NextResponse.json(
            { success: false, error: 'No bot token configured. Save a valid bot token first.' },
            { status: 400 }
          );
        }

        const results: Record<string, ResolveField> = {};

        if (roleId) {
          if (!guildId) {
            results.role = { name: null, error: 'Server (guild) ID is required to resolve a role' };
          } else {
            results.role = await safeResolve(() => resolveRole(token!, guildId, roleId));
          }
        }
        if (channelId) {
          results.channel = await safeResolve(() => resolveChannel(token!, channelId, guildId));
        }
        if (adminNotifyChannelId) {
          results.adminNotifyChannel = await safeResolve(() =>
            resolveChannel(token!, adminNotifyChannelId, guildId)
          );
        }
        if (userId) {
          results.user = await safeResolve(() => resolveUser(token!, userId));
        }

        return NextResponse.json({ success: true, results });
      } catch (error) {
        logger.error('Discord resolve failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { success: false, error: 'Failed to resolve Discord IDs' },
          { status: 500 }
        );
      }
    });
  });
}
