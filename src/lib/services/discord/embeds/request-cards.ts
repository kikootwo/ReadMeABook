/**
 * Component: Discord Request Card Builders
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Builders for the /request flow: the search-result dropdown, the confirmation card, and the
 * persistent live request card (with status footer + Cancel button) posted after confirmation.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Embed,
} from 'discord.js';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';
import { encodeCustomId, type MediaType } from '../custom-id';
import {
  COLOR,
  MAX_SELECT_OPTIONS,
  addBookFields,
  colorForStatus,
  formatYear,
  isCancellableStatus,
  requestStatusFooter,
  titleWithYear,
  toBookFields,
  truncate,
} from './book-fields';

/**
 * Build the result dropdown for a /request search. Option values are ASINs.
 */
export function buildSearchSelect(
  results: AudibleAudiobook[],
  mediaType: MediaType
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = results.slice(0, MAX_SELECT_OPTIONS).map((book) => {
    const year = formatYear(book.releaseDate);
    const descriptionParts = [book.author];
    if (year) descriptionParts.push(year);
    if (book.narrator) descriptionParts.push(`Narrated by ${book.narrator}`);

    return new StringSelectMenuOptionBuilder()
      // Labels/descriptions have a 100-char Discord limit
      .setLabel(truncate(book.title, 100))
      .setDescription(truncate(descriptionParts.join(' • '), 100))
      .setValue(book.asin);
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId({ kind: 'request_select', mediaType }))
    .setPlaceholder('Select a title…')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/**
 * Build the confirmation embed (with cover thumbnail) + Confirm/Cancel buttons for a selected title.
 */
export function buildConfirmMessage(
  book: AudibleAudiobook,
  mediaType: MediaType
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const fields = toBookFields(book, mediaType);
  const embed = new EmbedBuilder().setColor(COLOR.brand).setTitle(titleWithYear(fields.title, fields.year));
  addBookFields(embed, fields);
  if (fields.coverArtUrl) embed.setThumbnail(fields.coverArtUrl);
  if (fields.description) embed.setDescription(truncate(fields.description.replace(/<[^>]*>/g, ''), 300));

  const confirm = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'request_confirm', mediaType, asin: book.asin }))
    .setLabel('Confirm Request')
    .setStyle(ButtonStyle.Success);
  const cancel = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'cancel' }))
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel);
  return { embed, row };
}

/** Build the Cancel Request component row, or [] when the status is no longer cancellable. */
export function buildCancelComponents(
  requestId: string,
  status: string
): ActionRowBuilder<ButtonBuilder>[] {
  if (!isCancellableStatus(status)) return [];
  const cancel = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'cancel_request', requestId }))
    .setLabel('Cancel Request')
    .setStyle(ButtonStyle.Danger);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(cancel)];
}

/**
 * Build the persistent, auto-updating request card posted on /request (public and/or DM). Keeps the
 * full book detail (cover, description, fields) with the current status in the footer, plus a Cancel
 * Request button while the request is still in flight.
 */
export function buildRequestCard(
  book: AudibleAudiobook,
  mediaType: MediaType,
  status: string,
  requestId: string,
  requestedBy: string
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
  const fields = toBookFields(book, mediaType);
  const embed = new EmbedBuilder()
    .setColor(colorForStatus(status))
    .setTitle(titleWithYear(fields.title, fields.year));
  addBookFields(embed, fields);
  embed.addFields({ name: 'Requested By', value: requestedBy, inline: true });
  if (fields.coverArtUrl) embed.setThumbnail(fields.coverArtUrl);
  if (fields.description) embed.setDescription(truncate(fields.description.replace(/<[^>]*>/g, ''), 300));
  embed.setFooter({ text: requestStatusFooter(status) }).setTimestamp(new Date());

  return { embed, components: buildCancelComponents(requestId, status) };
}

/**
 * Re-render an existing request card for a new status: preserve the rich embed (cover, fields,
 * description) but rewrite the accent color + footer, and recompute the Cancel button. Used by the
 * background notification hook and the Cancel handler.
 */
export function rebuildCardForStatus(
  existing: Embed,
  status: string,
  requestId: string
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = EmbedBuilder.from(existing)
    .setColor(colorForStatus(status))
    .setFooter({ text: requestStatusFooter(status) });
  return { embed, components: buildCancelComponents(requestId, status) };
}
