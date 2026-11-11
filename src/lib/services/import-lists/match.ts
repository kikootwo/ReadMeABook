/**
 * Component: Import List Audible Matching
 * Documentation: documentation/backend/services/list-sync.md
 *
 * Resolves a list book (Goodreads title + author) to an Audible audiobook by comparing
 * title and author across the search results instead of trusting the first hit, and caches
 * the result (including the Audible data the filter rules read).
 */

import { prisma } from '@/lib/db';
import { getAudibleService } from '@/lib/integrations/audible.service';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';
import type { AudibleMeta } from './filter';
import type { ListBook } from './goodreads-list.provider';

const MATCH_THRESHOLD = 0.8;
/** A book Audible did not carry is searched again after this many days */
const NO_MATCH_RETRY_DAYS = 14;
/** A cached match is refreshed after this many days (ratings drift slowly) */
const REFRESH_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ResolvedBook {
  /** Audible data, or null when Audible has no acceptable match */
  meta: AudibleMeta | null;
  /** True when Audible was searched (not served from the cache) */
  searched: boolean;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

/** Sørensen–Dice similarity of two strings (0..1). */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let overlap = 0;
  for (const [gram, count] of gx) overlap += Math.min(count, gy.get(gram) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

/**
 * Audible often adds a series prefix ("The Dark Tower I: The Gunslinger") or an edition suffix to a title.
 * When the shorter title (two or more words) appears as whole words inside the longer one, score it high,
 * a little higher the closer the two lengths are so a bare series name does not beat the exact book.
 */
function containmentScore(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.split(' ').length < 2) return 0;
  if (!` ${long} `.includes(` ${short} `)) return 0;
  return 0.8 + 0.15 * (short.length / long.length);
}

/** Best score of the list title (and its pre-colon form) against an Audible title. */
function titleScore(listTitle: string, audibleTitle: string): number {
  const variants = [listTitle];
  const beforeColon = listTitle.split(':')[0].trim();
  if (beforeColon && beforeColon !== listTitle) variants.push(beforeColon);
  return Math.max(...variants.map((v) => Math.max(similarity(v, audibleTitle), containmentScore(v, audibleTitle))));
}

function authorMatches(listAuthor: string, audibleAuthor: string): boolean {
  const surname = normalize(listAuthor).split(' ').pop();
  return !surname || normalize(audibleAuthor).includes(surname);
}

/** Pick the best Audible result for a title/author, or null if nothing is close enough. */
export function pickBestMatch(title: string, author: string, results: AudibleAudiobook[]): AudibleAudiobook | null {
  let best: AudibleAudiobook | null = null;
  let bestScore = 0;
  for (const result of results) {
    if (!result.asin || !authorMatches(author, result.author || '')) continue;
    // Audible often keeps the real name in the subtitle ("Dark Tower I" / "The Gunslinger")
    const names = [result.title || ''];
    if (result.subtitle) names.push(`${result.title} ${result.subtitle}`, result.subtitle);
    let score = Math.max(...names.map((name) => titleScore(title, name)));
    if ((result.formatType || '').toLowerCase() === 'unabridged') score += 0.02;
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

function toMeta(result: AudibleAudiobook): AudibleMeta {
  return {
    asin: result.asin,
    title: result.title,
    author: result.author,
    narrator: result.narrator,
    coverArtUrl: result.coverArtUrl,
    description: result.description,
    durationMinutes: result.durationMinutes,
    releaseDate: result.releaseDate,
    rating: result.rating,
    language: result.language,
    formatType: result.formatType,
    publisherName: result.publisherName,
    genres: result.genres,
  };
}

async function searchAudible(title: string, author: string): Promise<AudibleAudiobook | null> {
  const audible = getAudibleService();
  const attempts = [`${title} ${author}`];
  const withoutSubtitle = title.split(':')[0].trim();
  if (withoutSubtitle && withoutSubtitle !== title) attempts.push(`${withoutSubtitle} ${author}`);

  for (const query of attempts) {
    const found = pickBestMatch(title, author, (await audible.search(query)).results);
    if (found) return found;
  }
  return null;
}

/** Resolve a list book to Audible data, using and updating the cache. */
export async function resolveListBook(book: ListBook): Promise<ResolvedBook> {
  const cached = await prisma.importListBookMatch.findUnique({ where: { externalBookId: book.bookId } });
  const age = cached ? (Date.now() - cached.lastSearchAt.getTime()) / DAY_MS : Infinity;

  if (cached) {
    if (cached.noMatch && age < NO_MATCH_RETRY_DAYS) return { meta: null, searched: false };
    if (!cached.noMatch && cached.metaJson && age < REFRESH_DAYS) {
      return { meta: JSON.parse(cached.metaJson) as AudibleMeta, searched: false };
    }
  }

  const found = await searchAudible(book.title, book.author);
  const data = {
    title: book.title,
    author: book.author,
    asin: found?.asin ?? null,
    metaJson: found ? JSON.stringify(toMeta(found)) : null,
    noMatch: !found,
    lastSearchAt: new Date(),
  };
  await prisma.importListBookMatch.upsert({
    where: { externalBookId: book.bookId },
    create: { externalBookId: book.bookId, ...data },
    update: data,
  });
  return { meta: found ? toMeta(found) : null, searched: true };
}
