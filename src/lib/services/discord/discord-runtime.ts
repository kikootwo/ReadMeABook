/**
 * Component: Discord Bot Running-Check Facade
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The only Discord module core code (routes, services, processors, startup) may import.
 * It never imports discord.js or the bot service statically: the service is loaded
 * on demand, and only for work while the bot is running. Nothing here ever throws
 * into, or makes, its caller wait.
 */

import { RMABLogger } from '@/lib/utils/logger';
import { processSingleton } from '@/lib/utils/process-singleton';
import { errorForLog } from '@/lib/utils/zod-validation';
import type { DiscordBotService } from './discord-bot.service';

const logger = RMABLogger.create('Discord.Runtime');

function runtimeState(): { running: boolean } {
  return processSingleton('discord-runtime', () => ({ running: false }));
}

/** True while the bot is logged in and ready (set by the bot service). */
export function isDiscordBotRunning(): boolean {
  return runtimeState().running;
}

/** Bot service only. */
export function setDiscordBotRunning(running: boolean): void {
  runtimeState().running = running;
}

/**
 * Runs `work` against the bot in the background when the bot is running; otherwise does
 * nothing (no import). Returns at once: a slow, hanging or failing Discord call never
 * delays or fails the caller.
 */
export function syncDiscord(label: string, work: (bot: DiscordBotService) => Promise<unknown> | unknown): void {
  if (!isDiscordBotRunning()) return;
  void (async () => {
    const { getDiscordBotService } = await import('./discord-bot.service');
    await work(getDiscordBotService());
  })().catch((error) => {
    logger.warn(`Discord update failed: ${label}`, { error: errorForLog(error) });
  });
}

/** A request was approved or denied (web or Discord): mark its approval message decided, refresh its cards, DM the requester. */
export function syncDiscordApprovalDecision(requestId: string, decision: 'approved' | 'denied'): void {
  syncDiscord('approval decision', async (bot) => {
    const { syncApprovalDecision } = await import('./cards/discord-decision-sync');
    await syncApprovalDecision(bot, requestId, decision);
  });
}

/** A request's status may have changed: edit its Discord cards (only requests made in Discord have any). */
export function refreshDiscordRequestCards(requestId: string | null | undefined): void {
  if (!requestId) return;
  syncDiscord('request cards', async (bot) => {
    const { refreshRequestCards } = await import('./cards/discord-cards');
    await refreshRequestCards(bot, requestId);
  });
}

/** A request was made in Discord: post its card(s) and, while it needs approval, the approval message. */
export function announceDiscordRequest(requestId: string): void {
  syncDiscord('request announcement', async (bot) => {
    const { announceRequest } = await import('./cards/discord-cards');
    await announceRequest(bot, requestId);
  });
}

/**
 * Startup: start the bot in the background (it checks its own settings and loads
 * discord.js only when configured). Never awaited by the caller.
 */
export function startDiscordBotInBackground(): void {
  void (async () => {
    const { getDiscordBotService } = await import('./discord-bot.service');
    await getDiscordBotService().start();
  })().catch((error) => {
    logger.error('Failed to start the Discord bot', { error: errorForLog(error) });
  });
}
