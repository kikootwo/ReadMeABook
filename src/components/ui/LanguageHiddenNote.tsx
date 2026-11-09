/**
 * Component: Language Filter Hidden Note
 * Documentation: documentation/integrations/audible-language-filter.md
 */

'use client';

/** "N in other languages hidden", under a results header while the admin language filter hides some */
export function LanguageHiddenNote({ hiddenCount }: { hiddenCount?: number }) {
  if (!hiddenCount || hiddenCount <= 0) return null;
  return (
    <p className="text-sm text-gray-500 dark:text-gray-400 px-1" data-testid="language-hidden-note">
      {hiddenCount.toLocaleString()} in other languages hidden
    </p>
  );
}
