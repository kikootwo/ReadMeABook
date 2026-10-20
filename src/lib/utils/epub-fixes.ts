/**
 * Component: EPUB Kindle Compatibility Fixes (content transforms)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * The four fixes fixEpubForKindle (epub-fixer.ts) applies to EPUB entries:
 * encoding declaration, body ID links, dc:language, stray <img> tags.
 */

import * as cheerio from 'cheerio';

/**
 * Amazon KDP approved language codes
 * Source: https://kdp.amazon.com/en_US/help/topic/G200673300
 */
const AMAZON_APPROVED_LANGUAGES: Set<string> = new Set([
  // ISO 639-1 codes (2-letter)
  'af', 'sq', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bs', 'br', 'bg', 'ca',
  'zh', 'hr', 'cs', 'da', 'nl', 'en', 'eo', 'et', 'fo', 'fi', 'fr', 'fy',
  'gl', 'ka', 'de', 'el', 'gu', 'he', 'hi', 'hu', 'is', 'id', 'ga', 'it',
  'ja', 'kn', 'kk', 'ko', 'ku', 'ky', 'la', 'lv', 'lt', 'lb', 'mk', 'ms',
  'ml', 'mt', 'mr', 'mn', 'ne', 'no', 'nb', 'nn', 'oc', 'or', 'ps', 'fa',
  'pl', 'pt', 'pa', 'rm', 'ro', 'ru', 'gd', 'sr', 'sk', 'sl', 'es', 'sw',
  'sv', 'tl', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'cy', 'yi',
  // ISO 639-2 codes (3-letter) commonly used
  'eng', 'fra', 'deu', 'spa', 'ita', 'por', 'rus', 'jpn', 'zho', 'kor',
  'ara', 'hin', 'nld', 'pol', 'tur', 'swe', 'dan', 'nor', 'fin', 'ces',
  // Regional variants
  'en-us', 'en-gb', 'en-au', 'en-ca', 'en-nz', 'en-ie', 'en-za',
  'pt-br', 'pt-pt', 'zh-cn', 'zh-tw', 'zh-hk', 'es-es', 'es-mx', 'es-ar',
  'fr-fr', 'fr-ca', 'de-de', 'de-at', 'de-ch', 'it-it', 'nl-nl', 'nl-be',
]);

/**
 * Fix 1: Add UTF-8 XML encoding declaration if missing
 *
 * Many EPUBs lack the XML declaration, which can cause Kindle import issues.
 * Adds: <?xml version="1.0" encoding="utf-8"?>
 */
export function fixEncoding(content: string): { content: string; modified: boolean } {
  // Check if already has XML declaration
  const xmlDeclRegex = /^\s*<\?xml[^?]*\?>/i;

  if (xmlDeclRegex.test(content)) {
    // Already has declaration, check if it has encoding
    const hasEncoding = /encoding\s*=\s*["'][^"']+["']/i.test(content);
    if (hasEncoding) {
      return { content, modified: false };
    }

    // Has declaration but no encoding - add encoding attribute
    const updatedContent = content.replace(
      /(<\?xml[^?]*?)(\?>)/i,
      '$1 encoding="utf-8"$2'
    );
    return { content: updatedContent, modified: true };
  }

  // No declaration - add one at the beginning
  const declaration = '<?xml version="1.0" encoding="utf-8"?>\n';
  return { content: declaration + content.trimStart(), modified: true };
}

/**
 * Fix 2: Remove body ID fragments from hyperlinks
 *
 * Links like "file.html#body" or "file.xhtml#bodymatter" can break on Kindle.
 * This removes the fragment when it targets body-related IDs.
 */
export function fixBodyIdLinks(content: string): { content: string; modified: boolean; count: number } {
  // Pattern to match href attributes with body-related ID fragments
  // Matches: href="file.html#body", href="page.xhtml#bodymatter", etc.
  const bodyIdPattern = /href\s*=\s*["']([^"'#]+)#(body[^"']*|bodymatter)["']/gi;

  let count = 0;
  const updatedContent = content.replace(bodyIdPattern, (match, file) => {
    count++;
    return `href="${file}"`;
  });

  return {
    content: updatedContent,
    modified: count > 0,
    count,
  };
}

/**
 * Fix 3: Validate and fix dc:language in OPF metadata
 *
 * Ensures the language tag is one approved by Amazon KDP.
 * If invalid or missing, defaults to "en" (English).
 */
export function fixLanguage(opfContent: string): {
  content: string;
  modified: boolean;
  originalLang: string;
  newLang: string;
} {
  const result = {
    content: opfContent,
    modified: false,
    originalLang: '',
    newLang: '',
  };

  // Parse with cheerio (XML mode)
  const $ = cheerio.load(opfContent, { xmlMode: true });

  // Find dc:language element (handle namespace variations)
  let langElement = $('dc\\:language, language');

  if (langElement.length === 0) {
    // No language tag found - add one
    // Find the metadata element to insert into
    const metadata = $('metadata');
    if (metadata.length > 0) {
      // Add language element
      metadata.append('\n    <dc:language>en</dc:language>');
      result.content = $.xml();
      result.modified = true;
      result.originalLang = '(missing)';
      result.newLang = 'en';
    }
    return result;
  }

  // Get current language value
  const currentLang = langElement.first().text().trim().toLowerCase();
  result.originalLang = currentLang;

  // Check if it's a valid Amazon language
  if (isValidAmazonLanguage(currentLang)) {
    return result; // No fix needed
  }

  // Try to normalize the language
  const normalizedLang = normalizeLanguage(currentLang);

  if (normalizedLang !== currentLang) {
    langElement.first().text(normalizedLang);
    result.content = $.xml();
    result.modified = true;
    result.newLang = normalizedLang;
  }

  return result;
}

/**
 * Check if a language code is approved by Amazon KDP
 */
function isValidAmazonLanguage(lang: string): boolean {
  const normalized = lang.toLowerCase().trim();

  // Direct match
  if (AMAZON_APPROVED_LANGUAGES.has(normalized)) {
    return true;
  }

  // Check base language (e.g., "en-us" -> "en")
  const baseLang = normalized.split('-')[0];
  return AMAZON_APPROVED_LANGUAGES.has(baseLang);
}

/**
 * Normalize a language code to an Amazon-approved format
 */
function normalizeLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();

  // If already valid, return as-is
  if (isValidAmazonLanguage(normalized)) {
    return normalized;
  }

  // Try base language
  const baseLang = normalized.split('-')[0];
  if (AMAZON_APPROVED_LANGUAGES.has(baseLang)) {
    return baseLang;
  }

  // Common mappings for non-standard codes
  const mappings: Record<string, string> = {
    'english': 'en',
    'french': 'fr',
    'german': 'de',
    'spanish': 'es',
    'italian': 'it',
    'portuguese': 'pt',
    'russian': 'ru',
    'japanese': 'ja',
    'chinese': 'zh',
    'korean': 'ko',
    'dutch': 'nl',
    'polish': 'pl',
    'swedish': 'sv',
    'danish': 'da',
    'norwegian': 'no',
    'finnish': 'fi',
    'und': 'en', // "undetermined" -> default to English
    'mul': 'en', // "multiple" -> default to English
    '': 'en',    // empty -> default to English
  };

  return mappings[normalized] || 'en';
}

/**
 * Fix 4: Remove stray IMG tags without src attributes
 *
 * IMG tags without src attributes can cause Kindle import failures.
 */
export function fixStrayImages(content: string): { content: string; modified: boolean; count: number } {
  // Parse with cheerio
  const $ = cheerio.load(content, { xmlMode: true });

  let count = 0;

  // Find all img tags
  $('img').each((_, element) => {
    const $img = $(element);
    const src = $img.attr('src');

    // Remove if src is missing or empty
    if (!src || src.trim() === '') {
      $img.remove();
      count++;
    }
  });

  if (count > 0) {
    return {
      content: $.xml(),
      modified: true,
      count,
    };
  }

  return { content, modified: false, count: 0 };
}
