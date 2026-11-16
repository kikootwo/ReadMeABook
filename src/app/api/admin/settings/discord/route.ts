/**
 * Component: Discord Bot Settings API
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Token rule for PUT: the mask or '' keeps the saved token; a new value replaces it;
 * only `clearBotToken: true` removes it (the one clear-on-purpose path). A blank form
 * sent by mistake can never erase a saved token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody, AUTH_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { getDiscordBotService } from '@/lib/services/discord/discord-bot.service';
import {
  DISCORD_ID_FIELDS,
  DISCORD_KEYS,
  isDiscordConfigured,
  isSnowflake,
  loadDiscordConfig,
  type DiscordConfig,
} from '@/lib/services/discord/discord-config';
import { DISCORD_TOKEN_MASK, isMaskedToken, normalizeBotToken } from '@/lib/services/discord/discord-token-mask';

const logger = RMABLogger.create('API.Admin.Settings.Discord');

const ID_MESSAGE = 'Discord IDs are 15 to 20 digits, not starting with 0 (or empty)';
const discordId = z.string().trim().refine((value) => value === '' || isSnowflake(value), { message: ID_MESSAGE });

const DiscordSettingsSchema = z.object({
  enabled: z.boolean(),
  /** The mask or '' keeps the saved token; a leading "Bot " / "Bearer " is dropped. */
  botToken: z.string().max(220).transform(normalizeBotToken).pipe(z.string().max(200)),
  /** The only way to remove a saved token. */
  clearBotToken: z.boolean().optional(),
  guildId: discordId,
  requestChannelId: discordId,
  adminRoleId: discordId,
  adminNotifyChannelId: discordId,
});

/** What the tab shows: the token masked, never its value. */
function view(config: DiscordConfig) {
  return {
    settings: {
      enabled: config.enabled,
      botToken: config.botToken ? DISCORD_TOKEN_MASK : '',
      guildId: config.guildId,
      requestChannelId: config.requestChannelId,
      adminRoleId: config.adminRoleId,
      adminNotifyChannelId: config.adminNotifyChannelId,
    },
    isConfigured: isDiscordConfigured(config),
    status: getDiscordBotService().getStatus(),
  };
}

/** GET /api/admin/settings/discord: saved settings (token masked), configured flag, bot status. Reads only. */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        return NextResponse.json(view(await loadDiscordConfig()));
      } catch (error) {
        logger.error('Failed to read Discord settings', { error: errorForLog(error) });
        return NextResponse.json({ error: 'Failed to read Discord settings' }, { status: 500 });
      }
    });
  });
}

/**
 * PUT /api/admin/settings/discord: saves every key in one transaction (token encrypted),
 * then restarts the bot in the background. The response never waits for Discord.
 */
export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(req, { maxBytes: AUTH_JSON_BODY_LIMIT_BYTES });
        if (!bodyResult.ok) return bodyResult.response;
        const input = DiscordSettingsSchema.parse(bodyResult.data);

        const clearToken = input.clearBotToken === true;
        const keepToken = !clearToken && (input.botToken === '' || isMaskedToken(input.botToken));
        const saved = await loadDiscordConfig();
        const effectiveToken = clearToken ? '' : keepToken ? saved.botToken : input.botToken;
        if (input.enabled && (!effectiveToken || !input.guildId)) {
          return NextResponse.json(
            { error: 'ValidationError', message: 'Enabling the bot needs a bot token and a server ID' },
            { status: 400 }
          );
        }

        const category = 'discord';
        const updates = [
          { key: DISCORD_KEYS.enabled, value: String(input.enabled), category },
          ...DISCORD_ID_FIELDS.map((field) => ({ key: DISCORD_KEYS[field], value: input[field], category })),
          ...(keepToken ? [] : [{ key: DISCORD_KEYS.botToken, value: effectiveToken, encrypted: true, category }]),
        ];
        await getConfigService().setManyAtomic(updates);
        logger.info('Discord settings saved', { adminId: req.user?.sub, enabled: input.enabled, tokenChanged: !keepToken });

        // Restart in the background: stop now (fast), start without waiting for the gateway
        const bot = getDiscordBotService();
        await bot.stop();
        void bot.start().catch((error) => logger.error('Failed to start the Discord bot', { error: errorForLog(error) }));

        return NextResponse.json(view(await loadDiscordConfig()));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'ValidationError', message: error.issues[0]?.message ?? ID_MESSAGE, details: zodIssueDetails(error) },
            { status: 400 }
          );
        }
        if (error instanceof SyntaxError) {
          return NextResponse.json({ error: 'ValidationError', message: 'Invalid JSON body' }, { status: 400 });
        }
        logger.error('Failed to save Discord settings', { error: errorForLog(error) });
        return NextResponse.json({ error: 'Failed to save Discord settings' }, { status: 500 });
      }
    });
  });
}
