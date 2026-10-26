# Request Validation (body size limits, zod)

**Status:** ✅ Implemented | Request size limits for API route bodies; shared input-bounds helpers for zod schemas and validation errors

## Overview
API routes read JSON bodies through `readJsonBody` (`src/lib/utils/request-body.ts`), which applies a size limit, then validate them with zod (v3) schemas. `src/lib/utils/zod-validation.ts` holds the shared helpers for array bounds, the `details` returned on a validation error, and the log line.

## Request Size Limits
| Tier | Constant | Limit | Routes |
|---|---|---|---|
| Sign-in | `AUTH_JSON_BODY_LIMIT_BYTES` | 64 KB | POST auth/admin/login, auth/local/login, auth/token/login, auth/register, auth/refresh, auth/plex/switch-profile |
| Default | `JSON_BODY_LIMIT_BYTES` | 1 MB | every other API route body |
| Bulk import | `BULK_IMPORT_JSON_BODY_LIMIT_BYTES` | 32 MB | POST admin/bulk-import/execute |

- **Call pattern** (all API body reads; never `request.json()`/`.text()`/`.formData()`/`.arrayBuffer()`/`.body` directly):
```ts
const bodyResult = await readJsonBody(request);          // or { maxBytes: AUTH_JSON_BODY_LIMIT_BYTES }
if (!bodyResult.ok) return bodyResult.response;
const { name } = bodyResult.data;
```
- **Over the limit:** 413 `{ error: 'PayloadTooLarge', message: 'Request body is larger than <limit>' }`; one `warn` log (path, limit, declared length), never the body.
- **Content-Length over the limit:** the handler answers 413 without reading the body; Node then reads and discards the rest of the declared body on that connection. **No/smaller Content-Length (chunked):** bytes counted while reading; reading stops once past the limit and the reader is released (not cancelled: cancelling closes the connection before the 413 is sent).
- **Within the limit:** parsed with `new Response(bytes).json()`, identical to `request.json()` (same BOM handling, same `SyntaxError` for invalid/empty bodies, so each route's catch keeps its status).
- **`fallback`:** `readJsonBody(request, { fallback: {} })` returns the fallback for a missing/invalid body (replaces `request.json().catch(() => ({}))`); over-limit still 413.
- **Body already read / locked:** throws the same `TypeError` as `request.json()` (even with `fallback`).
- **Test doubles:** an object without `body` (e.g. `{ json: vi.fn() }` in route tests) is passed to its own `json()`; a real `Request` always has `body` (stream or null).
- **Convention test:** `tests/api/request-body-convention.test.ts` scans `src/middleware.ts`, `src/app/**/route.{ts,tsx,js}` and `src/lib/**` (whitespace collapsed, so calls split across lines count). It fails on: a receiver whose name contains `req` (or `(request as X)`) calling `json`/`text`/`formData`/`arrayBuffer`/`blob` as `.x()`, `?.x()`, `.x?.()` or `["x"]()`; `.body`/`.clone` on `req`/`request`/`*Req`/`*Request`; destructuring those members from such a receiver. Not caught: a request aliased to a name without `req`.
- **Page routes:** `next.config.ts` `experimental.proxyClientMaxBodySize: '64kb'`. Page routes take no request body; this keeps Next's middleware body copy for page paths small (bodies over it are cut off, with a "Request body exceeded 64KB" warning in the log).
- **Reverse proxies:** a proxy's own limit applies first (nginx default `client_max_body_size 1m`: raise it for bulk imports over 1 MB).

## Key Details
- **Arrays:** use `boundedArray(element, max, { min?, unique? })`, not `z.array(element).max(n)`. A pre-check reads only the array's `length` before any element is visited: out-of-bounds gives one `too_big`/`too_small` issue at the array's path (same fields and default message as `z.array().max()`/`.min()` once returned via `zodIssueDetails`); in-bounds arrays and non-arrays parse exactly like `z.array(element)` (same issue paths/messages). Every array in a request schema needs a max.
  - The length issue is fatal: parsing stops, so a parent `.refine`/`.superRefine` never sees the out-of-bounds list. The raw issue carries `fatal: true`; `zodIssueDetails` drops it.
  - `unique: true` removes duplicates after the length check (notification `events`).
- **Response:** `details: zodIssueDetails(error)` — first `MAX_VALIDATION_ISSUES` (20) issues, no `fatal` flag, string `received` over 100 chars cut to 100 + `...` (also inside the enum message that repeats it), object/array `received` replaced by its type name (`'object'`, `'array'`), `message` over 500 chars cut to 500 + `...` (schema-built text; the notification events enum message is ~207 chars and stays whole). Don't return `error.errors`/`error.issues` directly. No request schema uses `.strict()` or unions (`keys`/`unionErrors` are not shortened).
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

## Related: [backend/services/logging.md](services/logging.md), [backend/middleware.md](middleware.md)
