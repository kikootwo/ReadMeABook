# Hardcover Shelf Sync

**Status:** ✅ Implemented | GraphQL API integration, Audible ASIN resolution, automated request creation

## Overview
Syncs user-subscribed Hardcover lists via their GraphQL API, resolves books to Audible ASINs, and creates audiobook requests automatically.

## Architecture

### Files
- `src/lib/services/hardcover-api.service.ts` — GraphQL queries, `fetchHardcoverList()`
- `src/lib/services/hardcover-sync.service.ts` — Provider-specific orchestration, delegates to shared core
- `src/lib/services/shelf-sync-core.service.ts` — Shared sync logic (Audible lookup, cover enrichment, request creation)
- `src/app/api/user/hardcover-shelves/route.ts` — GET (list) + POST (add) routes
- `src/app/api/user/hardcover-shelves/[id]/route.ts` — DELETE + PATCH routes
- `src/lib/hooks/useHardcoverShelves.ts` — Frontend hooks (via `createShelfHooks` factory)

### Database Models
- **HardcoverShelf** — Per-user list subscription (`userId`, `listId`, encrypted `apiToken`, `name`, `lastSyncAt`, `bookCount`, `coverUrls`)
- **BookMapping** — Shared across all providers. Keyed by `provider` + `externalBookId`. Caches Audible ASIN resolution (`audibleAsin`, `noMatch`, `lastSearchAt`)

## Hardcover API

- **Endpoint:** `https://api.hardcover.app/v1/graphql` (Hasura-based)
- **Auth:** Bearer token in Authorization header
- **Username type:** `citext` (case-insensitive text) — use `$username: citext!` in GraphQL variables

### Query Strategies (custom lists)
| Input | Strategy | Query root |
|---|---|---|
| URL with `@username` | Scoped to that user | `users(where: {username: {_eq: $username}}) { lists(...) }` |
| Bare slug (no username) | Authenticated user's own list | `me { lists(where: {slug: {_eq: $slug}}) }` |
| Numeric ID | Global lookup (IDs are unique) | `lists(where: {id: {_eq: $listId}})` |

### Status Lists
- Prefix: `status-{id}` (e.g., `status-1`)
- Query: `me { user_books(where: {status_id: {_eq: $statusId}}) }`
- Status IDs: 1=Want to Read, 2=Currently Reading, 3=Read, 4=Did Not Finish

## Sync Flow
1. Fetch shelves from DB (all or specific `shelfId`)
2. Decrypt API token (encryption service)
3. Fetch books from Hardcover GraphQL API
4. Delegate to `processShelfBooks()` in shelf-sync-core (Audible lookup, request creation, cover enrichment)
5. Update shelf metadata (`lastSyncAt`, `bookCount`, `coverUrls`)

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/user/hardcover-shelves` | List user's shelves with book counts/covers |
| POST | `/api/user/hardcover-shelves` | Add new shelf (validates via API fetch, encrypts token, triggers sync) |
| DELETE | `/api/user/hardcover-shelves/[id]` | Remove shelf (ownership check) |
| PATCH | `/api/user/hardcover-shelves/[id]` | Update listId/apiToken (triggers re-sync on change) |

## Key Details
- **Token cleanup:** Strips `Bearer ` prefix if user pastes it
- **Duplicate check:** Unique constraint on `(userId, listId)`
- **Immediate sync:** POST and PATCH trigger `addSyncShelvesJob()` with unlimited lookups
- **Scheduled sync:** Runs via `sync_reading_shelves` job (default: max 10 lookups/shelf/cycle)
- **Cover data:** Stores top 8 books as JSON in `coverUrls` field for shelf card display

## Related
- [Shelf sync core (shared logic)](goodreads-sync.md#shared-sync-core)
- [Background jobs](jobs.md)
- [Scheduler](scheduler.md)
