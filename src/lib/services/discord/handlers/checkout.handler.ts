/**
 * Component: Discord Checkout Handler
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Implements the /checkout flow: search-term modal → Audible result dropdown → confirmation →
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
import { actorMeta } from '../discord-helpers';
import {
  buildConfirmMessage,
  buildSearchSelect,
  errorEmbed,
  infoEmbed,
  notLinkedEmbed,
} from '../embeds';
import { postApprovalRequest } from './approval.handler';

const logger = RMABLogger.create('Discord.Checkout');

const SEARCH_INPUT_ID = 'search_term';

/** /checkout <type>: gate on account linkage, then open the search-term modal. */
export async function handleCheckoutCommand(
  interaction: ChatInputCommandInteraction,
  mediaType: MediaType
): Promise<void> {
  const resolved = await resolveRmabUser(interaction.user.id);
  if (!resolved) {
    await interaction.reply({ embeds: [notLinkedEmbed()], ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(encodeCustomId({ kind: 'checkout_modal', mediaType }))
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
export async function handleCheckoutModal(
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
  logger.info('Checkout search', { ...actorMeta(interaction.user, resolved.user.id), mediaType, query });

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
    logger.error('Checkout search failed', {
      ...actorMeta(interaction.user, resolved.user.id),
      error: error instanceof Error ? error.message : String(error),
    });
    await interaction.editReply({ embeds: [errorEmbed('Search failed. Please try again later.')] });
  }
}

/** Dropdown select: show the confirmation card for the chosen ASIN. */
export async function handleCheckoutSelect(
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
export async function handleCheckoutConfirm(
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
        await postApprovalRequest(interaction.client, {
          requestId: result.requestId,
          title: book.title,
          author: book.author,
          mediaType: 'ebook',
          requestedBy: resolved.user.plexUsername,
          year: book.releaseDate ? new Date(book.releaseDate).getFullYear() : null,
          series: book.series ?? null,
          coverArtUrl: book.coverArtUrl ?? null,
        });
      }

      logger.info('Ebook request created via Discord', { ...meta, asin, needsApproval: result.needsApproval });
      await interaction.editReply({
        embeds: [
          infoEmbed(
            result.needsApproval ? '⏳ Request submitted' : '✅ Request created',
            `**${book.title}** (E-book) — ${result.message}`
          ),
        ],
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
      await postApprovalRequest(interaction.client, {
        requestId: result.request.id,
        title: book.title,
        author: book.author,
        mediaType: 'audiobook',
        requestedBy: resolved.user.plexUsername,
        year: book.releaseDate ? new Date(book.releaseDate).getFullYear() : null,
        series: book.series ?? null,
        coverArtUrl: book.coverArtUrl ?? null,
      });
    }

    logger.info('Audiobook request created via Discord', { ...meta, asin, needsApproval });
    await interaction.editReply({
      embeds: [
        infoEmbed(
          needsApproval ? '⏳ Request submitted' : '✅ Request created',
          needsApproval
            ? `**${book.title}** has been submitted for admin approval.`
            : `**${book.title}** has been requested and is being processed.`
        ),
      ],
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
