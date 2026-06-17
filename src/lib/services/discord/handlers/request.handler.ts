/**
 * Component: Discord Request Handler
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Implements the /request flow: search-term modal → Audible result dropdown → confirmation →
 * request creation. Reuses createRequestForUser (audiobooks) and createEbookRequestForUser (ebooks)
 * so Discord requests are identical to Web UI requests, including the approval gate.
 */

import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { createRequestForUser } from '@/lib/services/request-creator.service';
import { createEbookRequestForUser } from '@/lib/services/ebook-request-creator.service';
import { RMABLogger } from '@/lib/utils/logger';
import type { MediaType } from '../custom-id';
import { encodeCustomId } from '../custom-id';
import { resolveRmabUser } from '../discord-user.resolver';
import { getDiscordConfig } from '../discord-config';
import { actorMeta, memberHasRole } from '../discord-helpers';
import {
  buildConfirmMessage,
  buildSearchSelect,
  errorEmbed,
  infoEmbed,
  notLinkedEmbed,
} from '../embeds';
import { postRequestCards } from '../discord-cards';
import { postApprovalRequest } from './approval.handler';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const logger = RMABLogger.create('Discord.Request');

const SEARCH_INPUT_ID = 'search_term';

/** /request <type>: gate on account linkage, then open the search-term modal. */
export async function handleRequestCommand(
  interaction: ChatInputCommandInteraction,
  mediaType: MediaType
): Promise<void> {
  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.reply({ embeds: [notLinkedEmbed()], ephemeral: true });
    return;
  }

  // Optional requester-role gate: when configured, only members holding that role (or RMAB admins)
  // may make requests.
  const config = await getDiscordConfig();
  if (config.requesterRoleId && !resolved.isAdmin) {
    const allowed = await memberHasRole(interaction, config.requesterRoleId);
    if (!allowed) {
      await interaction.reply({
        embeds: [
          errorEmbed('You do not have permission to make requests. Ask an admin for the requester role.'),
        ],
        ephemeral: true,
      });
      logger.warn('Blocked request from member without requester role', {
        ...actorMeta(interaction.user, resolved.user.id),
      });
      return;
    }
  }

  const modal = new ModalBuilder()
    .setCustomId(encodeCustomId({ kind: 'request_modal', mediaType }))
    .setTitle(mediaType === 'ebook' ? 'Search for an e-book' : 'Search for an audiobook');

  const input = new TextInputBuilder()
    .setCustomId(SEARCH_INPUT_ID)
    .setLabel('Title, author, or keywords')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

/** Modal submit: run the Audible search and present a result dropdown. */
export async function handleRequestModal(
  interaction: ModalSubmitInteraction,
  mediaType: MediaType
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()] });
    return;
  }

  const query = interaction.fields.getTextInputValue(SEARCH_INPUT_ID).trim();
  logger.info('Request search', { ...actorMeta(interaction.user, resolved.user.id), mediaType, query });

  try {
    const audible = getAudibleService();
    const result = await audible.search(query, 1);

    if (!result.results.length) {
      await interaction.editReply({
        embeds: [infoEmbed('No results', `No titles found for **${query}**. Try different keywords.`)],
      });
      return;
    }

    const row = buildSearchSelect(result.results, mediaType);
    await interaction.editReply({
      embeds: [infoEmbed('Select a title', `Showing results for **${query}**.`)],
      components: [row],
    });
  } catch (error) {
    logger.error('Request search failed', {
      ...actorMeta(interaction.user, resolved.user.id),
      error: error instanceof Error ? error.message : String(error),
    });
    await interaction.editReply({ embeds: [errorEmbed('Search failed. Please try again later.')] });
  }
}

/** Dropdown select: show the confirmation card for the chosen ASIN. */
export async function handleRequestSelect(
  interaction: StringSelectMenuInteraction,
  mediaType: MediaType
): Promise<void> {
  await interaction.deferUpdate();
  const asin = interaction.values[0];

  try {
    const audible = getAudibleService();
    const book = await audible.getAudiobookDetails(asin);

    if (!book) {
      await interaction.editReply({
        embeds: [errorEmbed('Could not load details for that title. Please try again.')],
        components: [],
      });
      return;
    }

    const { embed, row } = buildConfirmMessage(book, mediaType);
    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    logger.error('Failed to load title details', {
      ...actorMeta(interaction.user),
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    await interaction.editReply({
      embeds: [errorEmbed('Could not load details for that title. Please try again.')],
      components: [],
    });
  }
}

/** Confirm button: create the request (audiobook or ebook) and report the outcome. */
export async function handleRequestConfirm(
  interaction: ButtonInteraction,
  mediaType: MediaType,
  asin: string
): Promise<void> {
  await interaction.deferUpdate();

  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  const meta = actorMeta(interaction.user, resolved.user.id);
  // Show the requester as a clickable Discord @mention on the cards and approval embed.
  const requesterMention = `<@${interaction.user.id}>`;

  try {
    const audible = getAudibleService();
    const book = await audible.getAudiobookDetails(asin);
    if (!book) {
      await interaction.editReply({
        embeds: [errorEmbed('Could not load details for that title. Please try again.')],
        components: [],
      });
      return;
    }

    if (mediaType === 'ebook') {
      const result = await createEbookRequestForUser(resolved.user.id, asin);
      if (!result.success) {
        await interaction.editReply({ embeds: [errorEmbed(result.message)], components: [] });
        return;
      }

      if (result.needsApproval) {
        await postApprovalRequest(interaction.client, approvalParams(result.requestId, book, 'ebook', requesterMention));
      }

      logger.info('Ebook request created via Discord', { ...meta, asin, needsApproval: result.needsApproval });

      const refs = await postRequestCards(interaction.client, {
        requestId: result.requestId,
        book,
        mediaType: 'ebook',
        status: result.needsApproval ? 'awaiting_approval' : 'pending',
        requestedBy: requesterMention,
        requesterDiscordUserId: interaction.user.id,
      });

      await interaction.editReply({
        embeds: [confirmationEmbed(book, result.needsApproval, refs.length > 0)],
        components: [],
      });
      return;
    }

    // Audiobook
    const result = await createRequestForUser(
      resolved.user.id,
      {
        asin: book.asin,
        title: book.title,
        author: book.author,
        narrator: book.narrator,
        description: book.description,
        coverArtUrl: book.coverArtUrl,
      },
      { bypassIgnore: true }
    );

    if (!result.success) {
      await interaction.editReply({ embeds: [errorEmbed(result.message)], components: [] });
      logger.info('Audiobook request rejected', { ...meta, asin, reason: result.reason });
      return;
    }

    const needsApproval = result.request.status === 'awaiting_approval';
    if (needsApproval) {
      await postApprovalRequest(interaction.client, approvalParams(result.request.id, book, 'audiobook', requesterMention));
    }

    logger.info('Audiobook request created via Discord', { ...meta, asin, needsApproval });

    const refs = await postRequestCards(interaction.client, {
      requestId: result.request.id,
      book,
      mediaType: 'audiobook',
      status: result.request.status,
      requestedBy: requesterMention,
      requesterDiscordUserId: interaction.user.id,
    });

    await interaction.editReply({
      embeds: [confirmationEmbed(book, needsApproval, refs.length > 0)],
      components: [],
    });
  } catch (error) {
    logger.error('Failed to create request', {
      ...meta,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    await interaction.editReply({ embeds: [errorEmbed('Failed to create the request. Please try again.')], components: [] });
  }
}

/** Build the rich approval-embed params for a created request from its Audible details. */
function approvalParams(
  requestId: string,
  book: AudibleAudiobook,
  mediaType: MediaType,
  requestedBy: string
) {
  return {
    requestId,
    title: book.title,
    author: book.author,
    mediaType,
    requestedBy,
    narrator: book.narrator ?? null,
    durationMinutes: book.durationMinutes ?? null,
    year: book.releaseDate ? new Date(book.releaseDate).getFullYear() : null,
    series: book.series ?? null,
    seriesPart: book.seriesPart ?? null,
    formatType: book.formatType ?? null,
    genres: book.genres ?? null,
    coverArtUrl: book.coverArtUrl ?? null,
  };
}

/**
 * The small ephemeral acknowledgement shown to the requester after confirm. When a live request card
 * was posted, it points there; otherwise it falls back to a self-contained status message.
 */
function confirmationEmbed(book: AudibleAudiobook, needsApproval: boolean, cardPosted: boolean) {
  const title = needsApproval ? '⏳ Request submitted' : '✅ Request created';
  const body = cardPosted
    ? `**${book.title}** — follow its live status on the request card.`
    : needsApproval
      ? `**${book.title}** has been submitted for admin approval.`
      : `**${book.title}** has been requested and is being processed.`;
  return infoEmbed(title, body);
}
