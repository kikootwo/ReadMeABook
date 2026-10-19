/**
 * Component: Admin Discord Member Search API
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Searches the configured guild's members by name (username + server nickname) for the "Map Users to
 * Discord IDs" admin modal. Restricts results to the requester role when one is configured. Uses the
 * saved (encrypted) bot token + guild ID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getDiscordConfig } from '@/lib/services/discord/discord-config';
import { searchGuildMembers } from '@/lib/services/discord/discord-rest.helper';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.DiscordSearchMembers');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { query } = await request.json();
        const trimmed = typeof query === 'string' ? query.trim() : '';
        if (!trimmed) {
          return NextResponse.json({ success: true, results: [] });
        }

        const config = await getDiscordConfig();
        if (!config.botToken || !config.guildId) {
          return NextResponse.json(
            { success: false, error: 'Save a bot token and server (guild) ID first.' },
            { status: 400 }
          );
        }

        const results = await searchGuildMembers(
          config.botToken,
          config.guildId,
          trimmed,
          config.requesterRoleId
        );

        return NextResponse.json({ success: true, results });
      } catch (error) {
        logger.error('Discord member search failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { success: false, error: 'Failed to search Discord members' },
          { status: 500 }
        );
      }
    });
  });
}
