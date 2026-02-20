/**
 * Component: Centralized Language Configuration
 * Documentation: documentation/integrations/audible.md
 *
 * Single source of truth for all language-specific configuration.
 * To add a new language:
 * 1. Add code to SupportedLanguage union
 * 2. Add full LanguageConfig entry in LANGUAGE_CONFIGS
 * 3. Map regions in REGION_LANGUAGE_MAP
 * 4. Add region to AUDIBLE_REGIONS in audible.ts with language: 'xx'
 */

import type { AudibleRegion } from '../types/audible';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedLanguage = 'en' | 'de' | 'es';

export interface ScrapingConfig {
  /** Audible locale query-param value (e.g. 'english', 'deutsch') */
  audibleLocaleParam: string;
  /** Author label prefixes to strip (e.g. ['By:', 'Written by:']) */
  authorPrefixes: string[];
  /** Narrator label prefixes to strip */
  narratorPrefixes: string[];
  /** Length / duration labels used in Cheerio :contains() selectors */
  lengthLabels: string[];
  /** Language field labels */
  languageLabels: string[];
  /** Release date field labels */
  releaseDateLabels: string[];
  /** Series label prefixes used to find series links in search results */
  seriesLabels: string[];
  /** Accepted language values for filtering (lowercase) */
  acceptedLanguageValues: string[];
  /** Regex patterns that match hour portions in runtime strings */
  runtimeHourPatterns: RegExp[];
  /** Regex patterns that match minute portions in runtime strings */
  runtimeMinutePatterns: RegExp[];
  /** Regex patterns for extracting numeric rating */
  ratingPatterns: RegExp[];
  /** Regex patterns for extracting release date text */
  releaseDatePatterns: RegExp[];
  /** Promotional / non-description text patterns to exclude */
  descriptionExcludePatterns: RegExp[];
  /** Duration detection pattern for generic element scanning */
  durationDetectionPattern: RegExp;
  /** Rating text selector pattern (e.g. 'out of 5 stars') */
  ratingTextSelector: string;
}

export interface LanguageConfig {
  code: SupportedLanguage;
  /** Anna's Archive language filter code */
  annasArchiveLang: string;
  /** EPUB language code */
  epubCode: string;
  /** Stop words for ranking algorithm (filtered from match scoring) */
  stopWords: string[];
  /** Character replacements applied before NFD normalization in ranking (e.g. ß→ss) */
  characterReplacements: Record<string, string>;
  /** All scraping-related config */
  scraping: ScrapingConfig;
}

// ---------------------------------------------------------------------------
// Language Configurations
// ---------------------------------------------------------------------------

const ENGLISH_CONFIG: LanguageConfig = {
  code: 'en',
  annasArchiveLang: 'en',
  epubCode: 'en',
  stopWords: ['the', 'a', 'an', 'of', 'on', 'in', 'at', 'by', 'for'],
  characterReplacements: {},
  scraping: {
    audibleLocaleParam: 'english',
    authorPrefixes: ['By:', 'Written by:'],
    narratorPrefixes: ['Narrated by:'],
    lengthLabels: ['Length:'],
    languageLabels: ['Language:'],
    releaseDateLabels: ['Release date:'],
    seriesLabels: ['Series:'],
    acceptedLanguageValues: ['english'],
    runtimeHourPatterns: [/(\d+)\s*hrs?/i, /(\d+)\s*hours?/i],
    runtimeMinutePatterns: [/(\d+)\s*mins?/i, /(\d+)\s*minutes?/i],
    ratingPatterns: [/(\d+\.?\d*)\s*out of/i],
    releaseDatePatterns: [/Release date:\s*(.+)/i],
    descriptionExcludePatterns: [
      /\$\d+\.\d+/,
      /cancel anytime/i,
      /free trial/i,
      /membership/i,
      /subscribe/i,
      /offer.*ends/i,
      /^\s*by\s+[\w\s,]+$/i,
    ],
    durationDetectionPattern: /\d+\s*(hr|hour|h)\s*\d*\s*(min|minute|m)?/i,
    ratingTextSelector: 'out of 5 stars',
  },
};

const GERMAN_CONFIG: LanguageConfig = {
  code: 'de',
  annasArchiveLang: 'de',
  epubCode: 'de',
  stopWords: ['der', 'die', 'das', 'ein', 'eine', 'und', 'von', 'zu', 'den', 'dem', 'des'],
  characterReplacements: { '\u00df': 'ss' },
  scraping: {
    audibleLocaleParam: 'deutsch',
    authorPrefixes: ['Von:', 'Geschrieben von:', 'Autor:'],
    narratorPrefixes: ['Gesprochen von:', 'Sprecher:'],
    lengthLabels: ['Spieldauer:', 'Dauer:', 'L\u00e4nge:'],
    languageLabels: ['Sprache:'],
    releaseDateLabels: ['Erscheinungsdatum:'],
    seriesLabels: ['Serie:', 'Reihe:'],
    acceptedLanguageValues: ['deutsch', 'german'],
    runtimeHourPatterns: [/(\d+)\s*Std\.?/i, /(\d+)\s*Stunden?/i],
    runtimeMinutePatterns: [/(\d+)\s*Min\.?/i, /(\d+)\s*Minuten?/i],
    ratingPatterns: [/(\d+[.,]?\d*)\s*von\s*5/i],
    releaseDatePatterns: [/Erscheinungsdatum:\s*(.+)/i],
    descriptionExcludePatterns: [
      /\$\d+\.\d+/,
      /\d+,\d+\s*\u20ac/,
      /jederzeit k\u00fcndbar/i,
      /kostenlos testen/i,
      /Mitgliedschaft/i,
      /abonnieren/i,
      /Angebot.*endet/i,
      /^\s*von\s+[\w\s,]+$/i,
    ],
    durationDetectionPattern: /\d+\s*(Std|Stunden?|h)\s*\.?\s*\d*\s*(Min|Minuten?|m)?/i,
    ratingTextSelector: 'von 5 Sternen',
  },
};

const SPANISH_CONFIG: LanguageConfig = {
  code: 'es',
  annasArchiveLang: 'es',
  epubCode: 'es',
  stopWords: ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'por'],
  characterReplacements: {},
  scraping: {
    audibleLocaleParam: 'espa\u00f1ol',
    authorPrefixes: ['De:', 'Escrito por:', 'Autor:'],
    narratorPrefixes: ['Narrado por:'],
    lengthLabels: ['Duraci\u00f3n:'],
    languageLabels: ['Idioma:'],
    releaseDateLabels: ['Fecha de lanzamiento:'],
    seriesLabels: ['Serie:'],
    acceptedLanguageValues: ['espa\u00f1ol', 'spanish'],
    runtimeHourPatterns: [/(\d+)\s*h\b/i, /(\d+)\s*horas?/i],
    runtimeMinutePatterns: [/(\d+)\s*min/i, /(\d+)\s*minutos?/i],
    ratingPatterns: [/(\d+[.,]?\d*)\s*de\s*5/i],
    releaseDatePatterns: [/Fecha de lanzamiento:\s*(.+)/i],
    descriptionExcludePatterns: [
      /\$\d+\.\d+/,
      /\d+,\d+\s*\u20ac/,
      /cancela cuando quieras/i,
      /prueba gratis/i,
      /suscripci\u00f3n/i,
      /suscr\u00edbete/i,
      /oferta.*termina/i,
      /^\s*de\s+[\w\s,]+$/i,
    ],
    durationDetectionPattern: /\d+\s*(h|horas?)\s*\d*\s*(min|minutos?)?/i,
    ratingTextSelector: 'de 5 estrellas',
  },
};

// ---------------------------------------------------------------------------
// Lookup Maps
// ---------------------------------------------------------------------------

export const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  en: ENGLISH_CONFIG,
  de: GERMAN_CONFIG,
  es: SPANISH_CONFIG,
};

/**
 * Maps Audible region codes to language codes.
 * All English-speaking regions map to 'en'.
 */
export const REGION_LANGUAGE_MAP: Record<AudibleRegion, SupportedLanguage> = {
  us: 'en',
  ca: 'en',
  uk: 'en',
  au: 'en',
  in: 'en',
  de: 'de',
  es: 'es',
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Get the full language configuration for an Audible region.
 */
export function getLanguageForRegion(region: AudibleRegion): LanguageConfig {
  const langCode = REGION_LANGUAGE_MAP[region];
  return LANGUAGE_CONFIGS[langCode];
}

/**
 * Strip any matching prefixes from text (case-insensitive).
 * Returns the text with the first matching prefix removed, trimmed.
 *
 * Example: stripPrefixes('By: Author Name', ['By:', 'Written by:']) => 'Author Name'
 */
export function stripPrefixes(text: string, prefixes: string[]): string {
  const trimmed = text.trim();
  for (const prefix of prefixes) {
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
}

/**
 * Build a Cheerio selector that matches any of the given labels using :contains().
 * Returns a comma-separated selector string.
 *
 * Example: buildContainsSelector('span', ['Length:', 'Dauer:'])
 *   => 'span:contains("Length:"), span:contains("Dauer:")'
 */
export function buildContainsSelector(element: string, labels: string[]): string {
  return labels.map(label => `${element}:contains("${label}")`).join(', ');
}

/**
 * Extract a value from text by trying multiple label patterns.
 * Returns the captured group from the first matching pattern, or null.
 */
export function extractByPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Check if a language value matches the accepted values for a language config.
 * Comparison is case-insensitive.
 */
export function isAcceptedLanguage(languageValue: string, config: LanguageConfig): boolean {
  const normalized = languageValue.toLowerCase().trim();
  return config.scraping.acceptedLanguageValues.includes(normalized);
}
