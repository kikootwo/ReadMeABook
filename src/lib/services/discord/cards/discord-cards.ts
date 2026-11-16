/**
 * Component: Discord Request Cards (post and refresh)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Runs only inside the bot (reached through the running-check facade). A request made in
 * Discord gets a live card in the requester's DMs and/or the request channel
 * (`discord.request_card_mode`: dm, the default; public; both) and, while it waits for
 * approval, an approval message in the admin channel. The message IDs are stored on the
 * request (`discordCards`) and the cards are edited when its status changes. Each post or edit
 * is tried on its own: one Discord failure is logged and never stops the others.
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import type { DiscordBotService } from '../discord-bot.service';
import { loadDiscordConfig } from '../discord-config';
import { isSnowflake } from '../discord-snowflake';
import { approvalBody, decidedApprovalBody, requestCardBody, type CardRequest } from './discord-card-embeds';
import { CardMessenger, parseCardRefs, type CardRef } from './discord-card-messages';

const logger = RMABLogger.create('Discord.Cards');

/** Only these fields are read for a card (no release pick, paths, URLs or error text). */
const CARD_SELECT = {
  id: true,
  status: true,
  type: true,
  deletedAt: true,
  discordCards: true,
  audiobook: { select: { title: true, author: true, narrator: true, coverArtUrl: true } },
  user: { select: { plexUsername: true, discordUserId: true } },
} as const;

export function readCardRequest(requestId: string): Promise<CardRequest | null> {
  return prisma.request.findUnique({ where: { id: requestId }, select: CARD_SELECT });
}

/** Runs one Discord call; logs and returns null when it fails. */
async function attempt<T>(label: string, requestId: string, call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    logger.warn(`Discord card ${label} failed`, { requestId, error: errorForLog(error) });
    return null;
  }
}

/** Replaces the stored card list with `next(current)` (read just before the write). */
async function writeCards(requestId: string, next: (current: CardRef[]) => CardRef[]): Promise<void> {
  const row = await prisma.request.findUnique({ where: { id: requestId }, select: { discordCards: true } });
  if (!row) return;
  await prisma.request.update({
    where: { id: requestId },
    data: { discordCards: next(parseCardRefs(row.discordCards)) as unknown as object[] },
  });
}

/**
 * Edits every card of the request to its current status. An approval message that is no longer
 * waiting loses its buttons and is then dropped from the list (it is not edited again).
 * Returns the request as read (null when it does not exist).
 */
export async function refreshRequestCards(
  bot: DiscordBotService,
  requestId: string,
  decision?: 'approved' | 'denied'
): Promise<CardRequest | null> {
  const request = await readCardRequest(requestId);
  if (!request) return null;
  const refs = parseCardRefs(request.discordCards);
  const client = bot.getClient();
  if (refs.length === 0 || !client) return request;

  const messenger = CardMessenger.fromClient(client);
  const decided: CardRef[] = [];
  for (const ref of refs) {
    if (ref.kind === 'approval') {
      if (request.status === 'awaiting_approval' && !request.deletedAt) continue;
      const edited = await attempt('approval edit', requestId, () => messenger.edit(ref, decidedApprovalBody(request, decision)));
      if (edited !== null) decided.push(ref);
      continue;
    }
    await attempt(`${ref.kind} edit`, requestId, () => messenger.edit(ref, requestCardBody(request)));
  }

  if (decided.length > 0) {
    await writeCards(requestId, (current) => current.filter((ref) => !decided.some((d) => d.messageId === ref.messageId)));
  }
  return request;
}

/**
 * Posts the cards for a request just made in Discord, stores their IDs (an empty list still
 * marks the request as made in Discord), then refreshes once if the status moved meanwhile.
 */
export async function announceRequest(bot: DiscordBotService, requestId: string): Promise<void> {
  const client = bot.getClient();
  if (!client) return;
  const [config, request] = await Promise.all([loadDiscordConfig(), readCardRequest(requestId)]);
  if (!request || request.deletedAt) return;

  const messenger = CardMessenger.fromClient(client);
  const posted: CardRef[] = [];
  const keep = (ref: CardRef | null) => {
    if (ref) posted.push(ref);
  };
  const mode = config.requestCardMode;

  if ((mode === 'public' || mode === 'both') && isSnowflake(config.requestChannelId)) {
    keep(await attempt('public post', requestId, () => messenger.send('public', config.requestChannelId, requestCardBody(request))));
  }
  if ((mode === 'dm' || mode === 'both') && isSnowflake(request.user.discordUserId)) {
    // A member who turned off DMs from server members gets no card (logged)
    keep(await attempt('DM post', requestId, () => messenger.sendDm('dm', request.user.discordUserId!, requestCardBody(request))));
  }
  if (request.status === 'awaiting_approval' && isSnowflake(config.adminNotifyChannelId)) {
    const roleId = isSnowflake(config.adminRoleId) ? config.adminRoleId : '';
    keep(await attempt('approval post', requestId, () =>
      messenger.send('approval', config.adminNotifyChannelId, approvalBody(request, roleId))
    ));
  }

  await writeCards(requestId, (current) => [...current, ...posted]);

  const now = await readCardRequest(requestId);
  if (now && now.status !== request.status) await refreshRequestCards(bot, requestId);
}
