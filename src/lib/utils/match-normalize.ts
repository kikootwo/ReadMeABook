/**
 * Component: Match Text Normalizer (ranking title/author matching)
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

/** Latin letters with no canonical decomposition, folded to their usual ASCII spelling */
const LATIN_FOLDS: Record<string, string> = {
  'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ħ': 'h',
};
const LATIN_FOLD_RE = /[øæœßłđðþıħ]/g;
/** Emoji presentation selectors and the keycap mark: they style a symbol and are not part of a word */
const EMOJI_SELECTOR_RE = /[\uFE00-\uFE0F\u20E3\u{E0100}-\u{E01EF}]/gu;
/** Fullwidth forms of printable ASCII (common in CJK release names) */
export const FULLWIDTH_RE = /[\uFF01-\uFF5E]/g;
/** Replacer for FULLWIDTH_RE: the ASCII character a fullwidth form stands for */
export const fromFullwidth = (c: string): string => String.fromCharCode(c.charCodeAt(0) - 0xfee0);
/** Anything that is not a letter, mark, digit or whitespace, in any script */
const NON_WORD_RE = /[^\p{L}\p{M}\p{N}\s]/gu;
/** Typographic apostrophes: left and right single quotation marks, single high-reversed-9 */
const TYPOGRAPHIC_APOSTROPHE_RE = /[\u2018\u2019\u201B]/g;
/** An apostrophe before an English ending (possessive or contraction): Ender's, don't, we'll, 90's */
const ENDING_APOSTROPHE_RE = /(?<=[\p{L}\p{M}\p{N}])'(?=(?:s|t|d|m|ll|re|ve)(?![\p{L}\p{M}\p{N}]))/giu;
/** A word with an apostrophe (any form, fullwidth too) before an English ending, in raw text: stem, ending */
const ENDING_WORD_RE = /([\p{L}\p{M}\p{N}]+)['\u2018\u2019\u201B\uFF07](s|t|d|m|ll|re|ve)(?![\p{L}\p{M}\p{N}])/giu;
/**
 * Stands in for a release apostrophe the request does not have (keepUnrequestedApostrophes):
 * U+A78C, a Latin letter shaped like an apostrophe, so every normalization keeps the word whole
 */
export const KEPT_APOSTROPHE = '\uA78C';
/** A letter in any script other than Latin */
const NON_LATIN_LETTER_RE = /(?!\p{sc=Latin})\p{L}/u;
/**
 * Scripts written without spaces between words. Script_Extensions also covers the
 * characters these scripts share, such as the katakana long-vowel mark in "ラブストーリー".
 */
const UNSPACED = '\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Khmer}\\p{scx=Myanmar}';
const UNSPACED_RE = new RegExp(`[${UNSPACED}]`, 'u');
/** A letter of an unspaced script directly next to an ASCII letter or digit: "魔法石harry", "三体2" */
const UNSPACED_THEN_ASCII_RE = new RegExp(`([${UNSPACED}])(?=[a-z0-9])`, 'gu');
const ASCII_THEN_UNSPACED_RE = new RegExp(`([a-z0-9])(?=[${UNSPACED}])`, 'gu');

/** True when the text contains a letter from a script written without spaces (CJK, Thai and similar) */
export function hasUnspacedScript(text: string): boolean {
  return UNSPACED_RE.test(text);
}

/** True when the text contains a letter from any script other than Latin */
export function hasNonLatinLetter(text: string): boolean {
  return NON_LATIN_LETTER_RE.test(text);
}

/**
 * Fold apostrophes so a name written with one matches a name written without (#316, #466).
 * Before an English ending the apostrophe is dropped; any other apostrophe becomes a space.
 * Letter case is kept.
 *   "Ender's Game" -> "Enders Game"  (release names drop it: "Enders.Game")
 *   "L'intruse"    -> "L intruse"    (release names split it: "L.Intruse")
 */
export function foldApostrophes(text: string): string {
  return text.replace(TYPOGRAPHIC_APOSTROPHE_RE, "'").replace(ENDING_APOSTROPHE_RE, '').replace(/'/g, ' ');
}

/** The normalized word an apostrophe-ending match folds to: "Ender" + "s" -> "enders" */
const endingWord = (stem: string, ending: string, characterReplacements?: Record<string, string>): string =>
  normalizeForMatching(stem + ending, characterReplacements).split(' ').pop() ?? '';

/** Words a title writes with an apostrophe before an English ending, normalized: "Ender's Game" -> {"enders"} */
export function apostropheEndingWords(title: string, characterReplacements?: Record<string, string>): Set<string> {
  return new Set([...title.matchAll(ENDING_WORD_RE)].map((m) => endingWord(m[1], m[2], characterReplacements)).filter(Boolean));
}

/**
 * Release side of the apostrophe fold: a release word with an apostrophe ending folds only when the
 * request writes that word with one too (`requested`, from apostropheEndingWords). Any other keeps
 * its apostrophe as KEPT_APOSTROPHE, one word that matches no request word, as before #316.
 *   for "Ender's Game": "Ender's Game" -> unchanged (folds to "enders game"); "Enders.Game" matches too
 *   for "The Lovers":   "The Lover's Dictionary" -> "The Loverꞌs Dictionary" (no match on "lovers")
 */
export function keepUnrequestedApostrophes(
  release: string,
  requested: Set<string>,
  characterReplacements?: Record<string, string>,
): string {
  return release.replace(ENDING_WORD_RE, (whole, stem: string, ending: string) =>
    requested.has(endingWord(stem, ending, characterReplacements)) ? whole : `${stem}${KEPT_APOSTROPHE}${ending}`);
}

/**
 * Lowercase and fold text the way normalizeForMatching does, but keep punctuation, so
 * normalized words can be located next to markers like " - " and " [".
 *   "Jo Nesbø - Snømannen [MP3]" -> "jo nesbo - snomannen [mp3]"
 * ASCII text only lowercases, folds apostrophes (foldApostrophes) and collapses whitespace.
 */
export function foldForMatching(text: string, characterReplacements?: Record<string, string>): string {
  let result = text.toLowerCase();
  // Language-specific replacements run before the generic folds (e.g. ß -> ss)
  if (characterReplacements) {
    for (const [from, to] of Object.entries(characterReplacements)) {
      result = result.replace(new RegExp(from, 'g'), to);
    }
  }
  const folded = result
    .replace(EMOJI_SELECTOR_RE, '')
    .replace(FULLWIDTH_RE, fromFullwidth)
    // Accent fold: decompose, drop the combining diacritics block, recompose the rest (kana, Hangul)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/ς/g, 'σ')
    .replace(LATIN_FOLD_RE, (c) => LATIN_FOLDS[c]);
  // After the fullwidth fold, so a fullwidth apostrophe folds too
  return foldApostrophes(folded)
    .replace(UNSPACED_THEN_ASCII_RE, '$1 ')
    .replace(ASCII_THEN_UNSPACED_RE, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize text for matching: CamelCase and punctuation become spaces, case and
 * accents fold, letters and digits of every script survive.
 *   "Twelve.Months-Jim.Butcher" -> "twelve months jim butcher"
 *   "Café"                       -> "cafe"
 *   "Война и мир"                -> "воина и мир" (й folds like a Latin accent)
 */
export function normalizeForMatching(text: string, characterReplacements?: Record<string, string>): string {
  // Split ASCII CamelCase before lowercasing: "TheCorrespondent" -> "The Correspondent"
  return foldForMatching(text.replace(/([a-z])([A-Z])/g, '$1 $2'), characterReplacements)
    // Underscores and every other non-word character become spaces (apostrophes are already folded)
    .replace(/_/g, ' ')
    .replace(NON_WORD_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when a normalized word appears in a normalized title. Words of two or more
 * characters in scripts without spaces (CJK, Thai and similar) match as substrings;
 * all other words, including a single CJK character, must be a whole word of the title.
 */
export function isWordInTitle(word: string, titleWords: string[], normalizedTitle: string): boolean {
  if (hasUnspacedScript(word) && Array.from(word).length > 1) {
    return normalizedTitle.includes(word);
  }
  return titleWords.includes(word);
}
