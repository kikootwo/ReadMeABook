/**
 * Component: Prowlarr Search Query Variations (first pass and fallback pass, #316)
 * Documentation: documentation/phase3/prowlarr.md
 */

import type { TorrentResult } from '../utils/ranking-algorithm';
import { foldNumberWord, foldReleaseWords } from '../utils/match-gates';
import {
  apostropheEndingWords, foldApostrophes, hasNonLatinLetter, isWordInTitle, keepUnrequestedApostrophes, normalizeForMatching,
} from '../utils/match-normalize';

/** Ranking's default (English) stop words: a release name may leave these out (the fallback does not know the language) */
const STOP_WORDS = ['the', 'a', 'an', 'of', 'on', 'in', 'at', 'by', 'for'];
/** Ranking's word-coverage bar (Stage 1): share of the required title words a release must hold */
const MIN_COVERAGE = 0.8;
/** Punctuation inside a word, which indexers may not match: Anarchist's, L'intruse, Op-Center */
const INNER_PUNCTUATION_RE = /[\p{L}\p{M}\p{N}][^\p{L}\p{M}\p{N}\s]+(?=[\p{L}\p{M}\p{N}])/u;
/** Subtitle split: a colon (PR #304), or ". " right after a number ("Primal Hunter 1. Une aventure") */
const SUBTITLE_SPLIT_RE = /:|(?<=\d)\.\s/;
/** A subtitle-free base with fewer letters and digits than this is too vague to send ("Re:Zero" -> "Re") */
const MIN_BASE_CHARACTERS = 3;
/** A bracketed part of a title, which ranking treats as optional */
const BRACKETED_RE = /[([{][^)\]}]*[)\]}]/g;

const sameQuery = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * "title author" then "title", leaving out blank queries and any already in `sent`
 * (ignoring case). A blank author gives "title" once; no query is ever empty.
 */
export function searchQueries(title: string, author: string, sent: string[] = []): string[] {
  const trimmedTitle = title.trim();
  const queries: string[] = [];
  for (const query of [`${trimmedTitle} ${(author ?? '').trim()}`.trim(), trimmedTitle]) {
    if (query && ![...sent, ...queries].some((other) => sameQuery(other, query))) queries.push(query);
  }
  return queries;
}

/** The title before its subtitle; null when it has none or nothing would be left (": Title") */
export function subtitleFreeTitle(title: string): string | null {
  const base = title.split(SUBTITLE_SPLIT_RE)[0].trim();
  return base && base !== title.trim() ? base : null;
}

/**
 * The title with apostrophes folded (Anarchist's -> Anarchists, L'intruse -> L intruse) and
 * other punctuation as spaces; null when no word has punctuation inside it ("Mr. Mercedes").
 */
export function strippedTitle(title: string): string | null {
  if (!INNER_PUNCTUATION_RE.test(title)) return null;
  const stripped = foldApostrophes(title).replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return stripped || null;
}

/** True when a subtitle-free base names enough to search for: 3+ letters and digits, or any non-Latin letter (三体) */
const searchableBase = (base: string): boolean =>
  Array.from(base.replace(/[^\p{L}\p{M}\p{N}]/gu, '')).length >= MIN_BASE_CHARACTERS || hasNonLatinLetter(base);

/**
 * Titles for the fallback pass, in order: the stripped title, then the subtitle-free title
 * (stripped too when it has punctuation inside a word; left out when it is too short to name
 * the book). Empty when there is nothing to vary.
 */
export function fallbackTitles(title: string): string[] {
  const subtitleFree = subtitleFreeTitle(title);
  const base = subtitleFree && searchableBase(subtitleFree) ? subtitleFree : null;
  const titles: string[] = [];
  for (const candidate of [strippedTitle(title), base && (strippedTitle(base) ?? base)]) {
    if (candidate && !titles.some((other) => sameQuery(other, candidate))) titles.push(candidate);
  }
  return titles;
}

/** Words a release must hold: no subtitle, no bracketed part, stop words left out unless that is all */
function requiredWords(title: string): string[] {
  const base = (subtitleFreeTitle(title) ?? title).replace(BRACKETED_RE, ' ');
  const words = normalizeForMatching(base).split(' ').filter(Boolean);
  const content = words.filter((word) => !STOP_WORDS.includes(word));
  return (content.length > 0 ? content : words).map(foldNumberWord);
}

/**
 * True when some result names the title: it holds 80% of the required title words, close to the
 * word-coverage check ranking applies first. Apostrophes and numbers fold as in ranking. Unlike
 * ranking, the stop words are always English, and a number then ". " also starts a subtitle.
 */
export function hasUsableResult(title: string, results: TorrentResult[]): boolean {
  const required = requiredWords(title);
  if (required.length === 0) return results.length > 0;
  const requested = apostropheEndingWords(title);
  return results.some((result) => {
    const name = normalizeForMatching(keepUnrequestedApostrophes(result.title ?? '', requested));
    const words = foldReleaseWords(name.split(' ').filter(Boolean));
    const found = required.filter((word) => isWordInTitle(word, words, name)).length;
    return found / required.length >= MIN_COVERAGE;
  });
}
