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
/** Anything that is not a letter, mark, digit, whitespace or apostrophe, in any script */
const NON_WORD_RE = /[^\p{L}\p{M}\p{N}\s']/gu;
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
 * Lowercase and fold text the way normalizeForMatching does, but keep punctuation, so
 * normalized words can be located next to markers like " - " and " [".
 *   "Jo Nesbø - Snømannen [MP3]" -> "jo nesbo - snomannen [mp3]"
 * ASCII text only lowercases and collapses whitespace.
 */
export function foldForMatching(text: string, characterReplacements?: Record<string, string>): string {
  let result = text.toLowerCase();
  // Language-specific replacements run before the generic folds (e.g. ß -> ss)
  if (characterReplacements) {
    for (const [from, to] of Object.entries(characterReplacements)) {
      result = result.replace(new RegExp(from, 'g'), to);
    }
  }
  return result
    .replace(EMOJI_SELECTOR_RE, '')
    .replace(FULLWIDTH_RE, fromFullwidth)
    // Accent fold: decompose, drop the combining diacritics block, recompose the rest (kana, Hangul)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/ς/g, 'σ')
    .replace(LATIN_FOLD_RE, (c) => LATIN_FOLDS[c])
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
    // Underscores and every other non-word character become spaces (apostrophes stay)
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
