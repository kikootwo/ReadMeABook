/**
 * Component: Automatic-Search Match Gates (author words, numbers, volumes, one-word titles)
 * Documentation: documentation/phase3/match-gates.md
 */

import { compareTwoStrings } from 'string-similarity';
import { collapseInitials, matchesByInitials } from './author-initials';
import { foldForMatching, FULLWIDTH_RE, fromFullwidth, hasUnspacedScript, normalizeForMatching } from './match-normalize';

const DIGITS_RE = /^\d+$/;
/** English number words, folded to digits for the coverage and number checks only */
const NUMBER_WORDS = new Map(Object.entries({
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20',
}));
/** A release word that names a volume with its number glued on: t01, tome2, vol3, v4, book5, livre6 */
const VOLUME_TOKEN_RE = /^(?:t|tome|vol|volume|v|book|livre)0*(\d{1,3})$/;
/** An explicit series position (G4c); `#N` is read as `book N` before tokenizing */
const POSITION_TOKEN_RE = /^(?:t|tome|vol|volume|book|livre)0*(\d{1,3})$/;
const POSITION_WORDS = new Set(['t', 'tome', 'vol', 'volume', 'book', 'livre']);

const stripZeros = (digits: string): string => digits.replace(/^0+(?=\d)/, '');
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ========== G4a: numbers ==========

/** Coverage form of a word: digits lose leading zeros, English number words one to twenty become digits */
export function foldNumberWord(word: string): string {
  if (DIGITS_RE.test(word)) return stripZeros(word);
  return NUMBER_WORDS.get(word) ?? word;
}

/** Release words for the coverage check: number-folded, plus the number inside each volume token (t01 → 1) */
export function foldReleaseWords(words: string[]): string[] {
  const folded = words.map(foldNumberWord);
  for (const word of words) {
    const volume = VOLUME_TOKEN_RE.exec(word);
    if (volume) folded.push(stripZeros(volume[1]));
  }
  return folded;
}

/** True when a number in the folded required title is missing from the folded release words */
export function missingRequiredNumber(requiredFolded: string[], releaseFolded: string[]): boolean {
  const present = new Set(releaseFolded.filter((word) => DIGITS_RE.test(word)));
  return requiredFolded.some((word) => DIGITS_RE.test(word) && !present.has(word));
}

// ========== G3: author names as whole words ==========

/** A name as whole words: no letter may touch it (digits may), a trailing 's or s is allowed */
const namePattern = (name: string): string => `(?<![\\p{L}\\p{M}])${escapeRe(name)}(?:'s|s)?(?![\\p{L}\\p{M}])`;
/** The name, plus its words glued together ("lee child" → "leechild") */
const nameForms = (author: string): string[] => {
  const glued = author.replace(/ /g, '');
  return glued === author ? [author] : [author, glued];
};

/**
 * True when the normalized author appears in the normalized title as whole words, as its words
 * glued together, or with a possessive or plural ending. Names in unspaced scripts match as substrings.
 *   "lee child" in "lee child getaway" or "leechild getaway": yes; in "children of the fleet": no
 */
export function authorAppears(title: string, author: string): boolean {
  if (!author) return false;
  if (hasUnspacedScript(author)) return title.includes(author);
  return new RegExp(nameForms(author).map(namePattern).join('|'), 'u').test(title);
}

const wordIndex = (title: string, word: string): number =>
  hasUnspacedScript(word) ? title.indexOf(word) : (new RegExp(namePattern(word), 'u').exec(title)?.index ?? -1);

/**
 * Automatic-mode author gate: at least one author is present with high confidence.
 * 1. whole words (authorAppears)  2. fuzzy similarity >= 0.85
 * 3. first and last name as whole words within 30 characters  4. initials (author-initials.ts)
 */
export function isAuthorPresent(title: string, authors: string[]): boolean {
  return authors.some((author) => {
    if (!author) return false;
    if (authorAppears(title, author)) return true;
    if (compareTwoStrings(author, title) >= 0.85) return true;
    const words = author.split(/\s+/).filter((w) => w.length > 1);
    if (words.length >= 2) {
      const first = wordIndex(title, words[0]);
      const last = wordIndex(title, words[words.length - 1]);
      if (first !== -1 && last !== -1 && Math.abs(last - first) <= 30) return true;
    }
    return matchesByInitials(title, author);
  });
}

// ========== G1: colon right after the title ==========

/**
 * True when the release text after the title starts with a colon and that subtitle (up to the next
 * marker) shares at least half its significant words with the request's own subtitle.
 */
export function colonSubtitleAgrees(afterTitle: string, subtitleWords: Set<string>, toWords: (text: string) => string[]): boolean {
  if (!afterTitle.startsWith(':') || subtitleWords.size === 0) return false;
  let subtitle = afterTitle.substring(1);
  const cuts = [' by ', ' [', ' (', ' {', ' - ', ','].map((m) => subtitle.indexOf(m)).filter((i) => i >= 0);
  if (cuts.length > 0) subtitle = subtitle.substring(0, Math.min(...cuts));
  const words = toWords(subtitle);
  return words.length > 0 && words.filter((w) => subtitleWords.has(w)).length / words.length >= 0.5;
}

// ========== G4b: a one-word title must stand alone ==========

/** Words that may follow a one-word title: formats, editions, languages (one list, see match-gates.md) */
const AFTER_TITLE_WORDS = new Set([
  'mp3', 'm4b', 'm4a', 'flac', 'aac', 'ogg', 'opus', 'epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'cbz', 'cbr',
  'unabridged', 'abridged', 'audiobook', 'audio', 'retail', 'eng', 'en', 'english',
  'deluxe', 'anniversary', 'special', 'expanded', 'edition', 'dramatized', 'dramatised',
  'ungekurzt', 'ungekuerzt', 'gekurzt', 'horbuch', 'hoerbuch', 'german', 'deutsch', 'de',
  'fr', 'french', 'vf', 'vff', 'integral', 'integrale',
  'audiolibro', 'completo', 'es', 'spanish', 'ita', 'italian',
]);
/** Two-word phrases that may follow a one-word title */
const AFTER_TITLE_PHRASES = new Set([
  'read by', 'narrated by', 'full cast', 'livre audio', 'lu par', 'letto da', 'leido por', 'narrado por',
]);
const YEAR_RE = /^(?:19|20)\d\d$/;
const BITRATE_RE = /^\d+k(?:bps|bs|b)?$/;
const ORDINAL_RE = /^\d+(?:st|nd|rd|th)$/;
const NUMBER_AFTER_RE = /^(?:book|tome|vol|volume|livre|t?\d{1,3})$/;
const LEFT_SEPARATOR_RE = /[-:—\])]/;
const RIGHT_SEPARATOR_RE = /[-:—,([{]/;

/** Word tokens of a release name (same words as normalizeForMatching) and the raw text between them */
function tokenize(text: string, characterReplacements?: Record<string, string>): { tokens: string[]; gaps: string[] } {
  const folded = foldForMatching(text.replace(/([a-z])([A-Z])/g, '$1 $2'), characterReplacements);
  const tokens: string[] = [];
  const gaps: string[] = [];
  let end = 0;
  for (const m of folded.matchAll(/[\p{L}\p{M}\p{N}']+/gu)) {
    gaps.push(folded.substring(end, m.index));
    tokens.push(m[0]);
    end = m.index + m[0].length;
  }
  gaps.push(folded.substring(end));
  return { tokens, gaps };
}

/** The one required title word G4b checks: a single word, no digit, in a spaced script; else null */
export function shortTitleWord(requiredWords: string[]): string | null {
  if (requiredWords.length !== 1) return null;
  const word = requiredWords[0];
  return /\d/.test(word) || hasUnspacedScript(word) ? null : word;
}

export interface ShortTitleContext {
  word: string;                 // the one required word, not number-folded
  authors: string[];            // normalized authors
  stopWords: string[];
  subtitleWords: Set<string>;   // significant words of the request's optional part
  characterReplacements?: Record<string, string>;
}

const endsWithAuthor = (before: string, authors: string[]): boolean => authors.some((author) => {
  if (!author) return false;
  if (hasUnspacedScript(author)) return before.endsWith(author);
  if (nameForms(author).some((form) => new RegExp(`(?:^| )${escapeRe(form)}(?:'s|s)?$`, 'u').test(before))) return true;
  return ` ${collapseInitials(before)}`.endsWith(` ${collapseInitials(author)}`);
});

const startsWithAuthor = (after: string, authors: string[]): boolean =>
  authors.some((author) => author && ` ${after} `.startsWith(` ${author} `));

/**
 * G4b, checked per occurrence of the word in the release. Stop words on either side are skipped.
 * Left: the start, the end of an author name, a separator (- : — ] )) or a number/volume token.
 * Right: 'clean' for the end, "by", an author name, a year, bitrate, ordinal, a listed format,
 * edition or language word, or a request subtitle word; 'loose' for a separator or a number.
 * Returns the best tier over all occurrences, or null when no occurrence stands alone.
 */
export function shortTitleBoundary(release: string, ctx: ShortTitleContext): 'clean' | 'loose' | null {
  const { tokens, gaps } = tokenize(release, ctx.characterReplacements);
  const stop = new Set(ctx.stopWords);
  let best: 'clean' | 'loose' | null = null;
  tokens.forEach((token, i) => {
    if (token !== ctx.word || best === 'clean') return;
    let j = i;
    while (j > 0 && stop.has(tokens[j - 1])) j--;
    const leftOk = j === 0 ||
      LEFT_SEPARATOR_RE.test(gaps.slice(j, i + 1).join('')) ||
      DIGITS_RE.test(tokens[j - 1]) || VOLUME_TOKEN_RE.test(tokens[j - 1]) ||
      endsWithAuthor(tokens.slice(0, j).join(' '), ctx.authors);
    if (!leftOk) return;
    let k = i + 1;
    while (k < tokens.length && stop.has(tokens[k]) && tokens[k] !== 'by') k++;
    const next = tokens[k];
    const clean = next === undefined || next === 'by' || AFTER_TITLE_WORDS.has(next) ||
      YEAR_RE.test(next) || BITRATE_RE.test(next) || ORDINAL_RE.test(next) ||
      AFTER_TITLE_PHRASES.has(`${next} ${tokens[k + 1]}`) || ctx.subtitleWords.has(next) ||
      startsWithAuthor(tokens.slice(k).join(' '), ctx.authors);
    if (clean) best = 'clean';
    else if (RIGHT_SEPARATOR_RE.test(gaps[i + 1]) || NUMBER_AFTER_RE.test(next)) best = 'loose';
  });
  return best;
}

// ========== G4c: volume conflict ==========

/** Tokens for position reading: "#12" reads as "book 12" */
const positionTokens = (text: string, characterReplacements?: Record<string, string>): string[] =>
  normalizeForMatching(text.replace(/#\s*(?=\d)/g, ' book '), characterReplacements).split(' ').filter(Boolean);

/** The position named at token i ("t03", "book 2", "vol 3") and how many tokens it spans */
function positionAt(tokens: string[], i: number): { value: string; span: number } | null {
  const glued = POSITION_TOKEN_RE.exec(tokens[i] ?? '');
  if (glued) return { value: stripZeros(glued[1]), span: 1 };
  if (POSITION_WORDS.has(tokens[i]) && /^\d{1,3}$/.test(tokens[i + 1] ?? '')) return { value: stripZeros(tokens[i + 1]), span: 2 };
  return null;
}

/**
 * G4c: true when the request names exactly one series position and the release names a different
 * one right after the request's title or series name (#330 owns the full series-number check).
 *   "Dungeon Crawler Carl (book 1)" vs "Dungeon Crawler Carl, T03 …" → true
 *   "Guards! Guards! (Discworld, Book 8)" vs "Discworld 08 - City Watch Book 1 - Guards! Guards!" → false
 */
export function volumeConflict(title: string, release: string, stopWords: string[], characterReplacements?: Record<string, string>): boolean {
  const stop = new Set(stopWords);
  const wanted = new Set<string>();
  const anchors: string[][] = [];
  const segments = title.toLowerCase().replace(FULLWIDTH_RE, fromFullwidth).split(/[()[\]{}【】:]/);
  for (const segment of segments) {
    const tokens = positionTokens(segment, characterReplacements);
    let start = 0;
    for (let i = 0; i < tokens.length; i++) {
      const position = positionAt(tokens, i);
      if (!position) continue;
      wanted.add(position.value);
      if (i > start) anchors.push(tokens.slice(start, i));
      start = i + position.span;
      i = start - 1;
    }
    if (start < tokens.length) anchors.push(tokens.slice(start));
  }
  if (wanted.size !== 1) return false;

  const releaseTokens = positionTokens(release, characterReplacements);
  const named = new Set<string>();
  for (const anchor of anchors.filter((a) => a.some((w) => !stop.has(w)))) {
    for (let i = 0; i + anchor.length <= releaseTokens.length; i++) {
      if (!anchor.every((word, n) => releaseTokens[i + n] === word)) continue;
      const position = positionAt(releaseTokens, i + anchor.length);
      if (position) named.add(position.value);
    }
  }
  return named.size > 0 && ![...wanted].some((value) => named.has(value));
}
