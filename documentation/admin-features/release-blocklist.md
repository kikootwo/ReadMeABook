# Release Blocklist

**Status:** ✅ Implemented | Per-request, reactive, auto-block + admin manage.

## Overview
Releases that fail to download permanently OR fail to organize after retries are added to a per-request blocklist. Future searches for that request skip them. Admins manage via `/admin/blocklist`.

## Auto-Block Triggers
- **Organize failure** — final `warn` transition in `organize-files.processor.ts` (after `max_import_retries`). Source: `organize_fail`.
- **Download failure** — `progressState === 'failed'` in `monitor-download.processor.ts` (client-reported permanent failure), handled in `client-failure.ts` ([Next release after a client failure](#next-release-after-a-client-failure-332)). Source: `download_fail`. **NOT** block-worthy: connection-failure exhaustion, download client unreachable, auth failure, no client configured, a download removed by hand, and client failures that are not the release's fault (full disk, permissions, missing data, unmounted paths; list below).
- Transient retry paths do NOT block — only terminal failures do.

## Search Filter Scope (filters BEFORE ranking)
All three automatic search paths apply the per-request filter:
- `search-indexers.processor.ts` (audiobook search)
- `search-ebook.processor.ts` (ebook search)
- `monitor-rss-feeds.processor.ts` (RSS auto-grab)
- **Interactive search is NOT filtered.** Admin sees all results; blocked entries get an "Already blocked" badge in the modal.

Match: case-insensitive on normalized release name OR on `releaseHash` (`torrentHash` for torrents, `nzbId` for NZBs). `filter-blocked-results.ts` compares every form of a torrent hash (`torrentHashForms`: hex/base32, either case), so the same torrent from another indexer is caught (#332); the RSS path keeps an exact compare.

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
- **Hard-delete of request** → blocklist rows wiped via `onDelete: Cascade` (seeded-torrent cleanup of soft-deleted requests; the raw admin `DELETE /api/requests/[id]` was removed in #228).
- **Re-request** of a `failed`/`warn`/`cancelled` request (user re-request, interactive pick; shelf sync and watched lists only as [Automatic re-requests](#automatic-re-requests-409) allow; `src/lib/services/request-rerequest.ts` `createRequestReplacing`): one transaction creates the new request, moves the old request's rows to it (`updateMany`, same row ids), then deletes the old request guarded by status. The new request starts with the old blocklist and `customSearchTerms`; jobs and notifications run after commit. A concurrent re-request finds nothing to delete, rolls back and gets `duplicate` (no second request).
- Effect (#312): a re-created request whose candidates are all blocked goes to `awaiting_search` ("all blocked"), which is not re-requestable, so shelf sync stops re-grabbing the dead release. Failures that add no block are rate-limited by the backoff below (#409).

## Automatic re-requests (#409)
**File:** `src/lib/services/auto-rerequest.ts` `decideAutoReRequest()`; called from `createRequestForUser` when `options.automatic` (shelf sync `shelf-sync-core.service.ts`, watched authors/series `watched-lists.service.ts`).

| Existing request | Automatic caller |
|---|---|
| `cancelled` (by the user or an admin) | never replaced; result `cancelled_by_user` |
| `failed`/`warn`, attempt added a block (`BlockedRelease.createdAt >= request.createdAt`) | replaced at once, count unchanged |
| `failed`/`warn`, no new block | replaced once `updatedAt + wait(count)` has passed, new request gets `count + 1`; before that `retry_not_due` |
| any user's `failed` request with `errorMessage` = `REMOVED_FROM_LIBRARY_MESSAGE` (book left the library, no audio left, #214) | never requested, for any user, blocks or not; result `removed_from_library` (`removedFromLibrarySkip()`, checked first). A manual request brings it back |

- **Wait** (`AUTO_REREQUEST_WAIT_DAYS`): count 0 → 1 day, 1 → 3, 2 → 7, 3 → 14, 4+ → every 30 days. No cap.
- **Count:** `Request.autoRerequestCount` (`auto_rerequest_count`, Int, default 0). Carried only by automatic replacements.
- **Reset to 0 by every user or admin action:** a new user request (`POST /api/requests`, `request-with-torrent`) and every in-place retry: `select-torrent` (also when it waits for approval), `manual-search`, PATCH `retry` (search and import), admin `retry-download`, admin `search-terms` with a new search, admin `manual-import` and `bulk-import/execute` recycling the request.
- **User paths unchanged:** they replace `failed`/`warn`/`cancelled` at once. Deleted requests (`deletedAt`) are invisible, so the book is requested again. The ignore list (`Ignore from Auto-Requests`) runs before this rule, unchanged.
- **Visibility:** the request stays `failed`/`warn` with its `errorMessage`. Logs: skips and due decisions at debug (`AutoReRequest`, with the due date); each automatic re-request that is actually created logs one info line (`RequestCreator`: book, retry number or "a release was blocked", next wait if it fails again, new request id). A run that stops at `being_processed`, a missing user or a lost race logs nothing at info.
- **Known limits:** after an in-place retry, `createdAt` predates that retry, so a pre-retry block counts as new (one extra immediate re-request, no loop). A sync landing between the failure write and the block write sees no block and waits (delay to the next sync only). A later write to the failed row (admin search-terms edit) restarts the wait.

## Next release after a client failure (#332)
**File:** `src/lib/processors/client-failure.ts` `handleClientReportedFailure()`, called from the monitor's `failed` branch. No setting, no schema change.

| Client reports `failed` | Result |
|---|---|
| Automatic grab, release fault, failure 1 or 2 in a row, block written | request `searching` (progress 0); history `failed`; block; automatic search queued with `clientFailures` = n; `request_error` "Download failed in <Client> (<text>). Trying another release (attempt n+1 of 3)." |
| Automatic grab, 3rd failure in a row | `failed` "3 releases in a row failed in the download client; last: …"; block; `request_error` |
| Automatic grab, block not written (DB error, no release name) | `failed` as before; no next search |
| Hand-picked grab (interactive, approve with a pick, request-with-torrent, admin retry-download, reported-issue replace) or ebook grab | `failed` "Download failed in <Client> (<text>)"; block; `request_error`; never moves on |
| Not the release's fault (any grab) | `failed` naming the cause; **no block**; no next search |
| Not the request's newest selected download (an older monitor) | its own history row `failed` + block; request untouched, no search, no notification |
| Next search finds nothing usable, every indexer search answered | `failed` "Download failed; no other release found: <reason>" + one `request_error` |
| Next search finds nothing usable, an indexer search failed (#522) | `awaiting_search` as usual (chain ends; the scheduled re-search starts again at 0) |

- **Not the release's fault** (`isReleaseFault()`, case-insensitive client text): `no space left`, `disk is full`, `disk full`, `not enough space`, `unpack: space` (NZBGet), `permission denied`, `access is denied`, `read-only file system`, `missingfiles` (qBittorrent), `no data found` (Transmission), `missing or invalid torrent data` (Deluge), `no such file or directory`, `cannot find the path`, `cannot find the file`, `input/output error`, `transport endpoint is not connected`, `stale file handle`, `failed moving`; NZBGet `DELETED/MANUAL`, `FAILURE/MOVE`. These were blocked before #332.
- **Counter:** `clientFailures` in the `search_indexers` → `download_torrent` → `monitor_download` payloads. `search_indexers` always passes `?? 0`, so every search-made grab is automatic; absent on a download/monitor job = hand-picked. Any user/admin action queues jobs without it (reset). Cap `MAX_CLIENT_FAILURES` = 3.
- **Order:** guarded request write (0 rows = cancelled/deleted: nothing else) → history `failed` → block → next search → notify. Errors after the request write are handled inside (never the monitor's generic failure path); a search that can't be queued ends the request `failed`.
- **Double run:** the next search's Bull `jobId` is `next-release-<downloadHistoryId>`; Bull ignores a second add while that job is kept (completed jobs: last 100). A second `jobs` row is written pointing at the same Bull job.
- **qBittorrent:** the Web API gives no error text, so every `error` state counts as the release's fault; a full disk on qBittorrent can block up to 3 good releases per in-flight request. `/admin/blocklist` "Clear all" undoes it.
- **#409:** a chain that ends `failed` added a block, so shelf sync / watched lists replace the request at once (up to 3 grabs per sync until every candidate is blocked → `awaiting_search` "all blocked"). A not-the-release's-fault failure adds no block of its own, but an earlier attempt in the same chain may have, and then the replacement is immediate too.
- **Cap restarts** after an `awaiting_search` exit: a request can see more than 3 client failures in total; the blocklist still bounds it.
- **Left in the client:** earlier failed attempts (errored torrent and partial files, failed SAB/NZBGet history entry) stay; request delete removes only the newest selected download.

## Service API
**File:** `src/lib/services/blocklist.service.ts`
- `addAutoBlock(input)` — idempotent upsert; never throws; emits `JobEvent` (context `Blocklist.AutoBlock`).
- `isReleaseBlocked(requestId, name, hash?)` — single match-check (exact hash).
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
