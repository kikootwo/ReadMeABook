/**
 * Component: Discord Embed Shared Book Fields
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Shared palette, text helpers, and the book-detail field assembly used by every bot embed (confirm
 * card, request card, approval embed, and the /status & /delete list/confirm embeds). Centralizing
 * addBookFields keeps the rendered field set identical across all surfaces.
 */

import { EmbedBuilder } from 'discord.js';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';
import type { MediaType } from '../custom-id';

// Severity colors (match src/lib/services/notification/providers/discord.provider.ts)
export const COLOR = {
  info: 0xfbbf24, // yellow-400
  success: 0x22c55e, // green-500
  error: 0xef4444, // red-500
  warning: 0xf97316, // orange-500
  brand: 0x6366f1, // indigo-500
} as const;

export const MAX_SELECT_OPTIONS = 25; // Discord hard limit on select menu options

/** A normalized request row for /status and /delete lists. */
export interface RequestListItem {
  id: string;
  title: string;
  author: string;
  type: string; // 'audiobook' | 'ebook'
  status: string;
  createdAt: Date;
  narrator?: string | null;
  year?: number | null;
  series?: string | null;
  seriesPart?: string | null;
  coverArtUrl?: string | null;
  requestedBy?: string | null;
  // Rich detail used by the /delete confirmation preview. The list queries don't populate these
  // (they aren't stored in the DB); they're merged in from live Audible metadata + the cached file.
  durationMinutes?: number | null;
  formatType?: string | null;
  genres?: string[] | null;
  fileSizeBytes?: number | null;
  fileFormat?: string | null;
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

export function formatYear(releaseDate?: string): string | null {
  if (!releaseDate) return null;
  const year = new Date(releaseDate).getFullYear();
  return Number.isNaN(year) ? null : String(year);
}

/** Format a runtime in minutes as e.g. "12h 34m" / "45m". */
export function formatDuration(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Normalize Audible's format_type ("unabridged"/"abridged") to a display label. */
export function formatAbridgement(formatType?: string | null): string | null {
  if (!formatType) return null;
  const lower = formatType.toLowerCase();
  if (lower.includes('unabridged')) return 'Unabridged';
  if (lower.includes('abridged')) return 'Abridged';
  return null;
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Reduce a comma-separated person list (authors/narrators) to just the top-listed name. */
export function firstPerson(value?: string | null): string {
  if (!value) return '';
  const first = value.split(',')[0]?.trim();
  return first || value.trim();
}

/** Append a release year to a title in parentheses, e.g. "Lonesome Dove (2025)". */
export function titleWithYear(title: string, year?: number | null): string {
  return year ? `${title} (${year})` : title;
}

/** Display label for a request type. */
export function typeLabel(type: string): string {
  return type === 'ebook' ? 'E-book' : 'Audiobook';
}

/**
 * Add the shared book detail fields (author, narrator, duration, series #, format, genre) to an
 * embed. Narrator, duration, and abridgement are audiobook-only concepts and are omitted for ebooks.
 * Author/narrator are reduced to the top-listed person; the year is folded into the title elsewhere.
 */
export function addBookFields(embed: EmbedBuilder, f: BookEmbedFields, includeType = true): void {
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
export function toBookFields(book: AudibleAudiobook, mediaType: MediaType): BookEmbedFields {
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

/** Map a normalized RequestListItem into the shared BookEmbedFields shape. List rows usually carry
 * no duration/format/genre (addBookFields simply omits them); the /delete preview enriches them. */
export function listItemToBookFields(item: RequestListItem): BookEmbedFields {
  return {
    title: item.title,
    author: item.author,
    mediaType: item.type,
    narrator: item.narrator ?? null,
    durationMinutes: item.durationMinutes ?? null,
    year: item.year ?? null,
    series: item.series ?? null,
    seriesPart: item.seriesPart ?? null,
    formatType: item.formatType ?? null,
    genres: item.genres ?? null,
    coverArtUrl: item.coverArtUrl ?? null,
  };
}

/** Format a byte count as a human-readable size (e.g. "1.2 GB", "340 MB"), or null when unknown. */
export function formatFileSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// ============================================================================
// Request status → footer / color / cancellability (shared by card + lists)
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
