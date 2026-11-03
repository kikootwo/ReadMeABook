/**
 * Component: Path Template Variables
 * Documentation: documentation/phase3/file-organization.md
 *
 * Variable names, values and references for the path template engine
 * (path-template.util.ts): the derived {primaryAuthor}, the {seriesPart:00}
 * formats (#250) and the brace checks both validators share. The Paths settings
 * tab bundles this for the browser, so it must not import node modules.
 */

import type { TemplateVariables, ValidationResult } from './path-template.util';

type Sanitize = (value: string) => string;

/**
 * Supported template variable names
 */
export const VALID_VARIABLES = ['author', 'primaryAuthor', 'title', 'narrator', 'asin', 'year', 'series', 'seriesPart'];

/**
 * Invalid file path characters (outside of template variables)
 */
export const INVALID_PATH_CHARS = /[<>:"|?*]/;

/** Formats a reference can take: {seriesPart:00} pads to 2 digits, :000 to 3, :0000 to 4 */
const FORMATS: Record<string, string[]> = { seriesPart: ['00', '000', '0000'] };

const FORMAT_HELP = 'Only {seriesPart} takes a format: {seriesPart:00}, {seriesPart:000} or {seriesPart:0000}.';

/** `name` or `name:format`, longest name first, with no letter or digit on either side */
const REFERENCE = new RegExp(
  `(?<![a-zA-Z0-9])(${[...VALID_VARIABLES].sort((a, b) => b.length - a.length).join('|')})(?::([a-zA-Z0-9]+))?(?![a-zA-Z0-9])`,
  'g'
);

interface Reference {
  name: string;
  format?: string;
  start: number;
  end: number;
}

function findReferences(content: string): Reference[] {
  return [...content.matchAll(REFERENCE)].map((m) => ({
    name: m[1],
    format: m[2],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

const isSupported = (ref: Reference) =>
  ref.format !== undefined && (FORMATS[ref.name] ?? []).includes(ref.format);

const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== '';

/**
 * Find valid template variable names within arbitrary content text.
 * Sorts by length descending to prevent substring false matches
 * (e.g., 'seriesPart' matched before 'series').
 * Uses word-boundary detection to avoid matching variable names
 * that are substrings of other words.
 */
export function findVariablesInContent(content: string): string[] {
  const sortedVars = [...VALID_VARIABLES].sort((a, b) => b.length - a.length);
  const found: string[] = [];

  for (const varName of sortedVars) {
    const regex = new RegExp(`(?<![a-zA-Z0-9])${varName}(?![a-zA-Z0-9])`);
    if (regex.test(content)) {
      found.push(varName);
    }
  }

  return found;
}

/** Author list separators: the set deduplicateNames splits on (bulk-import-scanner.ts) */
const AUTHOR_SEPARATORS = /[,;&]/;

/**
 * {primaryAuthor}: the first entry of the author list that is still non-empty
 * after sanitizing, so "?, Bob" gives "Bob". "and" does not split a name; a
 * comma always does ("Martin Luther King, Jr." gives "Martin Luther King").
 * Returns '' when no entry is left, which the engine treats as an empty value.
 */
export function primaryAuthorOf(author: string | undefined, sanitize: Sanitize): string {
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
  sanitize: Sanitize
): TemplateVariables[keyof TemplateVariables] {
  if (name === 'primaryAuthor') {
    return primaryAuthorOf(variables.author, sanitize);
  }
  return variables[name as keyof TemplateVariables];
}

const NUMBER = /^\d+(?:\.\d+)?$/;
const RANGE = /^(\d+(?:\.\d+)?)(\s*-\s*)(\d+(?:\.\d+)?)$/;

/**
 * Pad the integer part of a number ("1.5") or of both ends of a range ("1-3")
 * with zeros to `width` digits, never cutting digits and keeping the separator
 * as written. Any other shape ("Book 1", "1a", "1, 2", "-1") is returned as is.
 */
export function padSeriesPart(value: string, width: number): string {
  const pad = (number: string) => number.replace(/^\d+/, (digits) => digits.padStart(width, '0'));
  if (NUMBER.test(value)) {
    return pad(value);
  }
  const range = RANGE.exec(value);
  return range ? `${pad(range[1])}${range[2]}${pad(range[3])}` : value;
}

/**
 * True when brace content uses a supported format. Only that content takes the
 * new path below; everything else resolves exactly as it did before formats.
 */
export function usesFormat(content: string): boolean {
  return findReferences(content).some(isSupported);
}

/**
 * Resolve brace content that uses a supported format: `{seriesPart:00}` or a
 * conditional block such as `{Book seriesPart:00 - }`. Empty when any variable
 * in it is empty. Otherwise each reference becomes its value (trimmed, padded,
 * then sanitized) and the rest is kept as literal text. A reference with an
 * unsupported format keeps it after the value, as the engine printed it before.
 */
export function resolveFormattedBlock(content: string, variables: TemplateVariables, sanitize: Sanitize): string {
  const refs = findReferences(content);
  if (!refs.every((ref) => hasValue(variableValue(variables, ref.name, sanitize)))) {
    return '';
  }

  let result = '';
  let last = 0;
  for (const ref of refs) {
    const value = String(variableValue(variables, ref.name, sanitize)).trim();
    const text = isSupported(ref)
      ? sanitize(padSeriesPart(value, (ref.format as string).length))
      : `${sanitize(value)}${ref.format === undefined ? '' : `:${ref.format}`}`;
    result += content.slice(last, ref.start) + text;
    last = ref.end;
  }
  return result + content.slice(last);
}

/**
 * Check every `{...}` of a template whose escaped braces are already removed,
 * for both validators. Returns the first error, or null when all are valid.
 * `noVariable` and `target` are the two parts of the messages that differ
 * between the path and filename validators.
 */
export function checkBraceContents(
  matches: string[] | null,
  noVariable: string,
  target: string
): ValidationResult | null {
  for (const match of matches ?? []) {
    const content = match.slice(1, -1); // Remove { and }

    // Simple variable: exact match to a valid variable name
    if (VALID_VARIABLES.includes(content)) {
      continue;
    }

    // A format other than the supported ones
    const unsupported = findReferences(content).find((ref) => ref.format !== undefined && !isSupported(ref));
    if (unsupported) {
      return {
        valid: false,
        error: `Unsupported format: {${unsupported.name}:${unsupported.format}}. ${FORMAT_HELP}`,
      };
    }

    // Conditional block: must contain at least one valid variable
    const foundVars = findVariablesInContent(content);
    if (foundVars.length === 0) {
      return {
        valid: false,
        error: `${noVariable} {${content}}. Valid variables are: ${VALID_VARIABLES.map(v => `{${v}}`).join(', ')}`,
      };
    }

    // Check literal text inside the block (references and their formats removed) for invalid chars
    let literalText = content;
    const sortedVars = [...foundVars].sort((a, b) => b.length - a.length);
    for (const varName of sortedVars) {
      literalText = literalText.replace(
        new RegExp(`(?<![a-zA-Z0-9])${varName}(?::[a-zA-Z0-9]+)?(?![a-zA-Z0-9])`, 'g'),
        ''
      );
    }
    const invalidCharsInBlock = literalText.match(INVALID_PATH_CHARS);
    if (invalidCharsInBlock) {
      return {
        valid: false,
        error: `Invalid characters found: ${[...new Set(invalidCharsInBlock)].join(', ')}. These characters are not allowed in ${target}.`,
      };
    }
  }

  return null;
}
