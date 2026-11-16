/**
 * Component: Discord Book Embed and Search Options
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Book metadata only (title, author, narrator, series, cover): never request internals,
 * paths, users or settings. Book text is markdown-escaped in embeds; select menu text is
 * plain (Discord does not render markdown there) and only cut to Discord's limits.
 */

import type { AudibleAudiobook } from '@/lib/integrations/audible.service';
import { isAsin, type RequestMediaType } from './discord-custom-id';
import { DISCORD_LIMITS, clip, safeText } from './discord-format';

/** The book fields the embed and the select menu read. */
export type BookFields = Pick<AudibleAudiobook, 'asin' | 'title' | 'author' | 'narrator' | 'series' | 'seriesPart' | 'coverArtUrl'>;

export interface DiscordEmbed {
  title: string;
  fields: { name: string; value: string; inline: boolean }[];
  thumbnail?: { url: string };
  footer: { text: string };
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

const TYPE_LABEL: Record<RequestMediaType, string> = { audiobook: 'Audiobook', ebook: 'Ebook' };

/** Only an https image URL is used as the cover; anything else is left out. */
function coverUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && url.length <= 2048 ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function seriesText(book: BookFields): string {
  if (!book.series) return '';
  return book.seriesPart ? `${book.series}, book ${book.seriesPart}` : book.series;
}

/** The confirm-step embed for one book. */
export function bookEmbed(book: BookFields, type: RequestMediaType): DiscordEmbed {
  const fields = [
    { name: 'Author', value: book.author },
    { name: 'Narrator', value: book.narrator ?? '' },
    { name: 'Series', value: seriesText(book) },
  ]
    .map((field) => ({ name: field.name, value: safeText(field.value, DISCORD_LIMITS.embedFieldValue), inline: true }))
    .filter((field) => field.value.length > 0);

  const thumbnail = coverUrl(book.coverArtUrl);
  return {
    title: safeText(book.title, DISCORD_LIMITS.embedTitle) || 'Untitled',
    fields,
    ...(thumbnail && { thumbnail: { url: thumbnail } }),
    footer: { text: `${TYPE_LABEL[type]} request` },
  };
}

/** Up to 25 select options, one per ASIN (Discord refuses repeated values), invalid ASINs dropped. */
export function searchResultOptions(results: BookFields[]): SelectOption[] {
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  for (const book of results) {
    if (options.length >= DISCORD_LIMITS.selectOptions) break;
    if (!isAsin(book.asin) || seen.has(book.asin)) continue;
    seen.add(book.asin);
    const label = clip(book.title || 'Untitled', DISCORD_LIMITS.selectLabel) || 'Untitled';
    const byline = [book.author, book.narrator && `read by ${book.narrator}`].filter(Boolean).join(', ');
    const description = byline ? clip(`by ${byline}`, DISCORD_LIMITS.selectDescription) : undefined;
    options.push({ label, value: book.asin, ...(description && { description }) });
  }
  return options;
}
