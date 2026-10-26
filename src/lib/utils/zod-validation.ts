/**
 * Component: Request Validation Helpers (zod)
 * Documentation: documentation/backend/validation.md
 *
 * Input-bounds helpers shared by API route schemas and their error handling:
 * - boundedArray: checks an array's length before any element is parsed (optionally removes duplicates)
 * - zodIssueDetails: the capped issue list returned to the client as `details` (allowlisted fields only)
 * - errorForLog: a short log string (ZodError: issue count + first paths)
 */

import { z } from 'zod';

/** Max issues returned to the client in a validation error response. */
export const MAX_VALIDATION_ISSUES = 20;

/** Issue paths included in a validation log line. */
const LOGGED_ISSUE_PATHS = 3;

/** Max characters of one issue path in a log line. */
const MAX_LOGGED_PATH_LENGTH = 100;

/** Max characters of an issue's `message` in `details` (messages are schema-built text). */
const MAX_DETAIL_MESSAGE_LENGTH = 500;

/**
 * Issue fields copied into `details` besides code/path/message. They describe the schema's
 * constraint, never the request value; any other field (e.g. `input`) is left out.
 */
const DETAIL_CONSTRAINT_KEYS = ['origin', 'minimum', 'maximum', 'inclusive', 'expected', 'format', 'values'] as const;

/** One issue as returned to the client in `details`. */
export type ValidationIssueDetail = {
  code: string;
  path: PropertyKey[];
  message: string;
} & Partial<Record<(typeof DETAIL_CONSTRAINT_KEYS)[number], unknown>>;

export interface BoundedArrayOptions {
  /** Minimum length, checked together with the maximum before element parsing. */
  min?: number;
  /** Remove duplicate elements from the parsed array (the length check still applies to the input). */
  unique?: boolean;
}

/**
 * Array schema whose length bounds are checked before any element is visited.
 * An out-of-bounds array yields one length issue (same code, fields and default
 * message as `z.array().max()` / `.min()`) and no element issues; an in-bounds
 * array or a non-array parses exactly like `z.array(element)`.
 * The length issue aborts parsing, so refinements on a parent schema don't run on
 * the out-of-bounds input.
 */
export function boundedArray<T extends z.ZodType>(
  element: T,
  max: number,
  options: BoundedArrayOptions = {}
) {
  const { min, unique } = options;
  // Reads only `length`; an aborting issue stops the pipe before z.array runs
  const lengthCheck = z.unknown().superRefine((value, ctx) => {
    if (!Array.isArray(value)) return;
    if (min !== undefined && value.length < min) {
      ctx.addIssue({ code: 'too_small', origin: 'array', minimum: min, inclusive: true, continue: false });
    } else if (value.length > max) {
      ctx.addIssue({ code: 'too_big', origin: 'array', maximum: max, inclusive: true, continue: false });
    }
  });
  const list = z.array(element);
  return lengthCheck.pipe(unique ? list.transform((items) => [...new Set(items)]) : list);
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** A value that JSON can carry as-is: a string, finite number or boolean (or an array of them). */
function isPlainValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isPlainValue);
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** One issue as returned to the client: code, path, capped message and the constraint fields only. */
function detailOf(issue: z.core.$ZodIssue): ValidationIssueDetail {
  const detail: ValidationIssueDetail = {
    code: String(issue.code),
    path: [...issue.path],
    message: shorten(String(issue.message), MAX_DETAIL_MESSAGE_LENGTH),
  };
  const source = issue as unknown as Record<string, unknown>;
  for (const key of DETAIL_CONSTRAINT_KEYS) {
    if (key in source && isPlainValue(source[key])) detail[key] = source[key];
  }
  return detail;
}

/**
 * The issues returned to the client as `details`: the first MAX_VALIDATION_ISSUES, each with its
 * code, path, message (very long messages shortened) and the schema-constraint fields listed in
 * DETAIL_CONSTRAINT_KEYS. Fields that could carry request data (e.g. `input`) are never included.
 */
export function zodIssueDetails(error: z.ZodError): ValidationIssueDetail[] {
  return error.issues.slice(0, MAX_VALIDATION_ISSUES).map(detailOf);
}

/**
 * A short string for logging a caught error.
 * ZodError: the issue count and the first few issue paths (never the full message).
 * Other errors: the error message.
 */
export function errorForLog(error: unknown): string {
  if (error instanceof z.ZodError) {
    const count = error.issues.length;
    const paths = error.issues.slice(0, LOGGED_ISSUE_PATHS).map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return path.length > MAX_LOGGED_PATH_LENGTH ? `${path.slice(0, MAX_LOGGED_PATH_LENGTH)}...` : path;
    });
    if (paths.length === 0) return `Validation failed: ${count} issue(s)`;
    const more = count > LOGGED_ISSUE_PATHS ? ', ...' : '';
    return `Validation failed: ${count} issue(s) at ${paths.join(', ')}${more}`;
  }
  return error instanceof Error ? error.message : String(error);
}
