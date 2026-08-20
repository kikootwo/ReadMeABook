/**
 * Component: Discord Request Cards
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Posts and maintains the persistent, auto-updating "request card" created on /request. The card
 * keeps the full book detail and a status footer, delivered to a public channel and/or the
 * requester's DMs per the configured delivery mode. Message refs are persisted on the Request
 * (`discordCards`) so the background notification hook can edit them in place as status changes.
 *
 * This module statically imports discord.js, so it must only be reached lazily: from the (already
 * lazy-loaded) interaction handlers, or via dynamic import from the notification processor, gated on
 * the bot actually running. Never import it at the top level of an always-on worker.
 */

import { ChannelType, type Client } from 'discord.js';
import { prisma } from '@/lib/db';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';
import { RMABLogger } from '@/lib/utils/logger';
import type { MediaType } from './custom-id';
import { getDiscordConfig } from './discord-config';
import { getDiscordBotService } from './discord-bot.service';
import {
  applyApprovalCancellation,
  applyApprovalDecision,
  buildRequestCard,
  infoEmbed,
  rebuildCardForStatus,
} from './embeds';

const logger = RMABLogger.create('Discord.Cards');

/**
 * A persisted reference to a Discord message tied to a request. `public`/`dm` are the live request
 * cards; `approval` is the admin approval message (so it can be rewritten if the request is cancelled
 * before a decision).
 */
export interface DiscordCardRef {
  kind: 'public' | 'dm' | 'approval';
  channelId: string;
  messageId: string;
}

/** Coerce the JSON column into typed refs, tolerating legacy/garbage shapes. */
function parseCardRefs(value: unknown): DiscordCardRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is DiscordCardRef =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as DiscordCardRef).channelId === 'string' &&
      typeof (r as DiscordCardRef).messageId === 'string'
  );
}

/**
 * Merge new message refs into a request's `discordCards`, dropping any existing refs of the given
 * kinds first. Lets the approval ref and the public/DM card refs coexist (they're written by
 * separate calls) without one overwriting the other.
 */
async function mergeCardRefs(
  requestId: string,
  add: DiscordCardRef[],
  replaceKinds: DiscordCardRef['kind'][]
): Promise<void> {
  if (add.length === 0) return;
  try {
    const existing = await prisma.request.findUnique({
      where: { id: requestId },
      select: { discordCards: true },
    });
    const kept = parseCardRefs(existing?.discordCards).filter((r) => !replaceKinds.includes(r.kind));
    const all = [...kept, ...add];
    await prisma.request.update({
      where: { id: requestId },
      data: { discordCards: all as object[] },
    });
  } catch (error) {
    logger.warn('Could not persist Discord card refs', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Persist the approval message ref so it can be rewritten if the request is cancelled. */
export async function recordApprovalMessage(
  requestId: string,
  channelId: string,
  messageId: string
): Promise<void> {
  await mergeCardRefs(requestId, [{ kind: 'approval', channelId, messageId }], ['approval']);
}

/**
 * Post the request card to the public channel and/or the requester's DMs per the configured mode,
 * persist the resulting message refs on the request, and return them. Best-effort: a failure on one
 * destination is logged and skipped (in 'both' mode the other still posts).
 */
export async function postRequestCards(
  client: Client,
  opts: {
    requestId: string;
    book: AudibleAudiobook;
    mediaType: MediaType;
    status: string;
    requestedBy: string;
    requesterDiscordUserId: string;
  }
): Promise<DiscordCardRef[]> {
  const config = await getDiscordConfig();
  const mode = config.requestCardMode;

  // The creating service enqueues a notification (which triggers editRequestCards) before this runs,
  // and background jobs may advance the request meanwhile. Those edits no-op until the refs below are
  // persisted, so read the live status here rather than trusting the status captured at call time —
  // otherwise the freshly-posted card could show a stale status that no edit corrects.
  const live = await prisma.request.findUnique({
    where: { id: opts.requestId },
    select: { status: true },
  });
  const status = live?.status ?? opts.status;

  const { embed, components } = buildRequestCard(
    opts.book,
    opts.mediaType,
    status,
    opts.requestId,
    opts.requestedBy
  );

  const refs: DiscordCardRef[] = [];

  // Public announcement in the configured request channel
  if ((mode === 'public' || mode === 'both') && config.requestChannelId) {
    try {
      const channel = await client.channels.fetch(config.requestChannelId);
      if (channel && channel.type === ChannelType.GuildText) {
        const sent = await channel.send({ embeds: [embed], components });
        refs.push({ kind: 'public', channelId: sent.channelId, messageId: sent.id });
      } else {
        logger.warn('Request channel is missing or not a text channel', {
          channelId: config.requestChannelId,
        });
      }
    } catch (error) {
      logger.warn('Could not post public request card', {
        requestId: opts.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Direct message to the requester
  if (mode === 'dm' || mode === 'both') {
    try {
      const user = await client.users.fetch(opts.requesterDiscordUserId);
      const sent = await user.send({ embeds: [embed], components });
      refs.push({ kind: 'dm', channelId: sent.channelId, messageId: sent.id });
    } catch (error) {
      logger.warn('Could not DM request card to requester', {
        requestId: opts.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (refs.length > 0) {
    // Merge (replacing only the card kinds) so a previously stored approval ref is preserved.
    await mergeCardRefs(opts.requestId, refs, ['public', 'dm']);
  }

  return refs;
}

/**
 * Re-render every stored card for a request (footer, color, Cancel button). Uses the current DB
 * status, unless `statusOverride` is given — needed for cancellation, where the request is
 * soft-deleted without changing `status`. Best-effort and silent when the bot isn't running or the
 * request has no cards. Called from the notification hook, the approval handler, and Cancel.
 */
export async function editRequestCards(requestId: string, statusOverride?: string): Promise<void> {
  const client = getDiscordBotService().getClient();
  if (!client) {
    logger.info('Skipping request card update: bot not running', { requestId });
    return;
  }

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: { status: true, discordCards: true },
  });
  if (!request) {
    logger.info('Skipping request card update: request not found', { requestId });
    return;
  }

  const refs = parseCardRefs(request.discordCards);
  if (refs.length === 0) {
    logger.info('Skipping request card update: no cards recorded', { requestId });
    return;
  }

  const status = statusOverride ?? request.status;

  for (const ref of refs) {
    if (ref.kind === 'approval') continue; // approval message is managed separately
    try {
      const channel = await client.channels.fetch(ref.channelId);
      if (!channel || !channel.isTextBased()) continue;
      const message = await channel.messages.fetch(ref.messageId);
      const existing = message.embeds[0];
      if (!existing) continue;
      const { embed, components } = rebuildCardForStatus(existing, status, requestId);
      await message.edit({ embeds: [embed], components });
      logger.info('Request card updated', { requestId, kind: ref.kind, status });
    } catch (error) {
      logger.warn('Could not update request card', {
        requestId,
        kind: ref.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Rewrite the admin approval message after the request was cancelled before any decision: note who
 * cancelled it and remove the Approve/Deny buttons, leaving the embed in place for reference.
 * Best-effort and silent when the bot isn't running or no approval message was recorded.
 */
export async function cancelApprovalMessage(
  requestId: string,
  cancelledByDiscordId: string | null
): Promise<void> {
  const client = getDiscordBotService().getClient();
  if (!client) {
    logger.info('Skipping approval message cancel: bot not running', { requestId });
    return;
  }

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: { discordCards: true },
  });
  const ref = parseCardRefs(request?.discordCards).find((r) => r.kind === 'approval');
  if (!ref) {
    logger.info('Skipping approval message cancel: no approval message recorded', { requestId });
    return;
  }

  try {
    const channel = await client.channels.fetch(ref.channelId);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(ref.messageId);
    const existing = message.embeds[0];
    if (!existing) return;
    await message.edit({
      embeds: [applyApprovalCancellation(existing, cancelledByDiscordId)],
      components: [],
    });
    logger.info('Approval message marked cancelled', { requestId });
  } catch (error) {
    logger.warn('Could not update approval message on cancel', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Rewrite the admin approval message to reflect a decision (approve/deny) and drop the Approve/Deny
 * buttons. Works from the stored message ref rather than an interaction, so a decision made in the
 * Web UI or via an API token updates Discord exactly like a button click does.
 *
 * Best-effort; logs why it skipped rather than failing silently.
 */
export async function applyDecisionToApprovalMessage(
  requestId: string,
  action: 'approve' | 'deny',
  decidedByDiscordId: string | null
): Promise<void> {
  const client = getDiscordBotService().getClient();
  if (!client) {
    logger.info('Skipping approval message decision: bot not running', { requestId });
    return;
  }

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: { discordCards: true },
  });
  const ref = parseCardRefs(request?.discordCards).find((r) => r.kind === 'approval');
  if (!ref) {
    logger.info('Skipping approval message decision: no approval message recorded', { requestId });
    return;
  }

  try {
    const channel = await client.channels.fetch(ref.channelId);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(ref.messageId);
    const existing = message.embeds[0];
    if (!existing) return;
    await message.edit({
      embeds: [applyApprovalDecision(existing, action, decidedByDiscordId)],
      components: [],
    });
    logger.info('Approval message marked decided', { requestId, action });
  } catch (error) {
    logger.warn('Could not update approval message on decision', {
      requestId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * DM the original requester the outcome of their request. Previously this lived in the Discord
 * button handler, so a decision made in the Web UI notified nobody.
 */
export async function notifyRequesterOfDecision(
  requestId: string,
  action: 'approve' | 'deny'
): Promise<void> {
  const client = getDiscordBotService().getClient();
  if (!client) {
    logger.info('Skipping requester DM: bot not running', { requestId });
    return;
  }

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      audiobook: { select: { title: true } },
      user: { select: { discordUserId: true } },
    },
  });

  const discordUserId = request?.user.discordUserId;
  if (!discordUserId) {
    logger.info('Skipping requester DM: requester has no linked Discord account', { requestId });
    return;
  }

  const title = request?.audiobook.title;
  const embed =
    action === 'approve'
      ? infoEmbed(
          '✅ Request approved',
          `Your request for **${title}** has been approved and is now being processed.`
        )
      : infoEmbed('❌ Request denied', `Your request for **${title}** was not approved.`);

  try {
    const user = await client.users.fetch(discordUserId);
    await user.send({ embeds: [embed] });
    logger.info('Requester notified of decision', { requestId, action });
  } catch (error) {
    logger.warn('Could not DM requester about the decision', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Re-render the approval message from the request's *current* persisted state. Used when a button
 * click loses a race (already decided, or cancelled): rather than leaving the embed reading
 * "Pending" with merely greyed-out buttons, bring it in line with reality.
 */
export async function reconcileApprovalMessage(requestId: string): Promise<void> {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: { status: true, deletedAt: true },
  });
  if (!request) return;

  if (request.deletedAt) {
    await cancelApprovalMessage(requestId, null);
    return;
  }
  if (request.status === 'denied') {
    await applyDecisionToApprovalMessage(requestId, 'deny', null);
    return;
  }
  if (request.status !== 'awaiting_approval') {
    // pending / downloading / onwards all mean it was approved.
    await applyDecisionToApprovalMessage(requestId, 'approve', null);
  }
}
