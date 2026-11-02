# Goodreads & Shelf Sync

**Status:** ✅ Implemented | RSS feed parsing, shared sync core, extensible provider architecture. ⚠️ Goodreads no longer serves shelf RSS feeds (404 as of 2026-11-02; see [Feeds Ended](#feeds-ended-514))

## Overview
Syncs user-subscribed Goodreads shelves via RSS feeds, resolves books to Audible ASINs, and creates requests. Also documents the shared shelf sync core used by all providers.

## Architecture

### Files
- `src/lib/services/goodreads-sync.service.ts` — RSS fetch/parse, delegates to shared core
- `src/lib/utils/goodreads-rss-url.ts` — Feed URL rules (`toGoodreadsRssUrl`, `isGoodreadsHttpsUrl`); client-safe, also used by `AddShelfModal` / `ManageShelfModal`
- `src/lib/utils/goodreads-rss-url.schema.ts` — `goodreadsRssUrlSchema` (zod) for POST/PATCH bodies
- `src/lib/services/goodreads-shelf-match.ts` — `findShelfWithSameFeed()` duplicate lookup by normalised URL, `isUniqueConstraintError()`
- `src/lib/services/shelf-sync-core.service.ts` — Shared sync logic (Audible lookup, cover enrichment, request creation)
- `src/lib/utils/shelf-helpers.ts` — Shared `processBooks()` utility for cover URL parsing
- `src/lib/hooks/createShelfHooks.ts` — Generic hook factory for shelf CRUD operations
- `src/app/api/user/goodreads-shelves/route.ts` — GET (list) + POST (add) routes
- `src/app/api/user/goodreads-shelves/[id]/route.ts` — DELETE + PATCH routes
- `src/app/api/user/shelves/route.ts` — Combined GET for all providers (GenericShelf shape)
- `src/lib/hooks/useGoodreadsShelves.ts` — Frontend hooks (via `createShelfHooks` factory)
- `src/components/profile/GoodreadsFeedEndedNotice.tsx` — Feeds-ended notice on every Goodreads shelf card (`ShelvesSection`)

### Database Models
- **GoodreadsShelf** — Per-user shelf subscription (`userId`, `rssUrl`, `name`, `lastSyncAt`, `bookCount`, `coverUrls`)
- **BookMapping** — Shared table for all providers. Keyed by `provider` + `externalBookId`. Caches Audible ASIN lookups.

## Goodreads RSS Feed
- **Format:** `https://www.goodreads.com/review/list_rss/{userId}?shelf={shelfName}`
- **Auth:** None required (public RSS)
- **Allowed URLs:** `https://` + host `goodreads.com` or `www.goodreads.com` (no port, no credentials) + path `/review/list_rss/`. Normalised to `https://www.goodreads.com/review/list_rss/...` (http:// and bare `goodreads.com` accepted and rewritten); POST/PATCH store the normalised form, older stored rows are normalised at fetch time (not rewritten). Anything else → 400 `{ error: 'ValidationError', message }` on POST/PATCH; sync refuses it too
- **Duplicates:** POST/PATCH compare normalised feed URLs against the user's shelves (PATCH excludes itself) → 409 `DuplicateShelf`; a racing insert/update (Prisma P2002) → 409 too
- **Redirects:** axios `maxRedirects: 0`; up to 3 redirects followed by hand, each target must be an https Goodreads host before it is requested
- **Parsing:** `fast-xml-parser` extracts `item` entries with `book_id`, `title`, `author_name`, `book_image_url`

### Feeds Ended (#514)
- Goodreads answers every `review/list_rss/...` (and `user/updates_rss/...`) with **404**; the HTML shelf page redirects anonymous clients to sign-in, so scraping would need the user's Goodreads login (not done)
- **Fetch:** a 404/410 page throws `GoodreadsFeedEndedError` (`goodreads-rss-url.ts`, `.status`); `validateStatus` admits 404/410 so axios hands them back instead of a generic error. Other statuses unchanged
- **Add (POST):** → 400 `{ error: 'GoodreadsFeedsEnded', message: GOODREADS_FEEDS_ENDED_ADD_MESSAGE }`, nothing saved. Other feed failures keep 400 `InvalidRSS` "Could not fetch or parse the RSS feed: ..."
- **Sync:** an ended feed counts in `stats.errors`, logs per shelf at debug only, then one `warn` per run: `Goodreads no longer serves shelf RSS feeds: N shelf(s) skipped (HTTP 404/410)...`. No shelf write (`lastSyncAt` stays). Other fetch failures still log `error` per shelf. Hardcover sync unchanged
- **UI:** every Goodreads shelf card shows `GoodreadsFeedEndedNotice` (`GOODREADS_FEEDS_ENDED_NOTICE`, `role="note"`) as its own full-width row under the title/actions row (not in the info column, so it stays readable at 375 px). Unconditional: `GoodreadsShelf` stores no sync error, so no schema change
- **UI status:** Goodreads cards get a neutral (gray) sync dot, and a never-synced one shows "Never synced" instead of the pulsing "Syncing..." and cover skeletons. Hardcover status unchanged
- **Add Shelf modal:** the Goodreads tab (still the default) shows the notice with `GOODREADS_FEEDS_ENDED_ADD_MESSAGE` before submitting; hidden while the add error already shows that text
- Code and shelves are kept in case Goodreads brings the feeds back; then drop the notice

## Shared Sync Core

`shelf-sync-core.service.ts` contains all provider-agnostic sync logic:

### Interface: `ShelfBook`
```typescript
{ bookId: string; title: string; author: string; coverUrl?: string }
```

### Function: `processShelfBooks()`
Accepts provider-agnostic book list + context, performs:
1. **BookMapping lookup** — Check if book already resolved (`provider` + `externalBookId`)
2. **Audible search** — Full query (`title author`), fallback with cleaned title (strips parenthetical series info) only when the search found nothing; pick via `pickSearchMatch` (filter on and first result in another language: a later result with an explicit accepted language + title share >= 0.8, else noMatch; [audible-language-filter.md](../../integrations/audible-language-filter.md))
3. **noMatch retry** — Re-searches after `NO_MATCH_RETRY_DAYS` (7 days)
4. **Request creation** — Calls `createRequestForUser(..., { automatic: true })` for matched ASINs: never replaces a cancelled request; failed/warn ones on a backoff ([release-blocklist.md](../../admin-features/release-blocklist.md#automatic-re-requests-409))
5. **Cover enrichment** — Queries `audibleCache` for cached covers, builds `/api/cache/thumbnails/` URLs
6. **Shelf metadata update** — Writes `lastSyncAt`, `bookCount`, top 8 books as JSON to `coverUrls`

### Deleted Users (#504)
- Both providers drop shelves whose user is soft-deleted (`User.deletedAt` set) right after the load (`withoutDeletedUsers()`, `src/lib/utils/deleted-user-skip.ts`): no feed/list fetch, no Audible lookup, no request, no shelf write. Also for a `userId`- or `shelfId`-scoped run
- One info line per provider when any are skipped: `Skipped N Goodreads shelf(s)|Hardcover list(s) whose user is deleted`
- Rows and existing requests are kept (a user delete is a soft delete)

### Constants
- `DEFAULT_MAX_LOOKUPS_PER_SHELF` = 10 (per scheduled cycle; 0 = unlimited for manual triggers)
- `NO_MATCH_RETRY_DAYS` = 7

### Hook Factory: `createShelfHooks(endpoint)`
Returns `{ useList, useAdd, useDelete, useUpdate }` — all with SWR caching, optimistic updates, and automatic revalidation of the combined `/api/user/shelves` endpoint.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/user/goodreads-shelves` | List user's Goodreads shelves |
| POST | `/api/user/goodreads-shelves` | Add shelf (validates RSS feed, triggers sync) |
| DELETE | `/api/user/goodreads-shelves/[id]` | Remove shelf (ownership check) |
| PATCH | `/api/user/goodreads-shelves/[id]` | Update RSS URL (triggers re-sync) |
| GET | `/api/user/shelves` | Combined endpoint — merges all providers into `GenericShelf` |

## Adding a New Provider
1. Create Prisma shelf model + migration (BookMapping table is already shared)
2. Create API client service for the external data source
3. Create thin sync service (~50-80 lines) that fetches books and calls `processShelfBooks()`
4. Create API routes (or use a generic route handler)
5. Create hook file (~40 lines) using `createShelfHooks(endpoint)`
6. Add tab in `AddShelfModal` with provider-specific form fields

## Fixed Issues
- **#514 Goodreads shelf feeds return 404:** Goodreads ended shelf RSS. Adding a shelf showed a generic "Could not fetch or parse the RSS feed" error, existing shelves silently stopped updating, and every sync logged one error per shelf. Now: a clear add message, a notice on every Goodreads shelf, one warning per sync run ([Feeds Ended](#feeds-ended-514))

## Related
- [Hardcover sync](hardcover-sync.md)
- [Background jobs](jobs.md)
- [Scheduler](scheduler.md)
