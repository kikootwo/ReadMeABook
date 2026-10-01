# Author Blacklist

**Status:** ✅ Implemented | Global admin list, name-based, blocks requests.

## Overview
Admins maintain a global author blacklist by name. User/auto audiobook request paths reject matching authors with message: `This author is blocked by the administrator`. Admin import routes are exempt.

## Match Rules
- Key: `trim().toLowerCase()` of blocked `authorName` → `authorKey` (unique).
- Book author field: split on commas, normalize each segment; block if any segment equals a blacklisted key.
- No substring match (avoids `"Stephen"` blocking `"Stephen King"`).
- No ASIN matching.

## Data Model
**Table:** `blocked_authors` ([backend/database.md](../backend/database.md))

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `authorName` | string | Display as entered |
| `authorKey` | string unique | Normalized lookup |
| `createdById` | UUID? | Admin who added; `onDelete: SetNull` |
| `createdAt` | timestamp | |

## Service API
**File:** `src/lib/services/author-blacklist.service.ts`
- `normalizeAuthorKey(name)` / `parseAuthorNames(authorField)` — pure helpers
- `isAuthorBlocked(authorField)` — true if any name segment is blacklisted
- `addBlockedAuthor({ authorName, createdById })` — upsert on `authorKey`
- `removeBlockedAuthor(id)` / `listBlockedAuthors()`

## HTTP API
**Auth:** `requireAuth` + `requireAdmin`

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/author-blacklist` | `{ entries, count }` newest first |
| POST | `/api/admin/author-blacklist` | Body `{ authorName }`; 201; 409 duplicate |
| DELETE | `/api/admin/author-blacklist/[id]` | Remove; 404 if missing |

## Enforcement (always on — no bypass)
- `createRequestForUser` → reason `author_blocked` (POST `/api/requests` maps to `AuthorBlocked` 409)
- BookDate right-swipe (`/api/bookdate/swipe`)
- Interactive request-with-torrent (`/api/audiobooks/request-with-torrent`)

**Exempt:** admin manual/bulk import, reported-issue replace.

## Admin UI
**Page:** `/admin/author-blacklist` — **review + remove only** (no add form).
- Quick Actions tile: **Author Blacklist** (adjacent to **Release Blocklist**)

## Author Page (add)
**Component:** `BlacklistAuthorButton` on `AuthorDetailCard` (admins only; hidden for non-admins).
- Mirrors `WatchAuthorButton`: confirm before blacklist; unblock is instant.
- Labels: `Blacklist Author` / `Blacklisted`
- Hooks: `src/lib/hooks/useAuthorBlacklist.ts`

## User Message
Exact: `This author is blocked by the administrator` (toast / inline via existing `useCreateRequest` error path).

## Tests
- `tests/services/author-blacklist.service.test.ts`
- Request-creator / API route coverage for `author_blocked`
- `tests/api/admin-author-blacklist.routes.test.ts`

## Related
- [Release blocklist](release-blocklist.md) (per-request failed releases — different feature)
- [Database schema](../backend/database.md)
