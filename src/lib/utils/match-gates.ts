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
/** Words that name a volume, glued to its number (t01, vol3, bk1) or followed by it (book 2): one list for G1, G4a, G4b */
const VOLUME_WORDS = ['t', 'tome', 'vol', 'volume', 'v', 'book', 'bk', 'livre'];
const VOLUME_WORD_SET = new Set(VOLUME_WORDS);
const VOLUME_TOKEN_RE = new RegExp(`^(?:${VOLUME_WORDS.join('|')})0*(\\d{1,3})$`);
/** G4c positions: the same words without v, since a glued v2 is often a re-release tag, not volume 2 */
const POSITION_WORDS = VOLUME_WORDS.filter((word) => word !== 'v');
const POSITION_WORD_SET = new Set(POSITION_WORDS);
const POSITION_TOKEN_RE = new RegExp(`^(?:${POSITION_WORDS.join('|')})0*(\\d{1,3})$`);

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

/** A bare number right before a `. `, ` - ` or `: ` subtitle split is a series position, not a title number */
const SPLIT_NUMBER_RE = /(?<![\p{L}\p{N}#.])0*(\d{1,3})(?=\.\s|\s+[-–—]\s|\s*:)/gu;

/** Series positions written before a subtitle split: "Die Tribute von Panem 1. Tödliche Spiele" → {1} */
export function splitPositionNumbers(title: string): Set<string> {
  return new Set([...title.matchAll(SPLIT_NUMBER_RE)].map((m) => stripZeros(m[1])));
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

/** The number a word names: a digit word, a number word, or a volume token (book2 → 2); else null */
const numberOf = (word: string): string | null => {
  const volume = VOLUME_TOKEN_RE.exec(word);
  if (volume) return stripZeros(volume[1]);
  const folded = foldNumberWord(word);
  return DIGITS_RE.test(folded) ? folded : null;
};
/** Words that say which book, not what it is called: volume words and numbers */
const isPositionWord = (word: string): boolean => VOLUME_WORD_SET.has(word) || numberOf(word) !== null;

/**
 * True when the release text after the title starts with a colon and that subtitle (up to the next
 * marker) agrees with the request's own subtitle: no number the request lacks, and at least half of
 * its words other than volume words and numbers are in the request subtitle.
 */
export function colonSubtitleAgrees(afterTitle: string, subtitleWords: Set<string>, toWords: (text: string) => string[]): boolean {
  if (!afterTitle.startsWith(':') || subtitleWords.size === 0) return false;
  let subtitle = afterTitle.substring(1);
  const cuts = [' by ', ' [', ' (', ' {', ' - ', ','].map((m) => subtitle.indexOf(m)).filter((i) => i >= 0);
  if (cuts.length > 0) subtitle = subtitle.substring(0, Math.min(...cuts));
  const words = toWords(subtitle);
  const requestNumbers = new Set([...subtitleWords].map(numberOf).filter((n) => n !== null));
  if (words.some((w) => { const n = numberOf(w); return n !== null && !requestNumbers.has(n); })) return false;
  const named = words.filter((w) => !isPositionWord(w));
  return named.length > 0 && named.filter((w) => subtitleWords.has(w)).length / named.length >= 0.5;
}

// ========== G4b: a one-word title must start a name element ==========

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
  leadingWords: string[];       // the request's stop words right before the word ("the" in "The Martian")
  characterReplacements?: Record<string, string>;
}

/** How a release name separates its words, read from the raw name */
const WORD_DELIMITERS: [string, RegExp][] = [
  [' ', /[\p{L}\p{N}] +[\p{L}\p{N}]/u],
  ['.', /\p{L}\.[\p{L}\p{N}]|\p{N}\.\p{L}/u],
  ['_', /[\p{L}\p{N}]_[\p{L}\p{N}]/u],
];
/** A bare - . or _ between two words separates name elements only when the name also uses one of these */
const OTHER_DELIMITERS: Record<string, string[]> = { '-': [' ', '.', '_'], '.': [' ', '_'], '_': [' ', '.'] };
const HARD_SEPARATOR_RE = /[:\])}—–]/;
const SOFT_SEPARATOR_RE = /[-._]/;

const isSeparatorGap = (gap: string, delimiters: Set<string>): boolean => {
  if (HARD_SEPARATOR_RE.test(gap)) return true;
  if (!SOFT_SEPARATOR_RE.test(gap)) return false;
  // A spaced or combined mark (" - ", ". ", "_-_") always separates; a bare one only beside another delimiter
  return gap.length > 1 || OTHER_DELIMITERS[gap].some((d) => delimiters.has(d));
};

/** True when the tokens end with an author: full, glued, surname, surname first, or collapsed initials */
const endsWithAuthor = (tokens: string[], authors: string[]): boolean => {
  const before = tokens.join(' ');
  return authors.some((author) => {
    if (!author) return false;
    if (hasUnspacedScript(author)) return before.endsWith(author);
    const words = author.split(' ');
    const forms = nameForms(author);
    if (words.length >= 2) forms.push(words[words.length - 1], `${words[words.length - 1]} ${words[0]}`);
    if (forms.some((form) => new RegExp(`(?:^| )${escapeRe(form)}(?:'s|s| s)?$`, 'u').test(before))) return true;
    return ` ${collapseInitials(before)}`.endsWith(` ${collapseInitials(author)}`);
  });
};

/**
 * G4b, left boundary only: some occurrence of the word starts a name element. The request's own
 * stop words right before it are skipped; then it must be the first word, follow a separator
 * (- : ] ) . _ — –, see isSeparatorGap) or follow an author name. Nothing after the word is read.
 *   "Stephen King - It Grows on You" for "It": true (let through, scored as on main)
 *   "You Like It Darker", "Frank Herbert - Children of Dune": false
 */
export function shortTitleStandsAlone(release: string, ctx: ShortTitleContext): boolean {
  const { tokens, gaps } = tokenize(release, ctx.characterReplacements);
  const delimiters = new Set(WORD_DELIMITERS.filter(([, re]) => re.test(release)).map(([d]) => d));
  const leading = new Set(ctx.leadingWords);
  return tokens.some((token, i) => {
    if (token !== ctx.word) return false;
    let j = i;
    while (j > 0 && leading.has(tokens[j - 1])) j--;
    return j === 0 || gaps.slice(j, i + 1).some((gap) => isSeparatorGap(gap, delimiters)) ||
      DIGITS_RE.test(tokens[j - 1]) || VOLUME_TOKEN_RE.test(tokens[j - 1]) ||
      endsWithAuthor(tokens.slice(0, j), ctx.authors);
  });
}

// ========== G4c: volume conflict ==========

/** A volume range ("Book 1-7", "T1-T3", "1 to 3"); read as the set of positions it holds */
const RANGE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])((?:${POSITION_WORDS.join('|')})\\.?\\s*)?0*(\\d{1,3})\\s*(?:[-–—]|to)\\s*` +
  `(?:(?:${POSITION_WORDS.join('|')})\\.?\\s*)?0*(\\d{1,3})(?![\\p{N}])`, 'giu');
const RANGE_TOKEN_RE = /^(\d{1,3})to(\d{1,3})$/;
/** A bare number followed by one of these is a size, length or bitrate, not a position */
const UNIT_RE = /^(?:kbps|kbs|kb|k|khz|bit|bits|hrs?|hours?|h|mins?|cds?|discs?|parts?|tracks?|books|mb|gb)$/;

/** Tokens for position reading: "#12" reads as "book 12", a range as one "NtoM" token */
const positionTokens = (text: string, characterReplacements?: Record<string, string>): string[] =>
  normalizeForMatching(
    text.replace(/#\s*(?=\d)/g, ' book ').replace(RANGE_RE, (m, word: string | undefined, a: string, b: string) =>
      Number(b) > Number(a) ? ` ${word ? 'book ' : ''}${Number(a)}to${Number(b)} ` : m),
    characterReplacements,
  ).split(' ').filter(Boolean);

/** The positions a number token names: "03" → [3], "1to7" → [1..7] */
function numberValues(token: string | undefined): string[] | null {
  if (!token) return null;
  if (/^\d{1,3}$/.test(token)) return [stripZeros(token)];
  const range = RANGE_TOKEN_RE.exec(token);
  if (!range) return null;
  const values: string[] = [];
  for (let n = Number(range[1]); n <= Number(range[2]); n++) values.push(String(n));
  return values;
}

/** The positions named at token i ("t03", "book 2", "vol 1to3"; with bare, also "2") and the tokens spanned */
function positionAt(tokens: string[], i: number, bare = false): { values: string[]; span: number } | null {
  const glued = POSITION_TOKEN_RE.exec(tokens[i] ?? '');
  if (glued) return { values: [stripZeros(glued[1])], span: 1 };
  if (POSITION_WORD_SET.has(tokens[i])) {
    const values = numberValues(tokens[i + 1]);
    if (values) return { values, span: 2 };
  }
  if (bare && !UNIT_RE.test(tokens[i + 1] ?? '')) {
    const values = numberValues(tokens[i]);
    if (values) return { values, span: 1 };
  }
  return null;
}

/**
 * G4c: true when the request names exactly one series position and the release names others only.
 * Read right after the request's title or series name (explicit markers), and right after the series
 * name that precedes the request's position or after a request subtitle word (bare numbers too).
 * #330 owns the full series-number check.
 *   "Dungeon Crawler Carl (book 1)" vs "Dungeon Crawler Carl, T03 …" → true
 *   "Divergent (Divergent Trilogy, Book 1)" vs "Divergent Trilogy 2 - Insurgent" → true
 *   "Guards! Guards! (Discworld, Book 8)" vs "Discworld 08 - City Watch Book 1 - Guards! Guards!" → false
 */
export function volumeConflict(title: string, release: string, stopWords: string[], characterReplacements?: Record<string, string>): boolean {
  const stop = new Set(stopWords);
  const wanted = new Set<string>();
  const anchors: { words: string[]; series: boolean }[] = [];
  const subtitleWords = new Set<string>();
  const marked = title.toLowerCase().replace(FULLWIDTH_RE, fromFullwidth).replace(SPLIT_NUMBER_RE, ' book $1');
  marked.split(/[()[\]{}【】:]/).forEach((segment, index) => {
    const tokens = positionTokens(segment, characterReplacements);
    if (index > 0) tokens.filter((w) => !stop.has(w) && !isPositionWord(w) && !RANGE_TOKEN_RE.test(w)).forEach((w) => subtitleWords.add(w));
    let start = 0;
    for (let i = 0; i < tokens.length; i++) {
      const position = positionAt(tokens, i);
      if (!position) continue;
      position.values.forEach((value) => wanted.add(value));
      if (i > start) anchors.push({ words: tokens.slice(start, i), series: true });
      start = i + position.span;
      i = start - 1;
    }
    if (start < tokens.length) anchors.push({ words: tokens.slice(start), series: false });
  });
  if (wanted.size !== 1) return false;

  const releaseTokens = positionTokens(release, characterReplacements);
  const named = new Set<string>();
  const read = (at: number, bare: boolean) => positionAt(releaseTokens, at, bare)?.values.forEach((v) => named.add(v));
  for (const anchor of anchors.filter((a) => a.words.some((w) => !stop.has(w)))) {
    for (let i = 0; i + anchor.words.length <= releaseTokens.length; i++) {
      if (anchor.words.every((word, n) => releaseTokens[i + n] === word)) read(i + anchor.words.length, anchor.series);
    }
  }
  releaseTokens.forEach((token, i) => { if (subtitleWords.has(token)) read(i + 1, true); });
  return named.size > 0 && ![...wanted].some((value) => named.has(value));
}
