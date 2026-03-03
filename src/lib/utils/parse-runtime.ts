/**
 * Component: Runtime Parsing Utility
 * Documentation: documentation/integrations/audible.md
 *
 * Shared runtime/duration text parser extracted from AudibleService.
 * Handles all i18n patterns (English, German, Spanish, French) via
 * language-specific regex patterns in LanguageConfig.
 */

import type { LanguageConfig } from '../constants/language-config';

/**
 * Parse runtime text (e.g. "12 hrs and 30 mins", "5 Std. 20 Min.")
 * into total minutes using language-specific patterns.
 *
 * @param runtimeText - Raw runtime string from Audible HTML
 * @param langConfig  - Language configuration with hour/minute regex patterns
 * @returns Total minutes, or undefined if no duration could be parsed
 */
export function parseRuntime(runtimeText: string, langConfig: LanguageConfig): number | undefined {
  if (!runtimeText) return undefined;

  let totalMinutes = 0;

  // Try each hour pattern until one matches
  for (const pattern of langConfig.scraping.runtimeHourPatterns) {
    const match = runtimeText.match(pattern);
    if (match) {
      totalMinutes += parseInt(match[1]) * 60;
      break;
    }
  }

  // Try each minute pattern until one matches
  for (const pattern of langConfig.scraping.runtimeMinutePatterns) {
    const match = runtimeText.match(pattern);
    if (match) {
      totalMinutes += parseInt(match[1]);
      break;
    }
  }

  return totalMinutes > 0 ? totalMinutes : undefined;
}
