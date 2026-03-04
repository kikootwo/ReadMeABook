# Goodreads & Shelf Sync

**Status:** ✅ Implemented | RSS feed parsing, shared sync core, extensible provider architecture

## Overview
Syncs user-subscribed Goodreads shelves via RSS feeds, resolves books to Audible ASINs, and creates requests. Also documents the shared shelf sync core used by all providers.

## Architecture

### Files
- `src/lib/services/goodreads-sync.service.ts` — RSS fetch/parse, delegates to shared core
- `src/lib/services/shelf-sync-core.service.ts` — Shared sync logic (Audible lookup, cover enrichment, request creation)
- `src/lib/utils/shelf-helpers.ts` — Shared `processBooks()` utility for cover URL parsing
- `src/lib/hooks/createShelfHooks.ts` — Generic hook factory for shelf CRUD operations
- `src/app/api/user/goodreads-shelves/route.ts` — GET (list) + POST (add) routes
- `src/app/api/user/goodreads-shelves/[id]/route.ts` — DELETE + PATCH routes
- `src/app/api/user/shelves/route.ts` — Combined GET for all providers (GenericShelf shape)
- `src/lib/hooks/useGoodreadsShelves.ts` — Frontend hooks (via `createShelfHooks` factory)

### Database Models
- **GoodreadsShelf** — Per-user shelf subscription (`userId`, `rssUrl`, `name`, `lastSyncAt`, `bookCount`, `coverUrls`)
- **BookMapping** — Shared table for all providers. Keyed by `provider` + `externalBookId`. Caches Audible ASIN lookups.

## Goodreads RSS Feed
- **Format:** `https://www.goodreads.com/review/list_rss/{userId}?shelf={shelfName}`
- **Auth:** None required (public RSS)
- **Parsing:** `fast-xml-parser` extracts `item` entries with `book_id`, `title`, `author_name`, `book_image_url`

## Shared Sync Core

`shelf-sync-core.service.ts` contains all provider-agnostic sync logic:

### Interface: `ShelfBook`
```typescript
{ bookId: string; title: string; author: string; coverUrl?: string }
```

### Function: `processShelfBooks()`
Accepts provider-agnostic book list + context, performs:
1. **BookMapping lookup** — Check if book already resolved (`provider` + `externalBookId`)
2. **Audible search** — Full query (`title author`), fallback with cleaned title (strips parenthetical series info)
3. **noMatch retry** — Re-searches after `NO_MATCH_RETRY_DAYS` (7 days)
4. **Request creation** — Calls `createRequestForUser()` for matched ASINs
5. **Cover enrichment** — Queries `audibleCache` for cached covers, builds `/api/cache/thumbnails/` URLs
6. **Shelf metadata update** — Writes `lastSyncAt`, `bookCount`, top 8 books as JSON to `coverUrls`

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

## Related
- [Hardcover sync](hardcover-sync.md)
- [Background jobs](jobs.md)
- [Scheduler](scheduler.md)
