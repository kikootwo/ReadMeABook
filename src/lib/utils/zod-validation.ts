/**
 * Component: Request Validation Helpers (zod)
 * Documentation: documentation/backend/validation.md
 *
 * Input-bounds helpers shared by API route schemas and their error handling:
 * - boundedArray: checks an array's length before any element is parsed
 * - zodIssueDetails: the capped issue list returned to the client as `details`
 * - errorForLog: a short log string (ZodError: issue count + first paths)
 */

import { z } from 'zod';

/** Max issues returned to the client in a validation error response. */
export const MAX_VALIDATION_ISSUES = 20;

/** Issue paths included in a validation log line. */
const LOGGED_ISSUE_PATHS = 3;

/** Max characters of one issue path in a log line. */
const MAX_LOGGED_PATH_LENGTH = 100;

export interface BoundedArrayOptions {
  /** Minimum length, checked together with the maximum before element parsing. */
  min?: number;
}

/**
 * Array schema whose length bounds are checked before any element is visited.
 * An out-of-bounds array yields one length issue (same code, shape and default
 * message as `z.array().max()` / `.min()`) and no element issues; an in-bounds
 * array or a non-array parses exactly like `z.array(element)`.
 */
export function boundedArray<T extends z.ZodTypeAny>(
  element: T,
  max: number,
  options: BoundedArrayOptions = {}
) {
  const { min } = options;
  // Reads only `length`; a dirty result stops the pipe before z.array runs
  const lengthCheck = z.unknown().superRefine((value, ctx) => {
    if (!Array.isArray(value)) return;
    if (min !== undefined && value.length < min) {
      ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: min, type: 'array', inclusive: true, exact: false });
    } else if (value.length > max) {
      ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: max, type: 'array', inclusive: true, exact: false });
    }
  });
  return lengthCheck.pipe(z.array(element));
}

/** The issues returned to the client as `details`, capped at MAX_VALIDATION_ISSUES. */
export function zodIssueDetails(error: z.ZodError): z.ZodIssue[] {
  return error.issues.slice(0, MAX_VALIDATION_ISSUES);
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
