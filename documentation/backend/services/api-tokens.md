# API Tokens

**Status:** ✅ Implemented | Personal long-lived tokens, allowlisted endpoints, write capability per issue #169

## Overview
Static `rmab_`-prefixed tokens act with the owner's full user-level permissions on a fixed allowlist of endpoints. JWT sessions are NOT restricted by the allowlist.

## Key Details
- **Prefix:** `rmab_` (12-char stored display prefix: `rmab_` + 7 hex chars)
- **Storage:** SHA-256 hash in `apiToken.tokenHash`; full token shown ONCE on create
- **Role binding:** Token `role` matches token owner's role at creation time; admin tokens require admin-created
- **Per-user cap:** 25 active (non-expired) tokens (`MAX_TOKENS_PER_USER`)
- **Expiry:** Optional (`never`, `30d`, `90d`, `1y`)
- **Soft-deleted users:** Tokens reject if `tokenUser.deletedAt` is set
- **Identity attribution:** `req.user.id` resolves to `apiToken.userId` (target user), NOT `apiToken.createdById`
- **Header:** `Authorization: Bearer rmab_<token>`

## Allowed Endpoints
| Method | Path | Title | Write | Admin |
|---|---|---|---|---|
| GET | `/api/auth/me` | Current user | | |
| GET | `/api/audiobooks/search` | Search audiobooks | | |
| GET | `/api/requests` | List requests | | |
| POST | `/api/requests` | Create request | ✓ | |
| GET | `/api/requests/:id` | Get request by ID | | |
| DELETE | `/api/requests/:id` | Delete request | ✓ | |
| GET | `/api/admin/metrics` | System metrics | | ✓ |
| GET | `/api/admin/downloads/active` | Active downloads | | ✓ |
| GET | `/api/admin/requests/recent` | Recent requests | | ✓ |

Source of truth: `src/lib/constants/api-tokens.ts` (`API_TOKEN_ALLOWED_ENDPOINTS`, `API_TOKEN_ENDPOINT_DOCS`).

## Matcher (`isEndpointAllowed`)
- Compiled once at module load.
- `path` entries containing `:name` are converted to anchored regexes where each placeholder matches `[^/]+` (a single segment).
- Sibling sub-routes (e.g. `/api/requests/:id/select-torrent`) are NOT matched by the `/api/requests/:id` entry — they require their own allowlist entry.
- Method comparison is case-insensitive.

## POST `/api/requests` (Write)
- Body: `{ "audiobook": { "asin", "title", "author", "narrator?", "description?", "coverArtUrl?" } }`
- Internally calls `createRequestForUser(req.user.id, audiobook, { bypassIgnore: true })` — token requests bypass the ignore list, matching UI behavior.
- Optional query param: `?skipAutoSearch=true` defers search-job creation.
- Side effects (identical to UI): duplicate detection, library check, Audnexus enrichment, audiobook upsert, ignore-list check (bypassed), per-user dedup, auto-approve gating, release-date gate, notification queue, search-job queue.
- Auto-approve: follows the token owner's per-user `autoApproveRequests` setting, then global. No bypass.
- Response: `201 { success: true, request }` or named error: `{ error: "AlreadyAvailable" | "BeingProcessed" | "DuplicateRequest" | "Ignored" | "UserNotFound" | "ValidationError", message }`

## GET `/api/requests/:id`
- Returns full request including `audiobook`, `downloadHistory` (selected), and recent `jobs`.
- Ownership enforced: `requestRecord.userId === req.user.id || role === 'admin'` → otherwise 403.
- Soft-deleted requests (`deletedAt != null`) return 404.

## DELETE `/api/requests/:id` (Write)

- Soft-deletes a request with cascading cleanup: removes media files from disk, deletes the library item from Audiobookshelf/Plex, and handles download client torrents/NZBs respecting seeding configuration.
- Ownership enforced: `requestRecord.userId === req.user.id || role === 'admin'` → otherwise 403.
- Soft-deleted requests (`deletedAt != null`) return 404.
- Response: `200 { success: true, message, details: { filesDeleted, torrentsRemoved, torrentsKeptSeeding, torrentsKeptUnlimited } }`
- The request can be re-created after deletion (soft delete preserves audit trail).

## GET `/api/audiobooks/search`
- Auth is optional, NOT gated by allowlist (route never calls `requireAuth`).
- Uses `getCurrentUserAsync` to recognize both JWT sessions AND API tokens for per-user enrichment (request status, ignore status).
- Without auth: returns generic results with no user-context annotations.
- With JWT or `rmab_` token: returns results enriched with `isRequested`, `requestStatus`, `requestId`, `isIgnored`, etc.

## Auth flow
1. Request hits route; `requireAuth` extracts `Authorization: Bearer ...` token.
2. If token starts with `rmab_` → `authenticateApiToken` (SHA-256 lookup, expiry + soft-delete check, fire-and-forget `lastUsedAt` update).
3. If on the allowlist → handler runs with `req.user = { sub, id, plexId, username, role }`.
4. If not on the allowlist → 403 "This endpoint is not available via API token authentication".
5. JWT tokens skip the allowlist entirely.

## UI surfaces
- `/api-docs` page (`src/app/api-docs/page.tsx`) — auto-renders `API_TOKEN_ENDPOINT_DOCS`. Endpoints with `isWrite: true` show an amber **Write** badge; the "Try it" button is disabled with a "use curl" hint to avoid sending mutating requests from a UI that cannot construct request bodies.
- Profile → API Tokens (`src/components/profile/ApiTokensSection.tsx`) — create/revoke UI. Includes a one-line warning that tokens act with the owner's full permissions.
- Admin → Users → API Tokens — admin can create tokens on behalf of any user.

## Files
- Constants + matcher: `src/lib/constants/api-tokens.ts`
- Middleware: `src/lib/middleware/auth.ts` (`requireAuth`, `getCurrentUser`, `getCurrentUserAsync`)
- Routes:
  - `src/app/api/user/api-tokens/route.ts` (user create/list/revoke)
  - `src/app/api/admin/api-tokens/route.ts` (admin)
- UI: `src/app/api-docs/page.tsx`, `src/components/api-docs/EndpointCard.tsx`, `src/components/api-docs/TokenInput.tsx`, `src/components/profile/ApiTokensSection.tsx`

## Tests
- `tests/constants/api-tokens.test.ts` — matcher: positive matches, negative matches, sub-route exclusion, method case-insensitivity, allowlist/docs parity.
- `tests/middleware/auth.middleware.test.ts` — middleware token auth path, allowlist enforcement (incl. dynamic ID match), sibling-route blocking, `getCurrentUserAsync`.
- `tests/api/requests-id.route.test.ts` — owner GET 200, cross-user GET 403, admin DELETE any, user DELETE own, cross-user DELETE 403.

## Related
- [backend/services/auth.md](auth.md) — JWT sessions, role-based access control
- [backend/services/notifications.md](notifications.md) — request notification triggers
