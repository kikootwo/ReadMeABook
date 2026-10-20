/**
 * Component: Audible Language Filter Toggle
 * Documentation: documentation/settings-pages.md
 */

import { Settings } from '../../lib/types';

interface AudibleLanguageFilterOptionProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

export function AudibleLanguageFilterOption({ settings, onChange }: AudibleLanguageFilterOptionProps) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={settings.audibleLanguageFilter}
        onChange={(e) => onChange({ ...settings, audibleLanguageFilter: e.target.checked })}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
      />
      <div className="flex-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Only show books in the region&apos;s language
        </span>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Hides editions that are not in the region&apos;s language from search, BookDate and shelf
          sync. Books with no language listed are kept.
        </p>
      </div>
    </label>
  );
}
