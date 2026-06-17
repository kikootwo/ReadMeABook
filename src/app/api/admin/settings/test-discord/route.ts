/**
 * Component: Admin Settings Test Discord API
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Validates a Discord bot token by fetching the bot's own user. Handles the masked-token case by
 * reading the stored (decrypted) token, mirroring the Prowlarr/Plex test pattern.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { fetchBotUser } from '@/lib/services/discord/discord-rest.helper';
import { DISCORD_CONFIG_KEYS } from '@/lib/services/discord/discord-config';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.TestDiscord');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { botToken } = await request.json();

        if (!botToken) {
          return NextResponse.json(
            { success: false, error: 'Bot token is required' },
            { status: 400 }
          );
        }

        // If the token is masked, use the stored (decrypted) value
        let actualToken = botToken;
        if (botToken.startsWith('••••')) {
          const stored = await getConfigService().get(DISCORD_CONFIG_KEYS.botToken);
          if (!stored) {
            return NextResponse.json(
              { success: false, error: 'No stored bot token found. Please re-enter your bot token.' },
              { status: 400 }
            );
          }
          actualToken = stored;
        }

        const bot = await fetchBotUser(actualToken.trim());

        return NextResponse.json({
          success: true,
          botUsername: bot.username,
          botId: bot.id,
        });
      } catch (error) {
        logger.error('Discord token test failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid bot token or Discord is unreachable',
          },
          { status: 500 }
        );
      }
    });
  });
}
