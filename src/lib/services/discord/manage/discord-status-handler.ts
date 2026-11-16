/**
 * Component: Discord /status and Cancel
 * Documentation: documentation/integrations/discord-bot.md
 *
 * `/status` lists the linked account's requests (an RMAB admin's lists every user's) with page
 * buttons and a Cancel menu for the ones that can still be cancelled. A request card and an
 * approval message carry a Cancel button too. A Cancel (button or menu) only asks first: one
 * ephemeral confirmation worded as the web's, with Cancel request (Withdraw request while it
 * awaits approval) and Keep request. Every step acknowledges Discord first (a cancel can take up
 * to 10 s while the download client answers), then resolves the clicking user to an RMAB account
 * (no cache) and reads the request again: only its requester or an RMAB admin (database role)
 * may cancel it, checked again on the confirm. Then the shared cancel service runs, exactly as
 * the web cancel does. Holding a Discord role grants nothing here. A click on a request that can
 * no longer be cancelled brings its cards up to date; a cancel updates them through the service.
 */

import { prisma } from '@/lib/db';
import { isCancellableStatus } from '@/lib/constants/request-statuses';
import { CANCEL_SELECT, cancelLoadedRequest, cancelMessage, type CancelAudience, type CancelResult } from '@/lib/services/request-cancel.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveDiscordActor, type DiscordActor } from '../discord-actor';
import { decodeManageCustomId, isRequestId } from '../discord-custom-id';
import { textOnly } from '../discord-format';
import { refreshDiscordRequestCards } from '../discord-runtime';
import { statusLabel } from '../cards/discord-card-embeds';
import { EPHEMERAL, MANAGE_TEXT, runOnce, showOutcome, stepFailed, type ManageInteraction } from './discord-manage-common';
import { cancelConfirmReply, pageReply, readRequestPage } from './discord-request-list';

const logger = RMABLogger.create('Discord.Status');

/** What the cancel service needs, plus the requester, for the requester check. */
const CANCEL_RECORD_SELECT = { ...CANCEL_SELECT, userId: true } as const;

type CancelRecord = NonNullable<Awaited<ReturnType<typeof readCancelRecord>>>;
type Loaded = { record: CancelRecord; refusal?: undefined } | { record?: undefined; refusal: string };
type CancelStep = { confirm: ReturnType<typeof cancelConfirmReply>; refusal?: undefined } | { confirm?: undefined; refusal: string };

function readCancelRecord(requestId: string) {
  return prisma.request.findFirst({ where: { id: requestId, deletedAt: null }, select: CANCEL_RECORD_SELECT });
}

/** Cancels being run in this process, keyed by request ID. */
const cancelsInFlight = new Set<string>();

function notCancellableText(status: string): string {
  if (status === 'cancelled') return MANAGE_TEXT.alreadyCancelled;
  return `This request can no longer be cancelled. Status: ${statusLabel({ status, deletedAt: null })}.`;
}

/**
 * The fixed reply for a cancel result, chosen by its result fields. The download client is never
 * named, and a requester is never told that another request shares the download.
 */
export function cancelReplyText(result: CancelResult, audience: CancelAudience): string {
  if (!result.success) return result.reason === 'not_found' ? MANAGE_TEXT.notFound : notCancellableText(result.status);
  if (result.alreadyCancelled) return MANAGE_TEXT.alreadyCancelled;
  if (result.download === 'kept') return 'Request cancelled. Its download stays in the download client.';
  return cancelMessage(result.download, audience);
}

/** True for a result that means the cards showed a Cancel that no longer applies. */
function isStale(result: CancelResult): boolean {
  return !result.success || result.alreadyCancelled === true;
}

/**
 * The request when `actor` may cancel it (theirs, or they are an RMAB admin), else the fixed
 * refusal. A request gone meanwhile has its cards brought up to date.
 */
async function loadForCancel(actor: DiscordActor, requestId: string): Promise<Loaded> {
  const record = await readCancelRecord(requestId);
  if (!record) {
    refreshDiscordRequestCards(requestId);
    return { refusal: MANAGE_TEXT.notFound };
  }
  if (record.userId !== actor.userId && !actor.isAdmin) {
    logger.info('Refused a Discord cancel of another user\'s request', { userId: actor.userId, requestId });
    return { refusal: MANAGE_TEXT.notYours };
  }
  return { record };
}

/** The confirmation for a Cancel, or the fixed refusal (a stale click brings the cards up to date). */
async function confirmOrRefuse(actor: DiscordActor, requestId: string, backPage: number): Promise<CancelStep> {
  const loaded = await loadForCancel(actor, requestId);
  if (!loaded.record) return { refusal: loaded.refusal };
  if (!isCancellableStatus(loaded.record.status)) {
    refreshDiscordRequestCards(requestId);
    return { refusal: notCancellableText(loaded.record.status) };
  }
  return { confirm: cancelConfirmReply(loaded.record, actor, backPage) };
}

/** The confirm button: checks everything again, then cancels once (a second press runs nothing). */
async function confirmCancel(interaction: ManageInteraction, requestId: string): Promise<void> {
  await interaction.deferUpdate();
  const actor = await resolveDiscordActor(interaction.user.id);
  if (!actor) {
    await interaction.editReply(textOnly(MANAGE_TEXT.notLinked));
    return;
  }
  const loaded = await loadForCancel(actor, requestId);
  if (!loaded.record) {
    await showOutcome(interaction, 'status', actor, 0, loaded.refusal);
    return;
  }
  const record = loaded.record;
  const ran = await runOnce(cancelsInFlight, requestId, async () => {
    // The buttons go before the cancel starts
    await interaction.editReply(textOnly(MANAGE_TEXT.cancelling));
    const audience: CancelAudience = actor.isAdmin ? 'admin' : 'owner';
    const result = await cancelLoadedRequest(record, { audience });
    logger.info('Discord cancel', { userId: actor.userId, requestId, outcome: result.success ? (result.alreadyCancelled ? 'already' : 'cancelled') : result.reason });
    if (isStale(result)) refreshDiscordRequestCards(requestId);
    await showOutcome(interaction, 'status', actor, 0, cancelReplyText(result, audience));
  });
  if (!ran) logger.debug('Ignored a second cancel confirm while the first runs', { requestId });
}

/** Slash command `/status`. */
export async function handleStatusCommand(interaction: ManageInteraction): Promise<void> {
  if (interaction.guildId === null || !interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply(EPHEMERAL);
    const actor = await resolveDiscordActor(interaction.user.id);
    if (!actor) {
      await interaction.editReply(textOnly(MANAGE_TEXT.notLinked));
      return;
    }
    await interaction.editReply(pageReply('status', actor, await readRequestPage(actor, 0)));
  } catch (error) {
    await stepFailed(interaction, 'status', error);
  }
}

/**
 * Status page buttons (also Keep request), the Cancel menu on a page, the Cancel button on a card
 * or approval message, and the cancel confirm (custom_id `rmab:sts:`). A card can sit in a DM;
 * the checks below do not depend on where.
 */
export async function handleStatusComponent(interaction: ManageInteraction): Promise<void> {
  const id = decodeManageCustomId(interaction.customId);
  if (!id || id.area !== 'status') {
    logger.debug('Ignored a status interaction with an unknown custom id');
    return;
  }

  try {
    if (id.action === 'confirm' && interaction.isButton()) {
      await confirmCancel(interaction, id.requestId);
      return;
    }

    if (id.action === 'cancel' && interaction.isButton()) {
      // A new ephemeral reply: the card itself is updated by the cancel
      await interaction.deferReply(EPHEMERAL);
      const actor = await resolveDiscordActor(interaction.user.id);
      if (!actor) {
        await interaction.editReply(textOnly(MANAGE_TEXT.notLinked));
        return;
      }
      const step = await confirmOrRefuse(actor, id.requestId, 0);
      await interaction.editReply(step.confirm ?? textOnly(step.refusal));
      return;
    }

    const isPage = id.action === 'page' && interaction.isButton();
    const isMenu = id.action === 'menu' && interaction.isStringSelectMenu();
    if (!isPage && !isMenu) {
      logger.debug('Ignored a status interaction whose kind does not match its custom id', { action: id.action });
      return;
    }

    await interaction.deferUpdate();
    const actor = await resolveDiscordActor(interaction.user.id);
    if (!actor) {
      await interaction.editReply(textOnly(MANAGE_TEXT.notLinked));
      return;
    }
    // The page is listed for the account acting now, whatever page the custom_id names
    if (isMenu) {
      const requestId = interaction.values?.[0];
      const step: CancelStep = isRequestId(requestId) ? await confirmOrRefuse(actor, requestId, id.page) : { refusal: MANAGE_TEXT.staleChoice };
      if (step.confirm) await interaction.editReply(step.confirm);
      else await showOutcome(interaction, 'status', actor, id.page, step.refusal);
      return;
    }
    await interaction.editReply(pageReply('status', actor, await readRequestPage(actor, id.page)));
  } catch (error) {
    await stepFailed(interaction, `status ${id.action}`, error);
  }
}
