/**
 * Component: Audible Language Filter (admin setting, #259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * Lists filter through partitionByLanguage (language-config.ts). This module reads the
 * setting and holds the stricter rule for callers that turn one search into one book.
 */

import { getConfigService } from '../services/config.service';
import { RMABLogger } from '../utils/logger';
import { isAcceptedLanguage, LANGUAGE_CONFIGS, type SupportedLanguage } from '../constants/language-config';
import { matchShare } from './audible-series-rank';
import type { AudibleAudiobook } from './audible.service';

const logger = RMABLogger.create('Audible.LanguageFilter');

/** Present on a result only while the filter is on */
export interface LanguageFilterInfo {
  language: SupportedLanguage;
  /** Items on this page in another language, left out */
  hiddenCount: number;
}

/** search()'s form: also whether the page's first product was hidden */
export interface SearchLanguageFilterInfo extends LanguageFilterInfo {
  firstResultHidden: boolean;
}

/** Share of the requested title's words a single-pick match must hold (bulk import's bar) */
export const SINGLE_PICK_TITLE_SHARE = 0.8;

/** The setting, read per call (60 s config cache). A failed read counts as off. */
export async function isLanguageFilterOn(): Promise<boolean> {
  try {
    return await getConfigService().getAudibleLanguageFilter();
  } catch (error) {
    logger.warn(`Language filter setting unreadable, treating it as off: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * The book a search stands for, for BookDate and shelf sync. Off, or on with the page's
 * first product in the region's language or listing none: the first result, as before.
 * On with the first product in another language: the first later result whose language
 * is explicitly the region's (no-language products are mostly podcasts) and whose title
 * and subtitle hold at least 80% of the requested title's words (a trailing
 * parenthetical group such as "(Series, #1)" left out). Otherwise none.
 */
export function pickSearchMatch(
  search: { results: AudibleAudiobook[]; languageFilter?: SearchLanguageFilterInfo },
  requestedTitle: string,
): AudibleAudiobook | undefined {
  if (!search.languageFilter?.firstResultHidden) return search.results[0];
  const langConfig = LANGUAGE_CONFIGS[search.languageFilter.language];
  const title = requestedTitle.replace(/\s*\([^()]*\)\s*$/, '').trim() || requestedTitle;
  return search.results.find(
    (book) =>
      !!book.language &&
      isAcceptedLanguage(book.language, langConfig) &&
      matchShare(`${book.title} ${book.subtitle ?? ''}`, title, langConfig) >= SINGLE_PICK_TITLE_SHARE,
  );
}
