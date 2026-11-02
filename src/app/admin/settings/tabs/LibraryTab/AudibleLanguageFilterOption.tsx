/**
 * Component: Audible Language Filter Option (Library tab, Plex and Audiobookshelf)
 * Documentation: documentation/integrations/audible-language-filter.md
 */

import { Settings } from '../../lib/types';
import { AUDIBLE_REGIONS, DEFAULT_AUDIBLE_REGION, type AudibleRegion } from '@/lib/types/audible';
import { LANGUAGE_DISPLAY_NAMES } from '@/lib/constants/language-config';

interface AudibleLanguageFilterOptionProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

export function AudibleLanguageFilterOption({ settings, onChange }: AudibleLanguageFilterOptionProps) {
  const region = AUDIBLE_REGIONS[settings.audibleRegion as AudibleRegion] ?? AUDIBLE_REGIONS[DEFAULT_AUDIBLE_REGION];
  const language = LANGUAGE_DISPLAY_NAMES[region.language];

  return (
    <label className="flex items-start gap-3 cursor-pointer pt-2">
      <input
        type="checkbox"
        checked={!!settings.audibleLanguageFilter}
        onChange={(e) => onChange({ ...settings, audibleLanguageFilter: e.target.checked })}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
      />
      <div className="flex-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Only show books in {language}
        </span>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Search, series and the home page rows hide other-language editions and show how many
          they hid; books with no language listed still show. BookDate, shelf sync and watched
          series skip other-language editions and request nothing for them. Books matched before
          you turn this on keep their match. Bulk import and requests made from a book page are
          not affected.
        </p>
      </div>
    </label>
  );
}
