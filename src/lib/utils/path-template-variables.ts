/**
 * Component: Path Template Variables
 * Documentation: documentation/phase3/file-organization.md
 *
 * Values for the path template engine (path-template.util.ts), including the
 * derived {primaryAuthor}. The Paths settings tab bundles this for the browser,
 * so it must not import node modules.
 */

import type { TemplateVariables } from './path-template.util';

/** Author list separators: the set deduplicateNames splits on (bulk-import-scanner.ts) */
const AUTHOR_SEPARATORS = /[,;&]/;

/**
 * {primaryAuthor}: the first entry of the author list that is still non-empty
 * after sanitizing, so "?, Bob" gives "Bob". "and" does not split a name; a
 * comma always does ("Martin Luther King, Jr." gives "Martin Luther King").
 * Returns '' when no entry is left, which the engine treats as an empty value.
 */
export function primaryAuthorOf(
  author: string | undefined,
  sanitize: (value: string) => string
): string {
  for (const entry of (author ?? '').split(AUTHOR_SEPARATORS)) {
    const name = entry.trim();
    if (sanitize(name) !== '') {
      return name;
    }
  }
  return '';
}

/**
 * The raw value of a template variable by name, including derived variables.
 * The engine trims and sanitizes it as it does for every variable.
 */
export function variableValue(
  variables: TemplateVariables,
  name: string,
  sanitize: (value: string) => string
): TemplateVariables[keyof TemplateVariables] {
  if (name === 'primaryAuthor') {
    return primaryAuthorOf(variables.author, sanitize);
  }
  return variables[name as keyof TemplateVariables];
}
