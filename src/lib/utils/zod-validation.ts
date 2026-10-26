/**
 * Component: Request Validation Helpers (zod)
 * Documentation: documentation/backend/validation.md
 *
 * Input-bounds helpers shared by API route schemas and their error handling:
 * - boundedArray: checks an array's length before any element is parsed (optionally removes duplicates)
 * - zodIssueDetails: the capped issue list returned to the client as `details` (long values shortened)
 * - errorForLog: a short log string (ZodError: issue count + first paths)
 */

import { z } from 'zod';

/** Max issues returned to the client in a validation error response. */
export const MAX_VALIDATION_ISSUES = 20;

/** Issue paths included in a validation log line. */
const LOGGED_ISSUE_PATHS = 3;

/** Max characters of one issue path in a log line. */
const MAX_LOGGED_PATH_LENGTH = 100;

/** Max characters of an issue's `received` string in `details`. */
const MAX_DETAIL_RECEIVED_LENGTH = 100;

/**
 * Max characters of an issue's `message` in `details`. A shortened `received` is also shortened
 * where the message repeats it (enum messages), so this only bounds schema-built text.
 */
const MAX_DETAIL_MESSAGE_LENGTH = 500;

export interface BoundedArrayOptions {
  /** Minimum length, checked together with the maximum before element parsing. */
  min?: number;
  /** Remove duplicate elements from the parsed array (the length check still applies to the input). */
  unique?: boolean;
}

/**
 * Array schema whose length bounds are checked before any element is visited.
 * An out-of-bounds array yields one length issue (same code, shape and default
 * message as `z.array().max()` / `.min()`) and no element issues; an in-bounds
 * array or a non-array parses exactly like `z.array(element)`.
 * The length issue is fatal, so refinements on a parent schema don't run on the
 * out-of-bounds input; zodIssueDetails drops the `fatal` flag from the returned issue.
 */
export function boundedArray<T extends z.ZodTypeAny>(
  element: T,
  max: number,
  options: BoundedArrayOptions = {}
) {
  const { min, unique } = options;
  // Reads only `length`; an aborted result stops the pipe before z.array runs
  const lengthCheck = z.unknown().superRefine((value, ctx) => {
    if (!Array.isArray(value)) return;
    if (min !== undefined && value.length < min) {
      ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: min, type: 'array', inclusive: true, exact: false, fatal: true });
    } else if (value.length > max) {
      ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: max, type: 'array', inclusive: true, exact: false, fatal: true });
    }
  });
  const list = z.array(element);
  return lengthCheck.pipe(unique ? list.transform((items) => [...new Set(items)]) : list);
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** One issue as returned to the client: no `fatal` flag, long `received` (and its echo in `message`) shortened. */
function detailOf(issue: z.ZodIssue): z.ZodIssue {
  const detail = { ...issue } as z.ZodIssue & { fatal?: boolean; received?: unknown };
  delete detail.fatal;
  if ('received' in detail) {
    const received = detail.received;
    if (typeof received === 'string') {
      const short = shorten(received, MAX_DETAIL_RECEIVED_LENGTH);
      if (short !== received) detail.message = detail.message.split(received).join(short);
      detail.received = short;
    } else if (received !== null && typeof received === 'object') {
      detail.received = z.getParsedType(received);
    }
  }
  detail.message = shorten(detail.message, MAX_DETAIL_MESSAGE_LENGTH);
  return detail;
}

/**
 * The issues returned to the client as `details`: the first MAX_VALIDATION_ISSUES, without the
 * internal `fatal` flag, with long `received` strings (also where the message repeats them) and
 * very long messages shortened, and object/array `received` values replaced by their type name.
 */
export function zodIssueDetails(error: z.ZodError): z.ZodIssue[] {
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
