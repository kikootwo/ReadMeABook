/**
 * Component: Discord Embed & Component Builders
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Builds the embeds, select menus, and buttons used by the bot's command flows. Colors mirror the
 * severity palette used by the Discord notification provider for a consistent look.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';
import { encodeCustomId, type MediaType } from './custom-id';

// Severity colors (match src/lib/services/notification/providers/discord.provider.ts)
const COLOR = {
  info: 0xfbbf24, // yellow-400
  success: 0x22c55e, // green-500
  error: 0xef4444, // red-500
  warning: 0xf97316, // orange-500
  brand: 0x6366f1, // indigo-500
} as const;

const MAX_SELECT_OPTIONS = 25; // Discord hard limit on select menu options

/** A normalized request row for /status and /delete lists. */
export interface RequestListItem {
  id: string;
  title: string;
  author: string;
  type: string; // 'audiobook' | 'ebook'
  status: string;
  createdAt: Date;
}

/** Simple informational embed. */
export function infoEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLOR.brand).setTitle(title).setDescription(description);
}

/** Error embed. */
export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLOR.error).setTitle('⚠️ Something went wrong').setDescription(message);
}

/** Shown when the invoking Discord account is not linked to an RMAB user. */
export function notLinkedEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR.warning)
    .setTitle('🔗 Account not linked')
    .setDescription(
      'Your Discord account is not linked to a ReadMeABook user yet. Ask an admin to add your Discord User ID in the admin Users page.'
    );
}

function formatYear(releaseDate?: string): string | null {
  if (!releaseDate) return null;
  const year = new Date(releaseDate).getFullYear();
  return Number.isNaN(year) ? null : String(year);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Build the result dropdown for a /checkout search. Option values are ASINs.
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
    .setCustomId(encodeCustomId({ kind: 'checkout_select', mediaType }))
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
  const year = formatYear(book.releaseDate);
  const embed = new EmbedBuilder()
    .setColor(COLOR.brand)
    .setTitle(book.title)
    .addFields(
      { name: 'Author', value: book.author || 'Unknown', inline: true },
      { name: 'Type', value: mediaType === 'ebook' ? 'E-book' : 'Audiobook', inline: true }
    );

  if (book.narrator) embed.addFields({ name: 'Narrator', value: book.narrator, inline: true });
  if (year) embed.addFields({ name: 'Year', value: year, inline: true });
  if (book.series) {
    const series = book.seriesPart ? `${book.series} #${book.seriesPart}` : book.series;
    embed.addFields({ name: 'Series', value: series, inline: true });
  }
  if (book.coverArtUrl) embed.setThumbnail(book.coverArtUrl);
  if (book.description) embed.setDescription(truncate(book.description.replace(/<[^>]*>/g, ''), 300));

  const confirm = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'checkout_confirm', mediaType, asin: book.asin }))
    .setLabel('Confirm Request')
    .setStyle(ButtonStyle.Success);
  const cancel = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'cancel' }))
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel);
  return { embed, row };
}

/**
 * Build the admin approval message: a rich embed plus Approve/Deny buttons. Content (the role
 * ping) is supplied separately by the caller.
 */
export function buildApprovalMessage(params: {
  requestId: string;
  title: string;
  author: string;
  mediaType: string;
  requestedBy: string;
  year?: number | null;
  series?: string | null;
  coverArtUrl?: string | null;
}): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const embed = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle('📥 New request awaiting approval')
    .addFields(
      { name: 'Title', value: params.title, inline: false },
      { name: 'Author', value: params.author || 'Unknown', inline: true },
      { name: 'Type', value: params.mediaType === 'ebook' ? 'E-book' : 'Audiobook', inline: true },
      { name: 'Requested By', value: params.requestedBy, inline: true }
    )
    .setFooter({ text: `Request ID: ${params.requestId}` })
    .setTimestamp(new Date());

  if (params.year) embed.addFields({ name: 'Year', value: String(params.year), inline: true });
  if (params.series) embed.addFields({ name: 'Series', value: params.series, inline: true });
  if (params.coverArtUrl) embed.setThumbnail(params.coverArtUrl);

  const approve = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'approval', action: 'approve', requestId: params.requestId }))
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success);
  const deny = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'approval', action: 'deny', requestId: params.requestId }))
    .setLabel('Deny')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approve, deny);
  return { embed, row };
}

const STATUS_EMOJI: Record<string, string> = {
  pending: '🕐',
  awaiting_approval: '⏳',
  awaiting_search: '🕐',
  awaiting_release: '📅',
  searching: '🔎',
  downloading: '⬇️',
  processing: '⚙️',
  downloaded: '📦',
  available: '✅',
  failed: '❌',
  denied: '🚫',
  warn: '⚠️',
};

function formatRequestLine(item: RequestListItem, includeOwnerHint = false): string {
  const emoji = STATUS_EMOJI[item.status] ?? '•';
  const typeLabel = item.type === 'ebook' ? 'E-book' : 'Audiobook';
  void includeOwnerHint;
  return `${emoji} **${truncate(item.title, 80)}** — ${item.author}\n   ${typeLabel} · \`${item.status}\``;
}

/**
 * Build a read-only list embed for /status.
 */
export function buildStatusEmbed(items: RequestListItem[], scopeAll: boolean): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLOR.brand)
    .setTitle(scopeAll ? '📋 All outstanding requests' : '📋 Your outstanding requests');

  if (items.length === 0) {
    embed.setDescription('No outstanding requests.');
    return embed;
  }

  embed.setDescription(items.map((i) => formatRequestLine(i)).join('\n\n'));
  return embed;
}

/**
 * Build the /delete select menu (option values are request IDs). Returns null if no deletable items.
 */
export function buildDeleteSelect(
  items: RequestListItem[]
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (items.length === 0) return null;

  const options = items.slice(0, MAX_SELECT_OPTIONS).map((item) => {
    const typeLabel = item.type === 'ebook' ? 'E-book' : 'Audiobook';
    return new StringSelectMenuOptionBuilder()
      .setLabel(truncate(item.title, 100))
      .setDescription(truncate(`${typeLabel} • ${item.status} • ${item.author}`, 100))
      .setValue(item.id);
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId({ kind: 'delete_select' }))
    .setPlaceholder('Select a request to delete…')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
