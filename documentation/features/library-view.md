# Library View

**Status:** ⏳ In Progress | API done (`GET /api/library`, list + live mode); the `/library` page lands in a later PR (#177)

## Overview
One list of everything in the configured Plex/Audiobookshelf library plus every audiobook requested through RMAB, each book shown once, with filters, facets, search, sort, author groups and a cheap live-poll mode. Read-only: no new capability for any user.

## Key Details
- **Route:** `src/app/api/library/route.ts`, `requireAuth` (all roles; refuses deleted/pending accounts). **Not** on `API_TOKEN_ALLOWED_ENDPOINTS`.
- **Engine:** `src/lib/library-view/` (kept apart from `src/lib/services/library/`, the backend adapters):
  - `service.ts` (full + live pipelines), `params.ts` (strict query parsing), `cursor.ts` (opaque keyset cursor), `loader.ts` (Prisma loads, live query), `merge.ts` (pure merge/derive), `query.ts` (pure filter/facets/sort/page/groups), `enrich.ts` (per-page covers/size/admin path), `serialize.ts` (the one gating choke point), `asin-rule.ts` (the ASIN rule), `types.ts` (exported response types), `constants.ts`.
- **Pipeline (full mode):** load (one RepeatableRead transaction) → merge → derive → filter/facet/sort/page → page enrichment → serialize per viewer.
- **Active library id:** ABS `audiobookshelf.library_id`, Plex `plex_audiobook_library_id` (bookdate/library pattern). Never `audiobookshelf.ebook_library_id`. None configured → 200 with RMAB entries only, `libraryConfigured:false`.

## Loads
- **Load 1 (`plex_library`, active id only):** id, plexGuid, title, author, narrator, duration, year, asin, addedAt, createdAt, cachedLibraryCoverPath. Never `file_path` (a real ABS folder since #495), `thumb_url` (Plex token), `summary`.
- **Load 2 (`requests`):** `where { type:'audiobook', deletedAt:null, status:{ not:'cancelled' } }` (route test asserts it). Includes requests of soft-deleted accounts (#503). Explicit select; never `file_format`, `ebook_auto_retry_count`, `custom_search_terms`, `placed_ebook_files`, `approval_bypassed_by`, `cancelled_at`, `auto_rerequest_count`. `libraryAsin`/`absItemId` are selected only for the cover rule and never serialized.
- **Durations** of request-only books from `audible_cache` by ASIN (duration sort).
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
| `asin` field equal, case differs | no match (DB prefilter is case-sensitive) | **match** (the one documented divergence) |
| guid contains the ASIN, same case | match | match |
| guid contains the ASIN, case differs | no match | **match** |
| value not ASIN-shaped (not 10 alphanumerics) in guid | contains-match | no guid match |
| row in another library id | match | ignored (active library only) |

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
| `group` | `none,author` (`author` forces author asc, title asc) | `none` |
| `cursor` | opaque; malformed → 400 `BadCursor`, other sort/order/group/filters → 400 `StaleCursor` | — |
| `limit` | 1-120 | 60 |
| `live` | `1` → live mode | — |

- `added` = library `added_at` (fallback row `created_at`) in the library, else request `created_at`. Status rank: problem, needs_approval, on_the_way, awaiting_release, available, denied. Nulls last; tiebreak entry id.
- Facets are disjunctive (each ignores its own filter); `hideAvailable` and `q` apply to all. `requestedBy` lists every requester in the universe (primary requesters of all entries), sorted by name, `deleted: true` on soft-deleted accounts (key omitted otherwise), keyed by user id.

## Response
- Full: `LibraryResponse { items, nextCursor, matched, stats, facets{status,source,requestedBy}, groups|null, viewer{isAdmin, canFetchEbook?}, backend, libraryConfigured }`; `LibraryItem` in `src/lib/library-view/types.ts`.
- Live (`?live=1`): `{ items:[{ id:'req_<audiobookId>', status, progress, updatedAt }], refreshMs }`. Reads only live audiobook requests (index on `status`), no library rows, no merge. One item per book (latest request). `refreshMs` 5000 while any `searching/downloading/processing`, 30000 otherwise, 0 when empty.
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
- `ebookSourcesEnabled()` (`src/lib/services/ebook-sources.ts`): one rule for ebook-status route and find-missing-ebooks (legacy `ebook_sidecar_enabled` fallback).

## Known limits
- Format is never shown (`audiobooks.file_format` is overwritten by the ebook organize); no library path; ASIN drift (#284) can show a book twice; series only on RMAB books; one active library.

## Related: [fixes/file-hash-matching.md](../fixes/file-hash-matching.md), [backend/database.md](../backend/database.md), [integrations/ebook-sidecar.md](../integrations/ebook-sidecar.md)
