/**
 * Component: Theme Choice Helpers (pre-paint script, read, apply, subscribe)
 * Documentation: documentation/frontend/components.md
 *
 * The applied choice lives on <html> as THEME_ATTRIBUTE (absent = System) and is stored in
 * localStorage. Storage that is missing, blocked or failing falls back to System silently.
 */

import {
  DEFAULT_THEME_CHOICE,
  EXPLICIT_THEME_CHOICES,
  THEME_ATTRIBUTE,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from '@/lib/constants/theme';

/** A stored or attribute value as a choice; anything unknown is System. */
export function parseThemeChoice(value: unknown): ThemeChoice {
  return (THEME_CHOICES as readonly unknown[]).includes(value) ? (value as ThemeChoice) : DEFAULT_THEME_CHOICE;
}

/**
 * Inline <head> script: applies the stored choice to <html> before first paint, and again when
 * another tab changes it. Self-contained (runs before any bundle); the ids come from the constants.
 */
export const THEME_INIT_SCRIPT = `(function(w,d){var k=${JSON.stringify(THEME_STORAGE_KEY)},a=${JSON.stringify(
  THEME_ATTRIBUTE
)},v=${JSON.stringify(EXPLICIT_THEME_CHOICES)};function s(){var c=null;try{c=w.localStorage.getItem(k)}catch(e){}if(v.indexOf(c)>-1){d.documentElement.setAttribute(a,c)}else{d.documentElement.removeAttribute(a)}}s();try{w.addEventListener("storage",function(e){if(e.key===k||e.key===null)s()})}catch(e){}})(window,document);`;

/** The choice currently applied to the page. */
export function readAppliedThemeChoice(): ThemeChoice {
  return parseThemeChoice(document.documentElement.getAttribute(THEME_ATTRIBUTE));
}

/** Apply a choice at once and remember it for this browser (System removes the stored value). */
export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  const explicit = choice !== DEFAULT_THEME_CHOICE;
  if (explicit) root.setAttribute(THEME_ATTRIBUTE, choice);
  else root.removeAttribute(THEME_ATTRIBUTE);
  try {
    if (explicit) window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    else window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage blocked or full: the choice still applies to this page.
  }
}

/** Calls onChange whenever the applied choice changes (this tab or, via the init script, another). */
export function subscribeToThemeChoice(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] });
  return () => observer.disconnect();
}
