/**
 * Component: Discord Request Cards (post and refresh)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Runs only inside the bot (reached through the running-check facade). A request made in
 * Discord gets a live card in the requester's DMs and/or the request channel
 * (`discord.request_card_mode`: dm, the default; public; both) and, while it waits for
 * approval, an approval message in the admin channel. The message IDs are stored on the
 * request (`discordCards`) and the cards are edited when its status changes. Each post or edit
 * is tried on its own: one Discord failure is logged and never stops the others. A card Discord
 * reports as deleted is dropped from the list. The approval message is posted only when the
 * request is announced: a request that comes back to awaiting_approval later gets none.
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import type { DiscordBotService } from '../discord-bot.service';
import { loadDiscordConfig } from '../discord-config';
import { isSnowflake } from '../discord-snowflake';
import { approvalBody, decidedApprovalBody, requestCardBody, type CardRequest, type MessageBody } from './discord-card-embeds';
import { CardMessenger, parseCardRefs, type CardRef } from './discord-card-messages';
// Function-only cycle (the sync refreshes cards through this module): safe in ESM
import { syncApprovalDecision } from './discord-decision-sync';

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

/** Discord's "Unknown Message" error code: the message was deleted. */
const UNKNOWN_MESSAGE = 10008;

/** Runs one Discord call; logs and returns null when it fails. */
async function attempt<T>(label: string, requestId: string, call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    logger.warn(`Discord card ${label} failed`, { requestId, error: errorForLog(error) });
    return null;
  }
}

/** Edits one card: 'gone' when Discord says the message no longer exists. */
async function editCard(messenger: CardMessenger, ref: CardRef, body: MessageBody, requestId: string): Promise<'edited' | 'gone' | 'failed'> {
  try {
    await messenger.edit(ref, body);
    return 'edited';
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === UNKNOWN_MESSAGE) {
      logger.info(`Discord ${ref.kind} card was deleted; it is no longer updated`, { requestId });
      return 'gone';
    }
    logger.warn(`Discord card ${ref.kind} edit failed`, { requestId, error: errorForLog(error) });
    return 'failed';
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
 * waiting loses its buttons, shows the decision (given, or read from the row when not: so a
 * refresh that runs before the decision sync still shows it), and is then dropped from the list
 * (it is not edited again); so is any card Discord reports as deleted. Returns the request as
 * read (null when it does not exist).
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
  const waiting = request.status === 'awaiting_approval' && !request.deletedAt;
  const shown = decision ?? (!waiting && refs.some((ref) => ref.kind === 'approval') ? await decisionAfter(request) : undefined);
  const done: CardRef[] = [];
  for (const ref of refs) {
    if (ref.kind === 'approval' && waiting) continue;
    const body = ref.kind === 'approval' ? decidedApprovalBody(request, shown) : requestCardBody(request);
    const outcome = await editCard(messenger, ref, body, requestId);
    // A decided approval message is not edited again; a deleted card cannot be
    if (outcome === 'gone' || (ref.kind === 'approval' && outcome === 'edited')) done.push(ref);
  }

  if (done.length > 0) {
    await writeCards(requestId, (current) => current.filter((ref) => !done.some((d) => d.messageId === ref.messageId)));
  }
  return request;
}

/**
 * The decision behind a move off awaiting_approval: denied, or approved (an approval clears the
 * approval record; a library match that completes the request sets it). Removed or cancelled:
 * none.
 */
async function decisionAfter(now: CardRequest): Promise<'approved' | 'denied' | undefined> {
  if (now.deletedAt || now.status === 'cancelled' || now.status === 'awaiting_approval') return undefined;
  if (now.status === 'denied') return 'denied';
  const row = await prisma.request.findUnique({ where: { id: now.id }, select: { approvalBypassedBy: true } });
  return row && row.approvalBypassedBy === null ? 'approved' : undefined;
}

/**
 * Posts the cards for a request just made in Discord, stores their IDs (an empty list still
 * marks the request as made in Discord), then refreshes once if the status moved or the request
 * was deleted meanwhile. A
 * decision made while the cards were being posted found none to update: it is applied here
 * (the approval message shows it and the requester gets the decision DM).
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

  // A delete does not change the status: it counts as a move too (the cards then show Removed)
  const now = await readCardRequest(requestId);
  if (!now || (now.status === request.status && !now.deletedAt)) return;
  const decision = request.status === 'awaiting_approval' ? await decisionAfter(now) : undefined;
  if (decision) {
    await syncApprovalDecision(bot, requestId, decision);
  } else {
    await refreshRequestCards(bot, requestId);
  }
}
