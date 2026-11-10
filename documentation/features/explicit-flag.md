# Explicit Mark on Requests (Audiobookshelf Explicit flag)

**Status:** ✅ Implemented | A request marked Explicit turns on its Audiobookshelf item's Explicit flag (#542)

## Overview
The requester or an admin ticks **Explicit** on an audiobook request. In ABS mode, when the book reaches the library, RMAB sets `explicit: true` on its ABS item, and ABS then hides it from every ABS user without "Can access explicit content". RMAB never turns the flag off. Plex mode stores the mark only. No setting: nothing is written until a request is marked.

## Key Details
- **Column:** `Request.explicit Boolean @default(false)` ([database.md](../backend/database.md#requests))
- **Who:** the requester or an admin sets it; **only an admin clears it**. A requester can mark again after an admin clears it
- **Kept by:** a re-request of a failed/warn/cancelled request (`request-creator.service.ts`, `request-with-torrent/route.ts`) and a reported-issue Replace (`reported-issue.service.ts`), whoever becomes the requester (the mark belongs to the book's content)
- **Audiobook requests only:** ebook requests have no control; the PUT refuses them (400)
- **API tokens:** `POST /api/requests` accepts `explicit?: boolean`. `PUT /api/requests/[id]/explicit` is **not** on the token allowlist (`src/lib/constants/api-tokens.ts` unchanged): later changes are UI only ([api-tokens.md](../backend/services/api-tokens.md))

## UI
| Surface | Control | Shown when |
|---|---|---|
| Details modal (`AudiobookDetailsModal`) | `ExplicitCheckbox` row above the action buttons; value sent with Request / Interactive Search (`createRequest`, `requestWithTorrent` add `explicit: true` only when ticked) | ABS mode, signed in, can request, not denied, not an ebook request. Starts from the existing request's mark |
| My Requests (`RequestCard`) | `RequestExplicitControl` in the action row; saves at once | ABS mode, audiobook, not denied |
| Admin Recent Requests (`RecentRequestsTable`) | rose "Explicit" pill by the title; `ExplicitMenuItem` in the actions menu ("Mark explicit" / "Remove explicit mark") | ABS mode, audiobook; the menu item is hidden on an unmarked denied request |
- **Non-admin tick asks first** (`ConfirmModal`, "Mark as explicit?"): "Audiobookshelf will hide this book from accounts that can't see explicit content (which may include yours), and only an admin can remove the mark."
- **Non-admin, already marked:** checkbox disabled, with the visible line "Only an admin can remove this" (`aria-describedby`), readable at phone width
- A response `message` shows as a warning toast (10 s); an error as an error toast. My Requests is wrapped in `ToastProvider`
- Backend mode comes from `GET /api/auth/providers` (`useBackendMode`, `src/lib/hooks/useExplicitMark.ts`)

## API
`PUT /api/requests/[id]/explicit` body `{explicit: boolean}` (strict) → `{success, request: {id, explicit}, absUpdated?, message?}`
| Case | Result |
|---|---|
| bad body | 400 `ValidationError` |
| not found / deleted | 404 |
| not the requester, not admin | 403 |
| ebook request | 400 `InvalidRequest` |
| non-admin sends `false` | 403 "Only an admin can remove the explicit mark" |
| `true`, ABS, `available`, book has `absItemId` | stores it, then writes at once (guard, then `{explicit:true}`). **A repeat mark retries the write.** Failure → `absUpdated: false`, message "Saved. Audiobookshelf wasn't updated: <reason>." |
| admin `false`, ABS | stores it, writes nothing to ABS. Available → "Mark removed. Audiobookshelf still marks this book explicit; change it there." Plus, when other live requests of the book are marked: "N other request(s) for this book are still marked; remove that mark too, or ReadMeABook will mark the book explicit again." |
| Plex | stores the value only |

## Write and Guard
- **Writer:** `writeABSItem(itemId, {tags?, explicit?: true})` (`src/lib/services/audiobookshelf/api.ts`), shared with requester tags: one GET (only when tags are asked) and one `PATCH /api/items/:id/media` per item holding only what is missing. `{metadata: {explicit: true}}` changes no other field. **Never sends `explicit: false`; never sends tags when tagging is off; sends explicit alone when the tag list can't be read.** Response check: a boolean `explicit !== true` → failed "explicit flag not saved". 15 s per call; never throws. Result `explicit: none | set | present | failed`
- **Guard (required):** ABS hides explicit items from the API key's user too. Without access RMAB would lose sight of the book (listings drop it, `GET /items/:id` → 403), and a full scan's library-removal could move the available request back to `downloaded`. So before any explicit write: `canKeyUserSeeExplicit()` = `GET /api/me` (15 s) → `isActive === true && permissions.accessExplicitContent === true`; any error → false. The `/me` body carries a token: never logged
- **Guard false:** the flag is skipped (tags still written) and one warning per run says what would have happened: `Not marking "A", "B"… explicit: the Audiobookshelf API key's user can't see explicit books (or the check failed). Books already marked explicit in Audiobookshelf are hidden from ReadMeABook, and a full library scan can treat them as removed from the library. To fix: turn on "Can access explicit content" for that user in Audiobookshelf`
- **Once per scan:** the guard reads `/me` at most once per run; when no write needed it, it still runs once while any marked available request with an ABS item exists (one count query), so the warning shows even when nothing was written. It repeats every recently-added check (5 min) while that holds

## Per-run Step (`applyItemMarks`, `src/lib/services/audiobookshelf/requester-tags.ts`)
- `runItemMarkStep` runs after every scan's matching in ABS mode, tagging on or off; with tagging off it reads only marked requests
- An item's plan gets `explicit` when **any** available, not deleted audiobook request of it is marked. Tag eligibility rules (approval record, requester state, admin import) don't apply: the flag only restricts
- Delivered books first, uncapped. **Repair:** a listed item whose listing has `explicit` false (or null, which maps to false) is written again; a listing without the field is left alone. Repair cap 25 items per run shared with tag repair; 3 failures in a row stop the run's writes
- Counters: `markedExplicit`, `explicitHeldBack` (also in the backfill job result). Log: `Marked "<title>" (Audiobookshelf item <id>) explicit`
- The requester-tag backfill also marks the marked items it lists

## Survival and Recovery
- An ABS quick match keeps the flag (only truthy values copy; Audible `isAdult: false` is skipped). A rescan keeps it (ABS's own metadata.json holds `explicit: true`)
- Lost only through a person's ABS edit/match dialog, overlapping writes, or a foreign `metadata.json` with `explicit: false`; the repair puts it back the next time the item is listed
- **A failed write is retried** by a repeat mark (requester or admin ticks again, or an admin uses "Mark explicit") or by the next run that lists the item: the recently-added check lists only the 10 newest; **for an older book, run the full library scan** (`plex_library_scan`, from the admin Jobs page, or turn its schedule on: off by default; [scheduler.md](../backend/services/scheduler.md))

## Edges
- **Window:** between ABS's own scan of a new folder and RMAB's next recently-added check (up to 5 min, longer when that job is off) the item is visible unmarked
- **Cross-user:** one marked request flags the whole item, so it hides the book from another requester of the same book whose ABS account can't see explicit content
- **Requester's own access:** ABS "user" accounts can't see explicit content by default; marking can hide the book from the requester too (the confirm says so)
- **Clearing:** clears RMAB's mark only; un-flag the book in ABS by hand. While another request of the book stays marked, the next run that lists the item flags it again (the clear message counts them)
- **Separate ebook library:** with "Ebook Library" set, the ebook is its own ABS item that RMAB never matches; mark the ebook in Audiobookshelf. Without it, the flag covers the ebook file in the same item
- **Deleted request:** never a candidate; RMAB removes no flag
- **Downgrade:** below this version `db push` drops the column (marks lost; flags in ABS stay)

## Related
- [requester-tags.md](requester-tags.md), [database.md](../backend/database.md#requests), [api-tokens.md](../backend/services/api-tokens.md), [components.md](../frontend/components.md), [scheduler.md](../backend/services/scheduler.md)
