/**
 * Component: Audible Region Types
 * Documentation: documentation/integrations/audible.md
 */

export type AudibleRegion = 'us' | 'ca' | 'uk' | 'au' | 'in' | 'de' | 'es';

export interface AudibleRegionConfig {
  code: AudibleRegion;
  name: string;
  baseUrl: string;
  audnexusParam: string;
  isEnglish: boolean;
  /** Language param sent to Audible (e.g. 'english', 'german') — omit to use store default */
  languageParam?: string;
  /** Accept-Language header value for this region */
  acceptLanguage: string;
  /** Accepted content languages for filtering (e.g. ['english'] or ['deutsch', 'german']) */
  acceptedContentLanguages: string[];
  /** Localized label prefixes used in Audible HTML (for author/narrator stripping) */
  labelPrefixes: {
    author: string[];   // e.g. ['By:', 'Written by:'] or ['Von:', 'Geschrieben von:']
    narrator: string[];  // e.g. ['Narrated by:'] or ['Gesprochen von:']
    language: string[];  // e.g. ['Language:'] or ['Sprache:']
    length: string[];    // e.g. ['Length:'] or ['Dauer:', 'Laufzeit:']
    releaseDate: string[]; // e.g. ['Release date:'] or ['Erscheinungsdatum:']
  };
}

export const AUDIBLE_REGIONS: Record<AudibleRegion, AudibleRegionConfig> = {
  us: {
    code: 'us',
    name: 'United States',
    baseUrl: 'https://www.audible.com',
    audnexusParam: 'us',
    isEnglish: true,
    languageParam: 'english',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptedContentLanguages: ['english'],
    labelPrefixes: {
      author: ['By:', 'Written by:'],
      narrator: ['Narrated by:'],
      language: ['Language:'],
      length: ['Length:'],
      releaseDate: ['Release date:'],
    },
  },
  ca: {
    code: 'ca',
    name: 'Canada',
    baseUrl: 'https://www.audible.ca',
    audnexusParam: 'ca',
    isEnglish: true,
    languageParam: 'english',
    acceptLanguage: 'en-CA,en;q=0.9',
    acceptedContentLanguages: ['english'],
    labelPrefixes: {
      author: ['By:', 'Written by:'],
      narrator: ['Narrated by:'],
      language: ['Language:'],
      length: ['Length:'],
      releaseDate: ['Release date:'],
    },
  },
  uk: {
    code: 'uk',
    name: 'United Kingdom',
    baseUrl: 'https://www.audible.co.uk',
    audnexusParam: 'uk',
    isEnglish: true,
    languageParam: 'english',
    acceptLanguage: 'en-GB,en;q=0.9',
    acceptedContentLanguages: ['english'],
    labelPrefixes: {
      author: ['By:', 'Written by:'],
      narrator: ['Narrated by:'],
      language: ['Language:'],
      length: ['Length:'],
      releaseDate: ['Release date:'],
    },
  },
  au: {
    code: 'au',
    name: 'Australia',
    baseUrl: 'https://www.audible.com.au',
    audnexusParam: 'au',
    isEnglish: true,
    languageParam: 'english',
    acceptLanguage: 'en-AU,en;q=0.9',
    acceptedContentLanguages: ['english'],
    labelPrefixes: {
      author: ['By:', 'Written by:'],
      narrator: ['Narrated by:'],
      language: ['Language:'],
      length: ['Length:'],
      releaseDate: ['Release date:'],
    },
  },
  in: {
    code: 'in',
    name: 'India',
    baseUrl: 'https://www.audible.in',
    audnexusParam: 'in',
    isEnglish: true,
    languageParam: 'english',
    acceptLanguage: 'en-IN,en;q=0.9',
    acceptedContentLanguages: ['english'],
    labelPrefixes: {
      author: ['By:', 'Written by:'],
      narrator: ['Narrated by:'],
      language: ['Language:'],
      length: ['Length:'],
      releaseDate: ['Release date:'],
    },
  },
  de: {
    code: 'de',
    name: 'Germany',
    baseUrl: 'https://www.audible.de',
    audnexusParam: 'de',
    isEnglish: false,
    // No languageParam — let audible.de serve native content (German + English)
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.5',
    acceptedContentLanguages: ['deutsch', 'german', 'english', 'englisch'],
    labelPrefixes: {
      author: ['Von:', 'Geschrieben von:', 'Autor:', 'By:', 'Written by:'],
      narrator: ['Gesprochen von:', 'Sprecher:', 'Narrated by:'],
      language: ['Sprache:', 'Language:'],
      length: ['Dauer:', 'Laufzeit:', 'Länge:', 'Length:'],
      releaseDate: ['Erscheinungsdatum:', 'Veröffentlichungsdatum:', 'Release date:'],
    },
  },
  es: {
    code: 'es',
    name: 'Spain',
    baseUrl: 'https://www.audible.es',
    audnexusParam: 'es',
    isEnglish: false,
    // No languageParam — let audible.es serve native content (Spanish + English)
    acceptLanguage: 'es-ES,es;q=0.9,en;q=0.5',
    acceptedContentLanguages: ['español', 'spanish', 'castellano', 'english', 'inglés'],
    labelPrefixes: {
      author: ['De:', 'Escrito por:', 'Autor:', 'By:', 'Written by:'],
      narrator: ['Narrado por:', 'Narrated by:'],
      language: ['Idioma:', 'Language:'],
      length: ['Duración:', 'Length:'],
      releaseDate: ['Fecha de lanzamiento:', 'Release date:'],
    },
  }
};

export const DEFAULT_AUDIBLE_REGION: AudibleRegion = 'us';

/**
 * Strip all known localized label prefixes from a text string.
 * Example: "Von: Michael Ende" → "Michael Ende"
 * Example: "Gesprochen von: Rufus Beck" → "Rufus Beck"
 */
export function stripLabelPrefixes(text: string, prefixes: string[]): string {
  let result = text;
  for (const prefix of prefixes) {
    // Case-insensitive prefix stripping
    const regex = new RegExp(`^${escapeRegex(prefix)}\\s*`, 'i');
    result = result.replace(regex, '');
  }
  return result.trim();
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get the region config for a given region code.
 * Falls back to 'us' if the region is unknown.
 */
export function getRegionConfig(region: AudibleRegion): AudibleRegionConfig {
  return AUDIBLE_REGIONS[region] || AUDIBLE_REGIONS[DEFAULT_AUDIBLE_REGION];
}
