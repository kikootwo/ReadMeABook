# Watched Authors & Series

**Status:** ✅ Implemented | Per-user author/series watches that auto-request books; Entire catalog or New releases only (#302)

## Overview
A user watches an author (author page) or series (series page). The `check_watched_lists` job scans each watched author/series on Audible and requests books that aren't in the library, through `createRequestForUser(..., { automatic: true })`. Each watch is either **Entire catalog** (default) or **New releases only**.

## Data Model (`prisma/schema.prisma`)
| Table | Fields |
|---|---|
| `watched_series` | `id`, `user_id` (FK, cascade), `series_asin`, `series_title`, `cover_art_url?`, `last_checked_at?`, `new_releases_since?`, `created_at`, `updated_at`; unique `(user_id, series_asin)` |
| `watched_authors` | same with `author_asin`, `author_name`; unique `(user_id, author_asin)` |
- `new_releases_since` (DateTime, nullable): **null = Entire catalog** (every watch made before #302); a date = New releases only, cutoff = moment the option was picked. Added by the startup `prisma db push`, no migration file.

## API (`src/app/api/user/watched-{authors,series}/`)
JWT sessions only; not on the API-token allowlist (`src/lib/constants/api-tokens.ts`).
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/user/watched-authors` | - | `{authors: [{id, authorAsin, authorName, coverArtUrl, lastCheckedAt, newReleasesOnly, newReleasesSince, createdAt}]}` |
| POST | `/api/user/watched-authors` | `{authorAsin, authorName, coverArtUrl?, newReleasesOnly?}` | 201; 409 `AlreadyWatching`; `newReleasesOnly: true` stores cutoff = now; queues the immediate targeted check either way |
| PATCH | `/api/user/watched-authors/[id]` | `{newReleasesOnly: boolean}` (strict) | 400/404/403; Entire→New: cutoff = now; New→New: cutoff kept; New→Entire: null. **Queues no job** |
| DELETE | `/api/user/watched-authors/[id]` | - | ownership check |
Series routes are identical with `seriesAsin`, `seriesTitle`, response key `series`.
- Helpers: `src/lib/utils/watch-mode.ts` (`nextNewReleasesSince`, `watchModeFields`, `newReleaseFloorDay`, `isNewRelease`).

## Sync Flow (`src/lib/services/watched-lists.service.ts`)
- Job `check_watched_lists`: daily `0 0 * * *` (scheduler) + targeted run on POST (`addCheckWatchedItemJob(userId, seriesAsin?, authorAsin?)`).
- **Targeted run (#429):** a run with `seriesAsin` runs only the series pass for that series; with `authorAsin` only the author pass. It never re-checks the user's other watched lists. Scheduled runs (no ASIN) run both passes.
- Grouped by ASIN: one scan per series/author serves all its watchers; 2 s between series/authors.
- **Series:** `scrapeSeriesPage()` pages up to 200 books (series order, no early stop; the scraper has no newest-first order) → dedup → per watcher `booksForWatch()` → requests.
  - **Limit:** a series with more than 200 books is only checked through its first 200 in series order, so a new-only watch can miss its newest books; such a run logs one warning per series (only when it has a new-only watcher).
- **Authors** (`src/lib/services/watched-lists-releases.ts` `scanAuthorLegs`):
  - Entire-catalog watchers: relevance scan as before (`searchByAuthorAsin` without sort), ≤4 pages of 50 raw products, stops at a page with no matching books.
  - New-only watchers: separate newest-first scan (`searchByAuthorAsin(..., { newestFirst: true })` → `products_sort_by=-ReleaseDate`), stops after the first page holding a book older than the earliest new-only cutoff's floor day, or when `totalResults <= page*50`; a page with no matching books (namesakes, other languages) doesn't end it; ≤4 pages.
  - An author with only entire-catalog watchers gets exactly the old scan. A mixed group gets both scans, each watcher fed from its own, unless the relevance scan read the whole catalog (Audible reported no more pages within the cap): then the new-only watchers are fed from it (`booksForWatch` applies each cutoff) and no newest-first call is made.
  - Dedup groups of the two scans are persisted one after the other (`dedupeAndPersist(books, after)`), never concurrently.
- Owned check: library ASIN + works-table siblings. Then `createRequestForUser` (cancelled requests never replaced; failures back off: [release-blocklist.md](../admin-features/release-blocklist.md#automatic-re-requests-409)).
- Stats: `seriesChecked, authorsChecked, booksFound, requestsCreated, skippedOwned, skippedExisting, skippedBeforeCutoff, errors`.

## New Releases Only: Cutoff Rules
- Requested iff `toReleaseDay(book.releaseDate) >= newReleaseFloorDay(newReleasesSince)` = cutoff's **UTC day minus one** (one day of grace keeps "from today on" true for evening watches in the Americas). Future dates (preorders) count.
- **Undated books are skipped** (counted in `skippedBeforeCutoff`; one log line per watch with older/undated counts). Without seen-rows, treating undated as new would request the whole backlog whenever a series page comes back in the legacy layout (no dates). A skipped book is picked up on a later run that gets a dated layout; a book that is never dated is never auto-requested (request it by hand).
- Date sources: catalog `release_date` `YYYY-MM-DD`; modern series row JSON `releaseDate` `YYYY-MM-DD`; legacy series rows have no parsed date (label `MM-DD-YY` not read); Audnexus `releaseDate` ISO datetime (details only). `toReleaseDay()` (`src/lib/utils/release-date.ts`) accepts ISO date/datetime/Date only, anything else → null.
- **Re-listings can count as new:** an old book relisted under a new ASIN with a new release date (publisher move, back catalogue newly added) can be requested under new-only. Dedup runs before the cutoff, so the copy kept after duplicates are merged decides.
- Switching a watch to new-only does not cancel requests already made. Switching back to entire catalog requests the backlog on the next watched-list check run (the dialog warns: "The next watched-list check requests every book …").

## UI
- `src/components/ui/WatchButton.tsx`: Watch confirm dialog (author + series pages) holds `WatchModeChoice`; Entire catalog preselected each open.
- `src/components/ui/WatchModeChoice.tsx`: `<fieldset>` "What should be requested?" with two native radios (`useId()` name, checked radio autofocused); amber `aria-live="polite"` backlog note when changing New → Entire.
- `src/components/profile/WatchModeControl.tsx`: on Profile's watched cards (`WatchedListsSection.tsx`), "Entire catalog" / "New releases since <date>" (cutoff's UTC day) + bordered **Change** button → `ConfirmModal` with "Save" (disabled until the selection changes) → PATCH.
- Hooks: `useWatchedAuthors.ts` / `useWatchedSeries.ts` (`useAdd…(…, newReleasesOnly)`, `useUpdateWatched…().setNewReleasesOnly(id, bool)`).

## Critical Issues
- **Downgrade:** an older image's `db push --accept-data-loss` drops `new_releases_since`; every new-only watch then reads as entire catalog and the next run requests its backlog. Before going back: turn off "Check Watched Lists" in Admin → Jobs, then remove or switch the new-only watches.
- **Safe code revert:** keep the column and add `newReleasesSince: null` to both watch `findMany` calls, so new-only watches pause instead of requesting their backlog.

## Related: [integrations/audible.md](../integrations/audible.md), [backend/services/jobs.md](../backend/services/jobs.md), [backend/database.md](../backend/database.md)
