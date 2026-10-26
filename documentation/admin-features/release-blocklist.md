# Release Blocklist

**Status:** ✅ Implemented | Per-request, reactive, auto-block + admin manage.

## Overview
Releases that fail to download permanently OR fail to organize after retries are added to a per-request blocklist. Future searches for that request skip them. Admins manage via `/admin/blocklist`.

## Auto-Block Triggers
- **Organize failure** — final `warn` transition in `organize-files.processor.ts` (after `max_import_retries`). Source: `organize_fail`.
- **Download failure** — `progressState === 'failed'` in `monitor-download.processor.ts` (client-reported permanent failure). Source: `download_fail`. **NOT** block-worthy: connection-failure exhaustion, download client unreachable, auth failure.
- Transient retry paths do NOT block — only terminal failures do.

## Search Filter Scope (filters BEFORE ranking)
All three automatic search paths apply the per-request filter:
- `search-indexers.processor.ts` (audiobook search)
- `search-ebook.processor.ts` (ebook search)
- `monitor-rss-feeds.processor.ts` (RSS auto-grab)
- **Interactive search is NOT filtered.** Admin sees all results; blocked entries get an "Already blocked" badge in the modal.

Match: case-insensitive on normalized release name OR exact on `releaseHash` (`torrentHash` for torrents, `nzbId` for NZBs).

## Data Model
**Table:** `blocked_releases` ([backend/database.md](../backend/database.md))

Key fields:
- `requestId` — FK to `Request`, `onDelete: Cascade`.
- `releaseName` — verbatim, displayed as-is in admin UI.
- `releaseKey` — normalized (`trim().toLowerCase()`), used for matching.
- `releaseHash` — unifies `torrentHash` / `nzbId`.
- `source` — `'organize_fail' | 'download_fail' | 'manual'` (manual reserved for v2).
- `reason` — short human-readable (e.g. "No audiobook files found").
- `reasonDetail` — longer client error (SAB `failMessage`, NZBGet par/unpack codes).
- `downloadHistoryId` — traceability link (historical: after a re-request the DownloadHistory row is gone with the old request).
- `jobId` — for `JobEvent` filtering.

Unique constraint: `(requestId, releaseKey)` — idempotent upsert under concurrent writes.

Delete behavior:
- **Soft-delete of request** → blocklist rows survive (no cascade).
- **Hard-delete of request** → blocklist rows wiped via `onDelete: Cascade` (admin `DELETE /api/requests/[id]`, seeded-torrent cleanup of soft-deleted requests).
- **Re-request** of a `failed`/`warn`/`cancelled` request (user re-request, interactive pick; shelf sync and watched lists only as [Automatic re-requests](#automatic-re-requests-409) allow; `src/lib/services/request-rerequest.ts` `createRequestReplacing`): one transaction creates the new request, moves the old request's rows to it (`updateMany`, same row ids), then deletes the old request guarded by status. The new request starts with the old blocklist and `customSearchTerms`; jobs and notifications run after commit. A concurrent re-request finds nothing to delete, rolls back and gets `duplicate` (no second request).
- Effect (#312): a re-created request whose candidates are all blocked goes to `awaiting_search` ("all blocked"), which is not re-requestable, so shelf sync stops re-grabbing the dead release. Failures that add no block are rate-limited by the backoff below (#409).

## Automatic re-requests (#409)
**File:** `src/lib/services/auto-rerequest.ts` `decideAutoReRequest()`; called from `createRequestForUser` when `options.automatic` (shelf sync `shelf-sync-core.service.ts`, watched authors/series `watched-lists.service.ts`).

| Existing request | Automatic caller |
|---|---|
| `cancelled` (by the user or an admin) | never replaced; result `cancelled_by_user` |
| `failed`/`warn`, attempt added a block (`BlockedRelease.createdAt >= request.createdAt`) | replaced at once, count unchanged |
| `failed`/`warn`, no new block | replaced once `updatedAt + wait(count)` has passed, new request gets `count + 1`; before that `retry_not_due` |

- **Wait** (`AUTO_REREQUEST_WAIT_DAYS`): count 0 → 1 day, 1 → 3, 2 → 7, 3 → 14, 4+ → every 30 days. No cap.
- **Count:** `Request.autoRerequestCount` (`auto_rerequest_count`, Int, default 0). Carried only by automatic replacements.
- **Reset to 0 by every user or admin action:** a new user request (`POST /api/requests`, `request-with-torrent`) and every in-place retry: `select-torrent` (also when it waits for approval), `manual-search`, PATCH `retry` (search and import), admin `retry-download`, admin `search-terms` with a new search, admin `manual-import` and `bulk-import/execute` recycling the request.
- **User paths unchanged:** they replace `failed`/`warn`/`cancelled` at once. Deleted requests (`deletedAt`) are invisible, so the book is requested again. The ignore list (`Ignore from Auto-Requests`) runs before this rule, unchanged.
- **Visibility:** the request stays `failed`/`warn` with its `errorMessage`. Logs: skips and due decisions at debug (`AutoReRequest`, with the due date); each automatic re-request that is actually created logs one info line (`RequestCreator`: book, retry number or "a release was blocked", next wait if it fails again, new request id). A run that stops at `being_processed`, a missing user or a lost race logs nothing at info.
- **Known limits:** after an in-place retry, `createdAt` predates that retry, so a pre-retry block counts as new (one extra immediate re-request, no loop). A sync landing between the failure write and the block write sees no block and waits (delay to the next sync only). A later write to the failed row (admin search-terms edit) restarts the wait.

## Service API
**File:** `src/lib/services/blocklist.service.ts`
- `addAutoBlock(input)` — idempotent upsert; never throws; emits `JobEvent` (context `Blocklist.AutoBlock`).
- `isReleaseBlocked(requestId, name, hash?)` — match-check used by search filters.
- `getBlocklistForRequest(requestId)` — list, newest first; powers chip + interactive-search badge.
- `removeBlock(id)` — single unblock.
- `clearBlocklist(where)` — filter-scoped bulk delete, returns `{ count }`.

## HTTP API
**Auth:** all endpoints require `requireAuth` + `requireAdmin`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/blocklist` | Paginated list with filters + sort |
| DELETE | `/api/admin/blocklist?…` | Filter-scoped bulk clear (same filter params as GET) |
| DELETE | `/api/admin/blocklist/[id]` | Single unblock |
| GET | `/api/admin/blocklist/by-request/[requestId]` | Lightweight per-request lookup (chip + badge) |

### `GET /api/admin/blocklist`
Query params: `requestId`, `source`, `search` (contains-OR over `releaseName`+`reason`, case-insensitive), `dateFrom`, `dateTo`, `page`, `limit` (25/50/100), `sortBy` (`createdAt`|`releaseName`|`reason`), `sortOrder` (`asc`|`desc`).

Response: `{ entries: BlockedReleaseRow[], pagination: { page, limit, total, totalPages } }`. Each `entries` row includes the joined `request.audiobook` + `request.user` for display and `request.deletedAt` for the "(deleted)" badge.

### `DELETE /api/admin/blocklist`
Filter-scoped — passes the same query params used for the GET. Returns `{ count }`. UI gates with a typed-token modal ("CLEAR"); auth/role is the server-side security boundary.

### `GET /api/admin/blocklist/by-request/[requestId]`
Returns `{ entries: BlockedRelease[], count }`. No pagination (per-request blocklists are small).

`buildBlocklistWhere(params)` is exported pure for tests + reuse by DELETE.

## Admin UI
**Page:** `/admin/blocklist` ([src/app/admin/blocklist/page.tsx](../../src/app/admin/blocklist/page.tsx))

Mirrors `/admin/logs` patterns: URL ↔ state via `useBlocklistUrlState`, SWR with `keepPreviousData`, sticky toolbar + filter row + chip strip + table + pagination.

- **Columns:** Release name (verbatim), Reason (+ expand chevron for detail), Source badge, Associated request (title + author + user, with "(deleted)" badge if soft-deleted), Indexer, Blocked at (relative; title attribute = absolute), Actions.
- **Per-row Unblock:** real `<button>`, optimistic update, toast on success/failure.
- **Filters:** Source dropdown, Date range (shared with logs preset list), free-text search.
- **Sort:** clickable column headers on Release name / Reason / Blocked at; URL-driven; persists in shareable link.
- **Bulk Clear (`Clear filtered (N)` or `Clear all (N)`):** opens a typed-token confirmation modal. Button label adapts to active filter state.
- **Empty states:** "fresh" / "filters-too-tight" / "search-no-match" — pure function of `{ total, hasFilters, hasSearch }`.

**Nav entry:** Quick Actions tile on the admin dashboard (`src/app/admin/page.tsx`).

## Request Detail Chip
**Component:** `BlockedReleasesChip` ([src/app/admin/components/BlockedReleasesChip.tsx](../../src/app/admin/components/BlockedReleasesChip.tsx))

Rendered in the title cell of each request row in `RecentRequestsTable` when `blockedCount > 0`. Real `<button>` with explicit chevron — no surprise expansion. Click opens a portal-anchored popover that lazy-loads `GET /api/admin/blocklist/by-request/[requestId]` and lists each blocked release with a per-row Unblock button.

The `_count.blockedReleases` aggregate is included in the existing `/api/admin/requests` response as an additive field.

## Interactive Search Badge
When the admin opens `InteractiveTorrentSearchModal` for a request, the modal fetches the per-request blocklist (admin-only — non-admin gets 403, no badge). Each result row is checked against the lookup (normalized name OR `infoHash`). Matches render an amber **"Already blocked — &lt;reason&gt;"** chip inline. Interactive search results are **not filtered** — admin sees the full picture.

## Test Coverage
- `tests/utils/release-key.test.ts` — normalization rules.
- `tests/services/blocklist.service.test.ts` — upsert idempotency, lookup match, JobEvent emission.
- `tests/processors/*` — auto-block triggers + filter coverage on each search path.
- `tests/api/admin-blocklist.routes.test.ts` — auth gate, where composition, single + bulk DELETE, by-request GET, sort/pagination/limit clamp.

## UX Rules Honored
- **Intentional affordances** — every tappable element is a real `<button>`/`<a>` with hover/focus treatment; expand-rows show an explicit chevron.
- **Source data stays true** — release names render verbatim. Chips/badges add context (source, reason, "blocked"), they never replace the original string.

## Out of Scope (v2)
- Global (cross-request) blocklist + per-block toggle UI.
- Manual proactive admin block.
- Requester-facing UI surface.
- Auto-expiration / TTL.
- Zero-seeder torrents as a block trigger.
- Indexer-side push (Prowlarr blocklist API).

## Related
- [Database schema](../backend/database.md)
- [Search processors](../phase3/prowlarr.md)
- [Admin dashboard](../admin-dashboard.md)
- [Request deletion](request-deletion.md) — interaction with hard/soft delete cascade.
