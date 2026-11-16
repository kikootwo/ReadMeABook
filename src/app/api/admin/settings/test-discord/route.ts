/**
 * Component: Discord Bot Test API
 * Documentation: documentation/integrations/discord-bot.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody, AUTH_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { isSnowflake, loadDiscordConfig } from '@/lib/services/discord/discord-config';
import { isMaskedToken, normalizeBotToken } from '@/lib/services/discord/discord-token-mask';
import { checkDiscordBot, DiscordCheckError } from '@/lib/services/discord/discord-rest';

const logger = RMABLogger.create('API.Admin.Settings.TestDiscord');

const ID_MESSAGE = 'Discord IDs are 15 to 20 digits, not starting with 0 (or empty)';
const discordId = z.string().trim().refine((value) => value === '' || isSnowflake(value), { message: ID_MESSAGE }).optional();

const TestSchema = z.object({
  /** Omitted, empty or the mask: test the saved token. A leading "Bot " / "Bearer " is dropped. */
  botToken: z.string().max(220).transform(normalizeBotToken).pipe(z.string().max(200)).optional(),
  guildId: discordId,
  requestChannelId: discordId,
  adminRoleId: discordId,
  adminNotifyChannelId: discordId,
});

/**
 * POST /api/admin/settings/test-discord
 * Admin-triggered check of a bot token (typed or saved): bot identity, invite URL, the
 * bot's servers, and names for the entered IDs. Never called on page load.
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(req, { maxBytes: AUTH_JSON_BODY_LIMIT_BYTES });
        if (!bodyResult.ok) return bodyResult.response;
        const input = TestSchema.parse(bodyResult.data ?? {});

        const typed = input.botToken && !isMaskedToken(input.botToken) ? input.botToken : '';
        const token = typed || (await loadDiscordConfig()).botToken;
        if (!token) {
          return NextResponse.json({ error: 'Enter a bot token first' }, { status: 400 });
        }

        const result = await checkDiscordBot(token, {
          guildId: input.guildId || undefined,
          requestChannelId: input.requestChannelId || undefined,
          adminRoleId: input.adminRoleId || undefined,
          adminNotifyChannelId: input.adminNotifyChannelId || undefined,
        });
        return NextResponse.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: error.issues[0]?.message ?? ID_MESSAGE, details: zodIssueDetails(error) },
            { status: 400 }
          );
        }
        if (error instanceof SyntaxError) {
          return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        if (error instanceof DiscordCheckError) {
          logger.warn('Discord bot test failed', { kind: error.kind });
          const status = error.kind === 'token-rejected' ? 400 : error.kind === 'rate-limited' ? 429 : 502;
          return NextResponse.json({ error: error.message }, { status });
        }
        logger.error('Discord bot test failed', { error: errorForLog(error) });
        return NextResponse.json({ error: 'Discord bot test failed' }, { status: 500 });
      }
    });
  });
}
