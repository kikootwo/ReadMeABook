# Request Validation (zod)

**Status:** ✅ Implemented | Shared input-bounds helpers for API route schemas and validation errors

## Overview
API routes validate JSON bodies with zod (v3) schemas. `src/lib/utils/zod-validation.ts` holds the shared helpers for array bounds, the `details` returned on a validation error, and the log line.

## Key Details
- **Arrays:** use `boundedArray(element, max, { min? })`, not `z.array(element).max(n)`. A pre-check reads only the array's `length` before any element is visited: out-of-bounds gives one `too_big`/`too_small` issue at the array's path (same shape and default message as `z.array().max()`/`.min()`); in-bounds arrays and non-arrays parse exactly like `z.array(element)` (same issue paths/messages). Every array in a request schema needs a max.
- **Response:** `details: zodIssueDetails(error)` — same issue objects, first `MAX_VALIDATION_ISSUES` (20). Don't return `error.errors`/`error.issues` directly.
- **Logging:** `logger.error(msg, { error: errorForLog(error) })` — ZodError → `Validation failed: <n> issue(s) at <path>, <path>, <path>, ...` (paths truncated to 100 chars); other errors → `error.message`. Never log a ZodError's `message`.
- **Short message field:** `message: error.issues[0]?.message` where a route surfaces one line (Goodreads shelves).

## Example
```ts
const Body = z.object({ ids: boundedArray(z.string(), 50, { min: 1 }) });
// catch (error) {
logger.error('Failed to save', { error: errorForLog(error) });
if (error instanceof z.ZodError) {
  return NextResponse.json({ error: 'ValidationError', details: zodIssueDetails(error) }, { status: 400 });
}
```

## Related: [backend/services/logging.md](services/logging.md)
