# Library View

**Status:** ✅ Implemented | `GET /api/library` (list + live mode) and the `/library` page (#177)

## Overview
One list of everything in the configured Plex/Audiobookshelf library plus every audiobook requested through RMAB, each book shown once, with filters, facets, search, sort, author groups and a cheap live-poll mode. Read-only: no new capability for any user.

## Key Details
- **Route:** `src/app/api/library/route.ts`, `requireAuth` (all roles; refuses deleted/pending accounts). **Not** on `API_TOKEN_ALLOWED_ENDPOINTS`.
- **Engine:** `src/lib/library-view/` (kept apart from `src/lib/services/library/`, the backend adapters):
  - `service.ts` (full + live pipelines), `params.ts` (strict query parsing), `cursor.ts` (opaque keyset cursor), `loader.ts` (Prisma loads, live query), `snapshot.ts` (Load 1 cache), `memo.ts` (merged entries + query results), `merge.ts` (pure merge/derive), `query.ts` (pure filter/facets/sort/page/groups), `enrich.ts` (per-page covers/size/admin path), `serialize.ts` (the one gating choke point), `asin-rule.ts` (the ASIN rule), `types.ts` (exported response types), `constants.ts`.
- **Pipeline (full mode):** Load 1 (row snapshot) + requests version → merged entries and query result (memo) → page → page durations and enrichment → serialize per viewer.
- **Active library id:** ABS `audiobookshelf.library_id`, Plex `plex_audiobook_library_id` (bookdate/library pattern). Never `audiobookshelf.ebook_library_id`. None configured → 200 with RMAB entries only, `libraryConfigured:false`.

## Loads
- **Load 1 (`plex_library`, active id only):** id, plexGuid, title, author, narrator, duration, year, asin, addedAt, createdAt, cachedLibraryCoverPath. Never `file_path` (a real ABS folder since #495), `thumb_url` (Plex token), `summary`.
- **Load 2 (`requests`):** `where { type:'audiobook', deletedAt:null, status:{ not:'cancelled' } }` (route test asserts it). Includes requests of soft-deleted accounts (#503). Explicit select; never `file_format`, `ebook_auto_retry_count`, `custom_search_terms`, `placed_ebook_files`, `approval_bypassed_by`, `cancelled_at`, `auto_rerequest_count`. `libraryAsin`/`absItemId` are selected only for the cover rule and never serialized.
- **Versions (`loader.ts`):** `count:sum(hashtextextended(row(<columns>)::text, 0))` over committed rows (one raw SQL aggregate each, library id bound as a parameter).
  - `libraryRowsVersion(libraryId)`: exactly the `LIBRARY_ROW_SELECT` columns (`LIBRARY_ROW_COLUMNS`), never `updated_at`/`last_scanned_at`.
  - `libraryRequestsVersion()`: every `LIBRARY_REQUEST_SELECT` column of the qualifying requests joined to `users` and `audiobooks` (`LIBRARY_REQUEST_COLUMNS`). A test pins both column maps to the selects.
  - Moves on any insert, delete or change of a selected value, whatever `updated_at` says (late commits, same-millisecond writes, raw SQL). Misses a write only if two different contents give the same count and the same 64-bit hash sum (chance about 2^-64). Stays put for a write that changes nothing selected: the recently-added check stamping its 10 newest rows (`last_scanned_at`, `updated_at`), a scan rewriting a row unchanged.
- **Load 1 snapshot (`snapshot.ts`):** one slot (prepared rows: link/ASIN indexes, frozen scan-only entries) for `backend|libraryId` plus its version, read before the rows load.
  - Version moved: callers keep getting the current snapshot while **one rebuild per library** runs (no stampede). The call that notices a row change always returns the previous rows.
  - A write during a rebuild moves the version again; the next call starts the rebuild that sees it. A caller that finds a rebuild running joins it, and the rebuilt slot keeps the version read when that rebuild started.
  - **Staleness bound:** a write that lands after a rebuild's load began shows only once that rebuild and the next one finish: up to **two rebuild times plus the wait for the next call**. New rows showed after 1.2 s and 1.8 s at 30k rows on 2 CPUs (`177-library-perf`).
  - Only a library with no snapshot yet (first call, library switch) waits for its build; concurrent waits share it. A failed cold build is not cached.
  - **Failed rebuild:** the old rows are served and every call that sees the moved version retries the rebuild, each failure logged as a warning, until one succeeds.
  - **No TTL:** the key is the backend, the library id and the rows version, which is read in its own statement just before the rows load. It moves for any change to a selected column. The one case it cannot see: a value changed and changed back during one load (A to B to A). The slot then holds B under A's version until the next change. No current writer reverts a value (theoretical).
- **Merged-entries memo (`memo.ts`):** Load 2 + merge run once per (snapshot object, requests version); a request change moves the version, so the very next call merges again (the requests version is read per call, never shared, so a refetch right after an action sees it). The requests version is read before Load 2, so the same A to B to A case applies (`users` and `audiobooks` columns carry no stamp). Filtered/sorted results (`computeQuery`) memoized per query key (`queryKey`), LRU `QUERY_MEMO_SIZE` (16). Nothing in it depends on the viewer; gating stays in `enrich.ts`/`serialize.ts`.
- **Durations** of request-only books from `audible_cache` by ASIN: all of them once per merged copy for `sort=duration` (not with `group=author`); otherwise only the returned page's, each looked up once per copy and then kept. A duration that only `audible_cache` supplies stays as first loaded until the next request or row change.
- **Not cached (every full-mode call):** the requests version query, page enrichment (covers, sizes, admin path, `canFetchEbook`) and serialization. The rows version is single-flight per library id (`libraryRowsVersion`): a call arriving while that read runs awaits it, nothing is kept after it settles, so a burst of calls costs one row checksum scan (a joining call can miss a scan write committed during that read; the snapshot is already stale while it rebuilds). No rate limit (Known limits).
- The engine drops any non-`audiobook`, cancelled or deleted request again, so ebook rows never change a count.

## Merge rule (`merge.ts`, `asin-rule.ts`)
1. Group requests by `audiobook_id`; primary = latest `created_at`.
2. Stored link first: `plex_library.plex_guid` = `audiobooks.abs_item_id` or `audiobooks.plex_guid`.
3. Else the ASIN rule: `plex_library.asin` equal (case-insensitive), else an ASIN-shaped `audible_asin` found inside an alphanumeric run of `plex_guid` (case-insensitive). Ties among rows: Load 1 order (`id` asc).
4. A row absorbs one book: stored link beats ASIN, then the latest primary request, then audiobook id. Losers fold into the winner (not listed; debug log).
5. Unmatched books → request-only entries. Audiobook rows with no qualifying request (Report Issue, ebook-by-ASIN) are ignored, so their row stays `source:'scan'`.
6. In-library entries show library title/author/narrator/year/duration (NY-3) plus RMAB series; search matches both metadata sets.

| Case | `findPlexMatch` | Library rule |
|---|---|---|
| `asin` field equal, same case | match | match |
| `asin` field equal, case differs | no match (DB prefilter is case-sensitive) | **match** (divergence 1: case) |
| guid contains the ASIN, same case | match | match |
| guid contains the ASIN, case differs | no match | **match** |
| value not ASIN-shaped (not 10 alphanumerics) in guid | contains-match | no guid match (divergence 2) |
| row in another library id | match | ignored, active library only (divergence 3) |

## Ids, status, source
- `req_<audiobookId>` whenever the book has a qualifying request; `lib_<plexLibraryId>` for scan-only books. Stable for life; changes only when the request goes away (cancel/delete while in the library → `lib_`).
- `status`: `'available'` when in the library, else the primary request status. `progress` only in `on_the_way`.

| Group | Rule |
|---|---|
| `available` | library row present (any request status), or primary request `available` (also with no row, e.g. after a library switch) |
| `on_the_way` | `pending, awaiting_search, searching, downloading, processing, downloaded, awaiting_import` |
| `needs_approval` | `awaiting_approval` |
| `awaiting_release` | `awaiting_release` |
| `problem` | `failed, warn` (incl. "Removed from library") |
| `denied` | `denied` |

- Stats (unfiltered): `total`, `available`, `onTheWay`, `needsALook` = problem + needs_approval.
- Source: `scan` = in library with no qualifying request; `rmab` = has one.

## Query params (unknown value → 400 `ValidationError`)
| Param | Values | Default |
|---|---|---|
| `q` | ≤200 chars, folded (case/diacritics/whitespace); every token must match title/author/narrator/series | — |
| `status` | csv of the 6 groups, max 6 | all |
| `source` | `scan,rmab`, max 2 | all |
| `requestedBy` | csv of uuids, max 50; ids outside the requester universe dropped silently, never echoed; all dropped → no match | all |
| `hideAvailable` | `true`/`false` | `false` |
| `sort` / `order` | `added,title,author,year,duration,status` / `asc,desc` | `added`; natural order: added/year/duration desc, title/author/status asc |
| `group` | `none,author` (`author` forces author asc, title asc; `groups` covers the page's authors) | `none` |
| `cursor` | opaque; malformed → 400 `BadCursor`, other sort/order/group/filters → 400 `StaleCursor` | — |
| `limit` | 1-120 | 60 |
| `live` | `1` → live mode | — |

- `added` = library `added_at` (fallback row `created_at`) in the library, else request `created_at`. Status rank: problem, needs_approval, on_the_way, awaiting_release, available, denied. Nulls last; tiebreak entry id.
- Facets are disjunctive (each ignores its own filter); `hideAvailable` and `q` apply to all. `requestedBy` lists every requester in the universe (primary requesters of all entries), sorted by name, `deleted: true` on soft-deleted accounts (key omitted otherwise), keyed by user id.

## Response
- Full: `LibraryResponse { items, nextCursor, matched, stats, facets{status,source,requestedBy}, groups|null, viewer{isAdmin, canFetchEbook?}, backend, libraryConfigured }`; `LibraryItem` in `src/lib/library-view/types.ts`.
- `groups` (`group=author` only): one `{ key, label, count }` per author on **this page**, in page order; `count` and `label` are over every match, so a group split across pages has the same values on each. The client merges by `key`.
- Live (`?live=1`): `{ items:[{ id:'req_<audiobookId>', status, progress, updatedAt }], refreshMs }`. Reads live audiobook requests (index on `status`), then every qualifying request of those books (`loadBookRequests`, index on `audiobook_id`); no library rows, no merge. A book is listed only when its primary request (full mode's choice: newest `created_at`, ties by larger id) is the live one, so live and full report the same request. `refreshMs` 5000 while any `searching/downloading/processing`, 30000 otherwise, 0 when empty.
- **Live contract for the page:** live never overrides a card the list shows `inLibrary` (live reads no library rows, so a book just added to the library can still have a live request for a moment); an id that is in no loaded page (a book folded into another book's row, or not loaded yet) is ignored, never a reason to revalidate page 1 on every poll.
- **Live set** (`request-statuses.ts`): `LIVE_ALWAYS_STATUSES` pending/searching/downloading/processing; `LIVE_RECENT_STATUSES` downloaded/awaiting_import while `updatedAt` is within `LIVE_RECENT_WINDOW_MS` (15 min). Never awaiting_search/approval/release.

## Gating (serializer omits keys, never nulls them)
| Data | Admin | Requester | Other user |
|---|---|---|---|
| Book fields, status, progress, source, requester name/id, request id, `createdAt` | yes | yes | yes |
| `completedAt`, `errorMessage`, `downloadSizeBytes` | yes | yes | omitted |
| `path` | yes (ebook rule) | omitted | omitted |
| `viewer.canFetchEbook` | yes | omitted | omitted |
| History | `GET /api/requests/[id]` | `GET /api/requests/[id]` (owner select) | 403 there |

- `canSeeRequestDetails` = has a request and (admin or own); UI hint only.

## Page enrichment (returned page only)
- **Covers, in-library:** the row's cached cover (`libraryCoverUrl`); for a followed ABS book (primary `available` + `absItemId` + `libraryAsin`) only when the file name carries the library ASIN (`followedCoverUrl`, [fixes/file-hash-matching.md](../fixes/file-hash-matching.md)); then `audible_cache` by the **row's** ASIN; then the stored request cover only when the request ASIN equals the row's; else null. Never the requested edition's cover for a rematched book.
- **Covers, request-only:** stored `cover_art_url`, then `audible_cache` by ASIN, else null.
- **Size** (admin/requester): latest selected `download_history.torrent_size_bytes` (`orderBy createdAt desc`), sent as a string.
- **Admin path:** `audiobooks.file_path` only if no `type='ebook'` request on that audiobook (any parent, deleted or not) has status in `processing, downloaded, available, awaiting_import, warn`; else null. Reason: the ebook organize overwrites the shared row's `file_path`/`file_format` (organize-files.processor.ts ~899-908). Scan-only books: null (no library path is ever sent).

## Shared constants (`src/lib/constants/request-statuses.ts`)
- `SEARCHABLE_STATUSES` (manual-search route, admin dropdown), `EBOOK_FETCHABLE_STATUSES` (fetch-ebook route, admin dropdown), live sets + window.
- `ebookSourcesEnabled()` (`src/lib/services/ebook-sources.ts`): one rule for `viewer.canFetchEbook`, the ebook-status route, the admin fetch-ebook route (`requests/[id]/fetch-ebook`) and find-missing-ebooks (legacy `ebook_sidecar_enabled` fallback). Same answer as the old direct reads for every value the settings page writes (`true`/`false`). Reads through the config service, which answers null on a database error or for an empty value; null on the Anna's Archive key falls back to the legacy key, otherwise a failed read counts as off. `audiobooks/[asin]/fetch-ebook` keeps its own copy of the rule (unchanged).

## Page (`/library`)
- **Files:** `src/app/library/page.tsx` (Suspense > ProtectedRoute > ToastProvider > Header + `LibraryView`); components in `src/components/library/`; hooks `src/lib/hooks/useLibraryQuery.ts`, `useLibrary.ts`, `useLibraryRequestDetail.ts`. Cover art: `src/components/audiobooks/BookCover.tsx` (shared with `AudiobookCard`).
- **Layout:** stats header (h1 "Library", Live pill while live polling runs, 4 tiles), search + sort + Group None/Author toolbar, filter rail (`aside`, ≥1024 px) or Filters bottom sheet (`FilterSheet`, below 1024), active chips + Clear all, cover grid (`getGridClasses` + card size pref), Load more (60 per page). Grouped: one header per author run (split across pages → one header), sort select shows "Author A to Z" and is disabled.
- **URL** (`router.replace`, `scroll:false`, never push; fixed order, defaults left out): `q` (300 ms debounce, max 200), `status`, `source`, `requestedBy` (uuids, max 50; ids the facets do not list are dropped), `sort`, `group`. Invalid values are dropped on read, not sent. A URL the page did not write (header Library link while on `?q=x`) is adopted. **Clear all** clears search, filters and the Hide available pref; sort and group stay.
- **Prefs:** waits for `PreferencesContext.hydrated` before the first fetch, so a saved `hideAvailable` never costs a default-key fetch. `hideAvailable` is sent as `hideAvailable=true`.
- **List (`useSWRInfinite`):** key `libraryListKey(query, hideAvailable)`; `revalidateFirstPage:false`, focus/reconnect off, `keepPreviousData`. Mount with a cached key → `mutate()` (returning to a cached filter or page reloads). `StaleCursor`/`BadCursor` → back to page 1. 4xx no retry; 5xx up to 2 retries with backoff. Previous data shown while a new key loads (`lagging`); a failed new key keeps the old grid with an error bar.
- **Live overlay:** `useSWR('/api/library?live=1')` only after the first page; `refreshInterval` = response `refreshMs` (0 stops it), focus revalidates. Live progress/status applied over loaded items (`applyLive`). **Settle:** a live id leaving, or a status-group move (once per id:status), schedules one list revalidation after 1 s + 0-1 s jitter, coalesced.
- **Actions** (`library-actions.ts`, a UI hint from the API's `viewer` + `request.isMine`; every endpoint runs its own check):

| Action | Shown when | Endpoint |
|---|---|---|
| Search again | admin, status in `SEARCHABLE_STATUSES` | POST `/api/requests/{id}/manual-search` |
| Interactive search | admin or own request, status in `ADVANCEABLE_FROM_INTERACTIVE_SEARCH`, user's `permissions.interactiveSearch` not false | `InteractiveTorrentSearchModal` (enabled once `customSearchTerms` is loaded) |
| Fetch ebook | admin, `viewer.canFetchEbook`, status in `EBOOK_FETCHABLE_STATUSES` | POST `/api/requests/{id}/fetch-ebook` |
| View request | `canSeeRequestDetails` | admin `/admin?search=<title>&type=audiobook`, requester `/requests` |

- After an action: toast + bound `mutate()` (every loaded page refetches) + live revalidate. Refused action → route `error`/`message` as an error toast.
- **Detail (`LibraryDetail` in `LibraryDialog`):** keeps a snapshot of the opened book, so it stays open when an action or refresh moves the book out of the current filter; closes only by the viewer (Esc, backdrop, close button). Rows: "In your library" (Path row only when the API sent `path`; dash when null), Files (download size), Request history and Actions only when `canSeeRequestDetails`. History from GET `/api/requests/{id}` through a whitelist (`pickRequestHistory`: customSearchTerms, requestedAt, completedAt, download indexer/release/client/times, jobs); polled every 5 s only while the book is live. Other users see public fields only and no request detail call.
- **Dialog:** portal, backdrop `z-[45]` (above header z-40, below toasts z-50), focus in / Tab trap / focus back to opener, body scroll lock; Esc and the trap pause while a child dialog (interactive search) is open, and the lock is set again when it closes.
- **States:** total 0 → "Nothing here yet" (Find a book; admin: Scan library now = trigger the scheduled library scan job, falls back to a link to `/admin/jobs`); matched 0 → "No books match" + Clear search and filters; first load failed → error + Retry; `libraryConfigured:false` → admin-only notice linking `/admin/settings?tab=library`.
- **Header:** Library link before My Requests (signed in). Desktop nav from 1024 px (`lg`), hamburger menu below; username shown from 1280 px (`xl`), so an admin header never overflows at 1024.

## Known limits
- Format is never shown (`audiobooks.file_format` is overwritten by the ebook organize); no library path; ASIN drift (#284) can show a book twice; series only on RMAB books; one active library.
- Load 1 and Load 2 are separate reads (no shared transaction): a scan landing between them, or a library change still being rebuilt, can show a just-delivered book as request-only (status `available`) until the rebuild lands.
- Only the first full call for a library (process start, library switch) waits for the row load and prepare: 0.7-1.0 s at 10k rows on 2 CPUs (`177-library-perf`). Every later row change is rebuilt in the background while callers get the previous snapshot. A request change makes the next call reload the requests and merge again (the perf window ticks request progress every 5 s, so its full-mode figures include these re-merges).
- No rate limit: a signed-in client looping on distinct queries still costs one filter/sort pass over every entry per new query key, and every full call runs the requests version query, enrichment and serialization (the rows version read is shared by concurrent calls).
- Page: request history shows only stored steps (jobs, latest download); no format row; the login redirect drops the `/library` query string.
- Budgets (`177-library-perf`, 10k rows): met on a quiet 2-CPU host; a host busy with other work (transcodes, other containers) runs slower, and live p95 and event-loop lag grow faster than the slowdown. The spec voids its own run when its idle and stress figures show a busy host.

## Related: [fixes/file-hash-matching.md](../fixes/file-hash-matching.md), [backend/database.md](../backend/database.md), [integrations/ebook-sidecar.md](../integrations/ebook-sidecar.md)
