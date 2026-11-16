# API Tokens

**Status:** ✅ Implemented | Personal long-lived tokens, allowlisted endpoints, write capability per issue #169, opt-in request approval (approve only)

## Overview
Static `rmab_`-prefixed tokens act with the owner's full user-level permissions on a fixed allowlist of endpoints. JWT sessions are NOT restricted by the allowlist.

## Key Details
- **Prefix:** `rmab_` (12-char stored display prefix: `rmab_` + 7 hex chars)
- **Storage:** SHA-256 hash in `apiToken.tokenHash`; full token shown ONCE on create
- **Role binding:** Token `role` matches token owner's role at creation time; per request the effective role is capped by the owner's current role (admin token of a demoted owner acts as `user`; a `user` token is not raised on promotion); admin tokens require admin-created
- **Per-user cap:** 25 active (non-expired) tokens (`MAX_TOKENS_PER_USER`)
- **Expiry:** Optional (`never`, `30d`, `90d`, `1y`); approval tokens: required, at most 90 days ([Request approval](#request-approval-opt-in-approve-only))
- **Soft-deleted users:** Tokens reject if `tokenUser.deletedAt` is set
- **Unapproved accounts:** Tokens reject if the owner's `registrationStatus` is `pending_approval` or `rejected` (null counts as approved); `POST /api/admin/api-tokens` for such a target returns 403
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
| POST | `/api/requests/:id/cancel` | Cancel request | ✓ | |
| GET | `/api/admin/metrics` | System metrics | | ✓ |
| GET | `/api/admin/downloads/active` | Active downloads | | ✓ |
| GET | `/api/admin/requests/recent` | Recent requests | | ✓ |
| POST | `/api/admin/requests/:id/approve` | Approve request (opt-in `approve_requests`, approve only) | ✓ | ✓ |

Source of truth: `src/lib/constants/api-tokens.ts` (`API_TOKEN_ALLOWED_ENDPOINTS`, `API_TOKEN_ENDPOINT_DOCS`).

## Matcher (`isEndpointAllowed`, `getEndpointPermissions`)
- Compiled once at module load.
- `path` entries containing `:name` are converted to anchored regexes where each placeholder matches `[^/]+` (a single segment).
- Sibling sub-routes (e.g. `/api/requests/:id/select-torrent`) are NOT matched by the `/api/requests/:id` entry — they require their own allowlist entry.
- Method comparison is case-insensitive.
- **Permissions:** an entry may name `permission` (`ApiTokenPermission`, today only `approve_requests`). `getEndpointPermissions(method, path)` returns the permissions of EVERY matching entry (a broader untagged entry never hides a tagged one); all must pass. `checkTokenPermissions` (`src/lib/middleware/api-token-auth.ts`) is an exhaustive `switch` whose `default` refuses (403), with a `never` check so a new permission without a case fails the typecheck. A test pins that each tagged path matches exactly one entry.

## Request approval (opt-in, approve only)
- **Two opt-ins:** setting `api_tokens.allow_request_approval` (Settings → API switch, off by default, read from the DB on every call, only exactly `'true'` counts) AND `api_tokens.can_approve_requests` on the token (`ApiToken.canApproveRequests`, default false, set only at create; no edit route).
- **Use-time gates** (`checkApprovePermission`, same function for `requireAuth` and `getOptionalAuthUser`; expiry 401 is checked first in `authenticateApiToken`):

| Case | Answer |
|---|---|
| Token flag not `true` | 403 `This API token is not allowed to approve requests.` |
| Effective role not admin (user token, demoted owner) | 403 `Approving requests with an API token needs an admin account.` (route `requireAdmin` checks again) |
| `expiresAt` null or more than 90 days + 24 h after `createdAt` | 403 `A token that approves requests must expire within 90 days of its creation.` |
| Setting not exactly `'true'` | 403 `Approving requests with API tokens is turned off in Settings → API.` |
| Setting read fails | 503 `ServiceUnavailable` (handler not run); `getOptionalAuthUser` → null |

- **Route** (`/api/admin/requests/:id/approve`): a token caller is `req.apiToken` set OR a bearer value starting `rmab_`. After the body parse and before any row read: `action: 'deny'` → 403 `API tokens can only approve requests. Deny in the web UI or in Discord.`; `selectedTorrent` present and not `null` → 400 `ValidationError`. Then `decideRequestApproval({ adminSelectedTorrent: undefined, via: 'api_token' })` (PR 4's claim and rollback): stored pick through the same guard, else a search; not found 404, not waiting 400 `InvalidStatus`, lost claim 400 `InvalidStatus`, unreachable source 503.
- **Create** (`POST /api/user/api-tokens`, `POST /api/admin/api-tokens`, body `canApproveRequests: true`): order parse 400 → user lookup 404 → existing refusals → admin (DB role) 403 → own account (admin route: `userId` omitted or the caller) 403 → setting on 403 → expiry 400 → token cap 403. Expiry required, after now, at most now + 90 days; up to 24 h past that (local-date 90 days across a clock change, a fast browser clock) is stored as exactly now + 90 days; later is 400. Without the flag nothing changes (any expiry, incl. never).
- **GET token lists:** each token has `canApproveRequests`; `approvalTokensAvailable` (user route: caller admin AND setting on; admin route: setting on; a failed setting read gives false).
- **Setting route:** `GET/PATCH /api/admin/settings/api-tokens` → `{ allowRequestApproval: boolean }` (`requireAuth` + `requireAdmin`, zod boolean, 400 otherwise). Not on the allowlist: a token can never change it.
- **Audit:** one warn line `API token request approval` per token decision or refusal (outcome `approved`/`not_found`/`invalid_status`/`source_unavailable`/`pick_rejected`/`refused_deny`/`refused_release`/`invalid_body`/`error`); request id, status, token id/prefix/name, admin id and `via: 'api_token'` in metadata only (JSON-encoded). Middleware refusals log `API token refused by an endpoint permission`. Not persisted.
- **Approve only:** a token never denies; to deny, an admin uses the web UI or Discord (a deny blocks its requester from that book until an admin removes it, and sends no notification).
- **Listing waiting requests:** `GET /api/requests?status=awaiting_approval` (`GET /api/admin/requests/pending-approval` stays off the allowlist).
- **Kill switch:** turning the setting off stops every approval token at once; on again restores the unexpired ones.
- **Demotion:** the flag stays; the role gate refuses while the owner is not admin, and re-promotion brings the approval tokens back (revoke them if that is not wanted).
- **Signing out:** revoking a user's sessions (`sessionsInvalidatedAt`, login link) does not cut API tokens: revoke the token.
- **Downgrade:** an older release drops the column on its startup `db push`; after re-upgrading every flag reads false.

## POST `/api/requests` (Write)
- Body: `{ "audiobook": { "asin", "title", "author", "narrator?", "description?", "coverArtUrl?" }, "explicit?": boolean }`
- `explicit: true` marks the request Explicit (#542; Audiobookshelf mode turns on the item's Explicit flag on delivery, [explicit-flag.md](../../features/explicit-flag.md)). **Ignored while the admin setting `audiobookshelf.explicit_mark_enabled` is off (the default):** the request is created unmarked. A re-request keeps the replaced request's mark either way. Later changes go through `PUT /api/requests/:id/explicit`, which is NOT on the allowlist (UI only); `src/lib/constants/api-tokens.ts` is unchanged by #542.
- Internally calls `createRequestForUser(req.user.id, audiobook, { bypassIgnore: true, explicit: explicit && setting on })` — token requests bypass the ignore list, matching UI behavior.
- Optional query param: `?skipAutoSearch=true` defers search-job creation.
- Side effects (identical to UI): duplicate detection, library check, Audnexus enrichment, audiobook upsert, ignore-list check (bypassed), per-user dedup, auto-approve gating, release-date gate, notification queue, search-job queue.
- Auto-approve: follows the token owner's per-user `autoApproveRequests` setting, then global. No bypass.
- Response: `201 { success: true, request }` (`request.audiobook` is stored values, no `libraryAsin` or `fileSizeBytes`) or named error: `{ error: "AlreadyAvailable" | "BeingProcessed" | "DuplicateRequest" | "Ignored" | "UserNotFound" | "ValidationError", message }`

## GET `/api/requests`
- Query: `status` (group `active`|`waiting`|`completed`|`failed`|`cancelled`, or one status), `cursor`, `take` (default 20, max 100; legacy `limit`), `myOnly`, `type` (`audiobook`|`ebook`). Response: `{ requests, nextCursor, counts }`; users see their own, admins all (`myOnly=true` for their own).
- Each `request.audiobook` is shown as the card shows it (#325a): for an `available` audiobook request that follows its Audiobookshelf item, `title`, `author`, `narrator` are the linked item's, `coverArtUrl` is a relative `/api/cache/library/<file>` (the cached library cover, served without auth; null when none is cached), and `libraryAsin` is the effective library ASIN. Every other request: stored values, `libraryAsin: null`. `audibleAsin`, series, year, description stay the requested ones. See [fixes/file-hash-matching.md](../../fixes/file-hash-matching.md#delivered-requests-follow-the-library-asin-325a).
- Never included: `audiobook.filePath`, `audiobook.fileSizeBytes`, `placedEbookFiles`; `selectedTorrent` for admins only, without the indexer key (`stripProwlarrKeyFromResults()` on an admin's page).
- Each request carries `explicit` (boolean, #542); so do `POST /api/requests` and `GET /api/requests/:id`.
- `progress` (#216): while a request is `processing`, `progress` is 100, except during the chapter merge, when it runs from 0 to 99. `status` is unchanged.

## GET `/api/requests/:id`
- Returns request including `audiobook`, `downloadHistory` (selected), and recent `jobs`.
- `progress` (#216): the same as `GET /api/requests`: 100 while `processing`, except 0-99 during the chapter merge.
- `audiobook` (#325a): the same overlay as `GET /api/requests` (title, author, narrator, relative `coverArtUrl`, effective `libraryAsin`), applied after the ownership check. `audiobook.audibleAsin` stays the requested ASIN. See [fixes/file-hash-matching.md](../../fixes/file-hash-matching.md#delivered-requests-follow-the-library-asin-325a).
- Every role (`src/lib/services/request-detail-query.ts`): `jobs` is the job summary `JOB_SUMMARY_SELECT` (`id, requestId, type, status, priority, attempts, maxAttempts, errorMessage, startedAt, completedAt, createdAt, updatedAt`; never `payload/result/stackTrace`); `downloadHistory` never has `magnetLink/torrentUrl/downloadPath`; the whole response passes through `stripProwlarrKeyFromResults()` (stored links lose the indexer key).
- Non-admin callers (owner sessions, user-role tokens): explicit field list `OWNER_REQUEST_DETAIL_SELECT`, which also omits `Request.selectedTorrent`, `Request.autoRerequestCount`, `Request.cancelledAt`, `Request.deletedBy`, `Audiobook.filePath` and `DownloadHistory.addedByRmab`. Admins get the include `ADMIN_REQUEST_DETAIL_INCLUDE`, minus `Request.placedEbookFiles` and `Request.approvalBypassedBy` (#232) (never returned by any request response: `GET /api/requests` list, `POST /api/requests` and this route included).
- Ownership enforced: `requestRecord.userId === req.user.id || role === 'admin'` → otherwise 403.
- Soft-deleted requests (`deletedAt != null`) return 404.
- BigInt columns (`downloadHistory[].torrentSizeBytes`, `audiobook.fileSizeBytes`) go out as JSON numbers via `toJsonSafe()` (`src/lib/utils/json-safe.ts`).

## Fixed Issues
- **#261 GET `/api/requests/:id` 500 `FetchError` for any request with a selected download:** `NextResponse.json` threw `Do not know how to serialize a BigInt` on `DownloadHistory.torrentSizeBytes`. Fix: response passes through `toJsonSafe()` (BigInt → number; Dates/Decimals untouched). Other routes `select` around the BigInt columns or convert with `Number()`; nothing writes `Audiobook.fileSizeBytes` yet (always null).
  - **#600 omit:** the Prisma client omits `fileSizeBytes` from every audiobook result (`src/lib/db.ts`), so a full `audiobook` include (GET `/api/requests` and the rest) never carries a BigInt into `NextResponse.json`; GET `/api/requests/:id` still returns it through `toJsonSafe()` (owner `select`, admin `omit: { fileSizeBytes: false }`).

## POST `/api/requests/:id/cancel` (Write, #228)
- Route: `src/app/api/requests/[id]/cancel/route.ts` → `cancelLoadedRequest()` ([request-cancel.md](../../admin-features/request-cancel.md)).
- Owner, or effective role admin (a token acts with its owner's current role); 403 otherwise; 404 missing or soft-deleted; 400 status not in `CANCELLABLE_STATUSES` (`pending`, `searching`, `downloading`, `awaiting_search`, `awaiting_approval`, `awaiting_release`; `cancelled` = idempotent 200).
- `200 { success, request: {id, status, cancelledAt}, download, message }`: no `selectedTorrent`, no download internals. Non-admin messages never name the client or a sharing request, and non-admins get `download: 'kept'` for `kept_shared` / `kept_not_owned`.
- Stops RMAB's own partial download; a finished one may stay to seed; never deletes library files.
- `PATCH`/`DELETE /api/requests/:id` are NOT on the allowlist. The raw `DELETE /api/requests/:id` handler was removed (405); admin delete is `DELETE /api/admin/requests/:id` (JWT only).

## GET `/api/audiobooks/search`
- Auth is optional (route never calls `requireAuth`). An API token counts only on allowlisted endpoints (this one is listed); elsewhere `getOptionalAuthUser` treats it as no caller.
- Uses `getOptionalAuthUser` to recognize both JWT sessions AND API tokens (same account checks as `requireAuth`) for per-user enrichment (request status, ignore status).
- Without a checked caller: same results with no request details (`isRequested: false`, request fields `null`) and `isIgnored: false`.
- With a checked JWT or `rmab_` token: results enriched with `isRequested`, `requestStatus`, `requestId`, `isIgnored`, etc.

## Auth flow
1. Request hits route; `requireAuth` extracts `Authorization: Bearer ...` token.
2. If token starts with `rmab_` → `authenticateApiToken` (`src/lib/middleware/api-token-auth.ts`: SHA-256 lookup, expiry + soft-delete check, fire-and-forget `lastUsedAt` update).
3. `checkTokenEndpointAccess`: not on the allowlist → 403 "This endpoint is not available via API token authentication"; then every permission of every matching entry (403/503 above).
4. Passed → handler runs with `req.user = { sub, id, plexId, username, role }` and `req.apiToken = { id, name, tokenPrefix, canApproveRequests }` (never set for sessions).
5. JWT tokens skip the allowlist entirely. `getOptionalAuthUser` checks the allowlist before the lookup and the permissions after it (null on any refusal).

## UI surfaces
- `/api-docs` page (`src/app/api-docs/page.tsx`) — auto-renders `API_TOKEN_ENDPOINT_DOCS`. Endpoints with `isWrite: true` show an amber **Write** badge; the "Try it" button is disabled with a "use curl" hint to avoid sending mutating requests from a UI that cannot construct request bodies. Endpoints with `permission` show an **Opt-in** badge.
- Profile → API Tokens (`src/components/profile/ApiTokensSection.tsx`) — create/revoke UI. Includes a one-line warning that tokens act with the owner's full permissions.
- Settings → API (`src/app/admin/settings/tabs/ApiTab/ApiTab.tsx`) — admin can create tokens on behalf of any user; the "Allow API tokens to approve requests" switch (`TokenApprovalSetting.tsx`, saves on toggle).
- "Can approve requests" checkbox (`src/components/api-tokens/ApprovalTokenOption.tsx`) in both create forms, shown only when `approvalTokensAvailable` (Settings → API: only for "Current user" or the admin's own id); while ticked the expiry is 30 or 90 days (default 90; `useApiTokens`). Token lists show a "Can approve requests" badge.

## Files
- Constants + matcher: `src/lib/constants/api-tokens.ts`
- Middleware: `src/lib/middleware/auth.ts` (`requireAuth`, `getOptionalAuthUser`), `src/lib/middleware/api-token-auth.ts` (token lookup, allowlist + permission gate)
- Approval: `src/lib/services/api-token-approval.ts` (setting, create rule, route checks, audit)
- Routes:
  - `src/app/api/user/api-tokens/route.ts` (user create/list/revoke)
  - `src/app/api/admin/api-tokens/route.ts` (admin)
  - `src/app/api/admin/settings/api-tokens/route.ts` (approval switch)
- Schema: `ApiToken.canApproveRequests` (`prisma/migrations/20261116120000_add_api_token_can_approve_requests`, documentary; `db push` applies it)
- UI: `src/app/api-docs/page.tsx`, `src/components/api-docs/EndpointCard.tsx`, `src/components/api-docs/TokenInput.tsx`, `src/components/profile/ApiTokensSection.tsx`

## Tests
- `tests/constants/api-tokens.test.ts` — matcher: positive matches, negative matches, sub-route exclusion, method case-insensitivity, allowlist/docs parity; permissions (every match, exactly one match per tagged path).
- `tests/middleware/auth.middleware.test.ts` — middleware token auth path, allowlist enforcement (incl. dynamic ID match), sibling-route blocking, `getOptionalAuthUser`.
- `tests/middleware/api-token-auth.test.ts` — each approval gate alone, 503 on a failed setting read, unknown permission refused, sessions never read the setting.
- `tests/api/requests-approve-token.route.test.ts`, `tests/api/requests-approve-token.integration.test.ts` — route refusals before any read, stored pick / search, claim race, audit lines; real middleware + route.
- `tests/api/api-token-approval-create.routes.test.ts`, `tests/api/admin-settings-api-tokens.routes.test.ts`, `tests/components/api-tokens/ApprovalTokenOption.test.tsx` — create rules and expiry edges, setting route, create-form option and switch.
- `tests/api/requests-id.route.test.ts` — owner GET 200, cross-user GET 403.
- `tests/api/requests-cancel.route.test.ts` — cancel route: owner 200 minimal body, cross-user 403, admin any, 404, 400.
- `tests/api/requests-id.bigint.route.test.ts` — owner/admin GET 200 with BigInt sizes as numbers (#261).
- `tests/utils/json-safe.test.ts` — `toJsonSafe()` BigInt conversion, Date/Decimal passthrough.

## Related
- [backend/services/auth.md](auth.md) — JWT sessions, role-based access control
- [backend/services/notifications.md](notifications.md) — request notification triggers
