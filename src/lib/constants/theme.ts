/**
 * Component: Theme Choice Constants
 * Documentation: documentation/frontend/components.md
 *
 * The one place for the theme storage key and the three choices. globals.css matches
 * THEME_ATTRIBUTE and the "light" / "dark" values by hand (CSS can't import them).
 */

/** localStorage key holding the explicit choice; absent means System */
export const THEME_STORAGE_KEY = 'theme';

/** Attribute on <html> carrying an explicit choice; absent means System */
export const THEME_ATTRIBUTE = 'data-theme';

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Follows the device setting; never stored, never set on <html> */
export const DEFAULT_THEME_CHOICE: ThemeChoice = 'system';

/** Choices that are stored and set on <html> (everything but System) */
export const EXPLICIT_THEME_CHOICES: readonly ThemeChoice[] = THEME_CHOICES.filter(
  (choice) => choice !== DEFAULT_THEME_CHOICE
);
