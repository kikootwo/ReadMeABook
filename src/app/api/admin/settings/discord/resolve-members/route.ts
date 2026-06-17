/**
 * Component: Admin Discord Member Resolve API
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Resolves Discord User IDs to display name + avatar for the user-mapping UI (shows existing mappings
 * as full pills). Best-effort per ID; uses the saved bot token + guild ID. Clients cache the results.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getDiscordConfig } from '@/lib/services/discord/discord-config';
import { resolveMembersByIds } from '@/lib/services/discord/discord-rest.helper';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.DiscordResolveMembers');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { ids } = await request.json();
        const cleanIds = Array.isArray(ids)
          ? Array.from(
              new Set(
                ids.filter((id): id is string => typeof id === 'string' && /^\d{15,25}$/.test(id))
              )
            ).slice(0, 100)
          : [];

        if (cleanIds.length === 0) {
          return NextResponse.json({ success: true, results: [] });
        }

        const config = await getDiscordConfig();
        if (!config.botToken || !config.guildId) {
          return NextResponse.json(
            { success: false, error: 'Save a bot token and server (guild) ID first.' },
            { status: 400 }
          );
        }

        const results = await resolveMembersByIds(config.botToken, config.guildId, cleanIds);
        return NextResponse.json({ success: true, results });
      } catch (error) {
        logger.error('Discord member resolve failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { success: false, error: 'Failed to resolve Discord members' },
          { status: 500 }
        );
      }
    });
  });
}
