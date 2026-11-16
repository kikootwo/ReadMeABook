/**
 * Component: Discord /request Handlers
 * Documentation: documentation/integrations/discord-bot.md
 *
 * `/request type:<audiobook|ebook> [query]` → (search form when no query) → results menu →
 * book embed with Request / Cancel → the request is created with the shared creators, as
 * the RMAB account linked to the person clicking. Every step checks access again
 * (account and requester role) and answers ephemerally. Each step acknowledges Discord (defer,
 * or for Request / Cancel an update that removes the buttons) before any database or HTTP
 * work, except the command that opens the search form:
 * a form must be the first reply, so that step checks access (database only) and then shows it.
 * Replies are fixed texts; errors are logged, never shown. A new request's card (and approval
 * message) is posted in the background after the reply.
 */

import { getAudibleService } from '@/lib/integrations/audible.service';
import { createRequestForUser } from '@/lib/services/request-creator.service';
import { createEbookRequestForUser } from '@/lib/services/ebook-request-creator.service';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import { REQUEST_QUERY_MAX_LENGTH } from '../discord-commands';
import { decodeRequestCustomId, isAsin, isRequestMediaType, type RequestMediaType } from '../discord-custom-id';
import { MessageFlags, NO_MENTIONS, textOnly } from '../discord-format';
import { announceDiscordRequest } from '../discord-runtime';
import { bookEmbed, searchResultOptions } from '../discord-book-embed';
import { checkRequestAccess, type RequestInteraction } from './discord-request-access';
import {
  QUERY_INPUT_ID,
  TEXT,
  audiobookResultText,
  confirmButtons,
  ebookResultText,
  resultsMenu,
  resultsText,
  searchModal,
} from './discord-request-replies';

const logger = RMABLogger.create('Discord.Request');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };


/** Shows the fixed error text, whatever state the interaction is in; never throws. */
async function failQuietly(interaction: RequestInteraction, step: string, error: unknown): Promise<void> {
  logger.warn('Discord /request step failed', { step, error: errorForLog(error) });
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(textOnly(TEXT.generic));
    else await interaction.reply({ ...textOnly(TEXT.generic), ...EPHEMERAL });
  } catch (replyError) {
    logger.debug('Could not show the /request error', { error: errorForLog(replyError) });
  }
}

/** Searches Audible (language filter applies) and shows up to 25 results in a menu. */
async function showResults(interaction: RequestInteraction, type: RequestMediaType, rawQuery: string): Promise<void> {
  const query = rawQuery.trim();
  if (!query) {
    await interaction.editReply(textOnly(TEXT.emptyQuery));
    return;
  }
  if (query.length > REQUEST_QUERY_MAX_LENGTH) {
    await interaction.editReply(textOnly(TEXT.queryTooLong));
    return;
  }

  const search = await getAudibleService().search(query, 1);
  const options = searchResultOptions(search.results);
  const hiddenCount = search.languageFilter?.hiddenCount ?? 0;
  if (options.length === 0) {
    await interaction.editReply(textOnly(hiddenCount > 0 ? TEXT.allHidden : TEXT.noResults));
    return;
  }
  await interaction.editReply({
    content: resultsText(type, query, hiddenCount),
    embeds: [],
    components: resultsMenu(type, options),
    allowedMentions: NO_MENTIONS,
  });
}

/** Slash command `/request`. */
export async function handleRequestCommand(interaction: RequestInteraction): Promise<void> {
  if (interaction.guildId === null || !interaction.isChatInputCommand()) return;
  try {
    const type = interaction.options?.getString('type');
    if (!isRequestMediaType(type)) {
      await interaction.reply({ ...textOnly(TEXT.unknownType), ...EPHEMERAL });
      return;
    }
    const query = interaction.options?.getString('query')?.trim() ?? '';

    if (!query) {
      // The form must be the first reply: check access (database only), then open it
      const access = await checkRequestAccess(interaction);
      if (!access.ok) {
        await interaction.reply({ ...textOnly(access.reply), ...EPHEMERAL });
        return;
      }
      await interaction.showModal(searchModal(type));
      return;
    }

    await interaction.deferReply(EPHEMERAL);
    const access = await checkRequestAccess(interaction);
    if (!access.ok) {
      await interaction.editReply(textOnly(access.reply));
      return;
    }
    await showResults(interaction, type, query);
  } catch (error) {
    await failQuietly(interaction, 'command', error);
  }
}

/** Modal submits, the results menu and the confirm/cancel buttons (custom_id `rmab:req:`). */
export async function handleRequestComponent(interaction: RequestInteraction): Promise<void> {
  // Request steps happen in the server; a DM has no member to check the role against
  if (interaction.guildId === null) return;
  const id = decodeRequestCustomId(interaction.customId);
  if (!id) {
    logger.debug('Ignored a /request interaction with an unknown custom id');
    return;
  }

  try {
    if (id.step === 'modal' && interaction.isModalSubmit()) {
      await interaction.deferReply(EPHEMERAL);
      const access = await checkRequestAccess(interaction);
      if (!access.ok) {
        await interaction.editReply(textOnly(access.reply));
        return;
      }
      await showResults(interaction, id.type, interaction.fields?.getTextInputValue(QUERY_INPUT_ID) ?? '');
      return;
    }

    if (id.step === 'pick' && interaction.isStringSelectMenu()) {
      await interaction.deferUpdate();
      const access = await checkRequestAccess(interaction);
      if (!access.ok) {
        await interaction.editReply(textOnly(access.reply));
        return;
      }
      const asin = interaction.values?.[0];
      if (!isAsin(asin)) {
        await interaction.editReply(textOnly(TEXT.staleChoice));
        return;
      }
      const book = await getAudibleService().getAudiobookDetails(asin);
      if (!book) {
        await interaction.editReply(textOnly(TEXT.bookNotFound));
        return;
      }
      await interaction.editReply({
        content: TEXT.confirm,
        embeds: [bookEmbed(book, id.type)],
        components: confirmButtons(id.type, asin),
        allowedMentions: NO_MENTIONS,
      });
      return;
    }

    if (id.step === 'cancel' && interaction.isButton()) {
      // The buttons go with the acknowledgement, so the message cannot be pressed again
      await interaction.update({ content: TEXT.cancelling, components: [], allowedMentions: NO_MENTIONS });
      const access = await checkRequestAccess(interaction);
      await interaction.editReply(textOnly(access.ok ? TEXT.cancelled : access.reply));
      return;
    }

    if (id.step === 'confirm' && interaction.isButton()) {
      await confirmRequest(interaction, id.type, id.asin!);
      return;
    }

    logger.debug('Ignored a /request interaction whose kind does not match its step', { step: id.step });
  } catch (error) {
    await failQuietly(interaction, id.step, error);
  }
}

/** Confirms being handled in this process, keyed `discordUserId:type:asin`. */
const confirmsInFlight = new Set<string>();

/**
 * The Request button. A second press for the same book while the first is still being made
 * (a double click lands before Discord removes the buttons) gets a fixed reply and creates
 * nothing; the creators check for an existing request but are not atomic.
 */
async function confirmRequest(interaction: RequestInteraction, type: RequestMediaType, asin: string): Promise<void> {
  const key = `${interaction.user.id}:${type}:${asin}`;
  if (confirmsInFlight.has(key)) {
    await interaction.reply({ ...textOnly(TEXT.alreadyWorking), ...EPHEMERAL });
    return;
  }
  confirmsInFlight.add(key);
  let createdId: string | undefined;
  try {
    // The buttons go with the acknowledgement; the book embed stays
    await interaction.update({ content: TEXT.requesting, components: [], allowedMentions: NO_MENTIONS });
    const access = await checkRequestAccess(interaction);
    if (!access.ok) {
      await interaction.editReply(textOnly(access.reply));
      return;
    }
    const created = await createRequest(access.actor.userId, type, asin);
    createdId = created.createdId;
    // Keep the book embed so the reply shows what was requested
    await interaction.editReply({ content: created.content, components: [], allowedMentions: NO_MENTIONS });
  } finally {
    confirmsInFlight.delete(key);
    // A new request: its live card and, while it waits, the approval message (in the background),
    // even when the reply above could not be shown
    if (createdId) announceDiscordRequest(createdId);
  }
}

/** Creates the request as `userId` with the shared creator; returns the fixed reply text and the new request's ID. */
async function createRequest(
  userId: string,
  type: RequestMediaType,
  asin: string
): Promise<{ content: string; createdId?: string }> {
  if (type === 'ebook') {
    const result = await createEbookRequestForUser(userId, asin);
    logger.info('Discord ebook request', { userId, asin, outcome: result.outcome, requestId: result.requestId });
    return { content: ebookResultText(result), createdId: result.outcome === 'created' ? result.requestId : undefined };
  }

  // The creator reads no series fields, so skip the catalog series fill
  const book = await getAudibleService().getAudiobookDetails(asin, { fillSeries: false });
  if (!book) return { content: TEXT.bookNotFound };
  // The same options as POST /api/requests (a manual request skips the ignore list)
  const result = await createRequestForUser(
    userId,
    {
      asin,
      title: book.title,
      author: book.author,
      narrator: book.narrator,
      description: book.description,
      coverArtUrl: book.coverArtUrl,
    },
    { bypassIgnore: true }
  );
  const createdId = result.success ? (result.request as { id?: unknown } | null)?.id : undefined;
  logger.info('Discord audiobook request', {
    userId,
    asin,
    outcome: result.success ? 'created' : result.reason,
    requestId: createdId,
  });
  return { content: audiobookResultText(result), createdId: typeof createdId === 'string' ? createdId : undefined };
}
