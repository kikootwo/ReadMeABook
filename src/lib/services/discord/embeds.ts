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
  type Embed,
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

/** Format a runtime in minutes as e.g. "12h 34m" / "45m". */
function formatDuration(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Normalize Audible's format_type ("unabridged"/"abridged") to a display label. */
function formatAbridgement(formatType?: string | null): string | null {
  if (!formatType) return null;
  const lower = formatType.toLowerCase();
  if (lower.includes('unabridged')) return 'Unabridged';
  if (lower.includes('abridged')) return 'Abridged';
  return null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Reduce a comma-separated person list (authors/narrators) to just the top-listed name. */
function firstPerson(value?: string | null): string {
  if (!value) return '';
  const first = value.split(',')[0]?.trim();
  return first || value.trim();
}

/** Append a release year to a title in parentheses, e.g. "Lonesome Dove (2025)". */
function titleWithYear(title: string, year?: number | null): string {
  return year ? `${title} (${year})` : title;
}

/** The rich book metadata shared by the confirm card, request card, and approval embed. */
export interface BookEmbedFields {
  title: string;
  author: string;
  mediaType: string; // 'audiobook' | 'ebook'
  narrator?: string | null;
  durationMinutes?: number | null;
  year?: number | null;
  series?: string | null;
  seriesPart?: string | null;
  formatType?: string | null;
  genres?: string[] | null;
  coverArtUrl?: string | null;
  description?: string | null;
}

/**
 * Add the shared book detail fields (author, narrator, duration, series #, format, genre) to an
 * embed. Narrator, duration, and abridgement are audiobook-only concepts and are omitted for ebooks.
 * Author/narrator are reduced to the top-listed person; the year is folded into the title elsewhere.
 */
function addBookFields(embed: EmbedBuilder, f: BookEmbedFields, includeType = true): void {
  const isEbook = f.mediaType === 'ebook';
  embed.addFields({ name: 'Author', value: firstPerson(f.author) || 'Unknown', inline: true });
  if (includeType) {
    embed.addFields({
      name: 'Type',
      value: isEbook ? 'E-book' : 'Audiobook',
      inline: true,
    });
  }
  if (!isEbook && f.narrator) {
    embed.addFields({ name: 'Narrator', value: truncate(firstPerson(f.narrator), 256), inline: true });
  }

  if (!isEbook) {
    const duration = formatDuration(f.durationMinutes);
    if (duration) embed.addFields({ name: 'Duration', value: duration, inline: true });
  }

  if (f.series) {
    const series = f.seriesPart ? `${f.series} #${f.seriesPart}` : f.series;
    embed.addFields({ name: 'Series', value: truncate(series, 256), inline: true });
  }

  if (!isEbook) {
    const format = formatAbridgement(f.formatType);
    if (format) embed.addFields({ name: 'Format', value: format, inline: true });
  }

  if (f.genres && f.genres.length > 0) {
    const genres = f.genres.slice(0, 2).join(', ');
    embed.addFields({ name: 'Genre', value: truncate(genres, 256), inline: true });
  }
}

/** Map an AudibleAudiobook + media type into the shared BookEmbedFields shape. */
function toBookFields(book: AudibleAudiobook, mediaType: MediaType): BookEmbedFields {
  const year = formatYear(book.releaseDate);
  return {
    title: book.title,
    author: book.author,
    mediaType,
    narrator: book.narrator ?? null,
    durationMinutes: book.durationMinutes ?? null,
    year: year ? Number(year) : null,
    series: book.series ?? null,
    seriesPart: book.seriesPart ?? null,
    formatType: book.formatType ?? null,
    genres: book.genres ?? null,
    coverArtUrl: book.coverArtUrl ?? null,
    description: book.description ?? null,
  };
}

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

// ============================================================================
// Request status → footer / color / cancellability (shared by card + updater)
// ============================================================================

/** Statuses where the request is still in flight and a Cancel button should be offered. */
const CANCELLABLE_STATUSES = new Set([
  'pending',
  'awaiting_approval',
  'awaiting_search',
  'awaiting_release',
  'searching',
  'downloading',
  'processing',
  'awaiting_import',
  'warn',
]);

/** Whether a request in this status can still be cancelled (search/download not yet complete). */
export function isCancellableStatus(status: string): boolean {
  return CANCELLABLE_STATUSES.has(status);
}

/**
 * Human-readable footer for a request card. For approved requests, a leading approval marker is
 * joined to the current download stage with a separating dot (e.g. "✅ Approved • ⬇️ Downloading").
 */
export function requestStatusFooter(status: string): string {
  switch (status) {
    case 'awaiting_approval':
      return '⏳ Awaiting Admin Approval';
    case 'denied':
      return '🚫 Request Denied';
    case 'cancelled':
      return '🚫 Request Cancelled';
    case 'pending':
    case 'awaiting_search':
    case 'searching':
      return '✅ Approved • 🔎 Searching';
    case 'awaiting_release':
      return '✅ Approved • 📅 Awaiting Release';
    case 'downloading':
      return '✅ Approved • ⬇️ Downloading';
    case 'processing':
    case 'awaiting_import':
      return '✅ Approved • ⚙️ Processing';
    case 'downloaded':
      return '✅ Approved • 📚 Download Complete';
    case 'available':
      return '✅ Approved • 📚 Available';
    case 'failed':
      return '✅ Approved • ❌ Download Failed';
    case 'warn':
      return '✅ Approved • ⚠️ Needs Attention';
    default:
      return `Status: ${status}`;
  }
}

/** Embed accent color for a request card given its status. */
export function colorForStatus(status: string): number {
  switch (status) {
    case 'available':
    case 'downloaded':
      return COLOR.success;
    case 'denied':
    case 'cancelled':
    case 'failed':
      return COLOR.error;
    case 'awaiting_approval':
      return COLOR.info;
    case 'warn':
      return COLOR.warning;
    default:
      return COLOR.brand;
  }
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
  narrator?: string | null;
  durationMinutes?: number | null;
  year?: number | null;
  series?: string | null;
  seriesPart?: string | null;
  formatType?: string | null;
  genres?: string[] | null;
  coverArtUrl?: string | null;
}): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const embed = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle('📥 New Request — ⏳ Pending')
    .addFields({ name: 'Title', value: titleWithYear(params.title, params.year), inline: false });

  addBookFields(embed, {
    title: params.title,
    author: params.author,
    mediaType: params.mediaType,
    narrator: params.narrator,
    durationMinutes: params.durationMinutes,
    year: params.year,
    series: params.series,
    seriesPart: params.seriesPart,
    formatType: params.formatType,
    genres: params.genres,
  });

  embed
    .addFields({ name: 'Requested By', value: params.requestedBy, inline: true })
    .setFooter({ text: `Request ID: ${params.requestId}` })
    .setTimestamp(new Date());

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

/**
 * Re-render an admin approval embed after a decision: update the title/color to reflect who
 * approved/denied it, preserving the book detail fields.
 */
export function applyApprovalDecision(
  existing: Embed,
  action: 'approve' | 'deny',
  decidedByDiscordId: string
): EmbedBuilder {
  const approved = action === 'approve';
  // Mentions don't render in embed titles, so the acting user goes in a field value as <@id>.
  return EmbedBuilder.from(existing)
    .setColor(approved ? COLOR.success : COLOR.error)
    .setTitle(approved ? '✅ Request Approved' : '🚫 Request Denied')
    .addFields({
      name: approved ? 'Approved by' : 'Denied by',
      value: `<@${decidedByDiscordId}>`,
      inline: true,
    });
}

/**
 * Re-render an admin approval embed after the request was cancelled (by the requester or an admin)
 * before any decision was made. Notes who cancelled it (as an @mention); the caller removes the
 * Approve/Deny buttons but leaves the embed in place for reference.
 */
export function applyApprovalCancellation(existing: Embed, cancelledByDiscordId: string): EmbedBuilder {
  return EmbedBuilder.from(existing)
    .setColor(COLOR.error)
    .setTitle('🚫 Request Cancelled')
    .addFields({ name: 'Cancelled by', value: `<@${cancelledByDiscordId}>`, inline: true });
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
