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
| Details modal (`AudiobookDetailsModal`) | `ExplicitCheckbox` row above the action buttons; value sent with Request / Interactive Search (`createRequest`, `requestWithTorrent` add `explicit: true` only when ticked). Interactive Search on an existing request advances it (select-torrent, no mark), so a new tick is saved first with the PUT when the pick is confirmed (`beforeSelect`); a failed save starts nothing and says so in the search modal. While it saves, Download and Cancel are disabled and a second click does nothing; Esc or closing the search stops the pick before select-torrent | ABS mode, signed in, can request, not denied, not an ebook request. Starts from the request's mark when opened from My Requests or the admin table; Search, Home, Author and Series cards don't carry it (box starts unticked; a re-request keeps the mark anyway); BookDate and Shelves don't either: they open it without request actions, so no box |
| My Requests (`RequestCard`) | `RequestExplicitControl` in the action row; saves at once, then reloads the list (`onChanged` → `useMyRequests().revalidate`, every loaded page); a pick or re-request from its details modal reloads it too (`onRequestSuccess`) | ABS mode, audiobook, not denied |
| Admin Recent Requests (`RecentRequestsTable`) | rose "Explicit" pill by the title; `ExplicitMenuItem` in the actions menu ("Mark explicit" / "Remove explicit mark") | ABS mode, audiobook; the menu item is hidden on an unmarked denied request |
- **Non-admin tick asks first** (`ConfirmModal`, "Mark as explicit?"): "Audiobookshelf will hide this book from accounts that can't see explicit content (which may include yours), and only an admin can remove the mark."
- **Non-admin, already marked:** checkbox disabled, with the visible line "Only an admin can remove this" (`aria-describedby`), readable at phone width. The details modal saves nothing until Request, so it locks the box only for a request already marked (`locked` prop); a fresh tick can be unticked before sending. An admin's locked box there reads "A re-request keeps the mark"
- **Look:** the box is drawn by hand (`appearance-none`, rose fill and white tick when checked), so a locked mark keeps its rose tick in light and dark. Unticked border `gray-500` (dark `gray-400`), 3:1 or more; mid-save (busy, not locked) a wait cursor and a lighter border
- A response `message` shows as a warning toast (10 s); an error as an error toast. My Requests is wrapped in `ToastProvider`
- Backend mode comes from `GET /api/auth/providers` (`useBackendMode`, `src/lib/hooks/useExplicitMark.ts`)

## API
`PUT /api/requests/[id]/explicit` body `{explicit: boolean}` (strict) → `{success, request: {id, explicit}, absUpdated?, message?}`
| Case | Result |
|---|---|
| bad body | 400 `ValidationError` |
| not found / deleted, or no row updated (replaced or deleted since the read) | 404 |
| not the requester, not admin | 403 |
| ebook request | 400 `InvalidRequest` |
| non-admin sends `false` | 403 "Only an admin can remove the explicit mark" |
| `true`, ABS, `available`, book has `absItemId` | stores it, then writes at once (guard, then `{explicit:true}`). Failure → `absUpdated: false` and a short message by viewer (full reason in the log): requester "Saved. Audiobookshelf wasn't updated; an admin needs to check it."; admin, guard "Saved. Audiobookshelf wasn't updated: its API user can't see explicit content."; admin, 403 on the write "Saved. Audiobookshelf wasn't updated: its API user can't edit items."; admin, other failed write "Saved. Audiobookshelf wasn't updated; a full library scan retries it, or remove and re-add the mark." |
| `true` again on a marked request | requester: plain 200, no ABS call (the scan repair is the retry). Admin: retries the write as above (API only: no UI sends a repeat) |
| `true`, ABS, `available`, no `absItemId` yet | stored, no write, no message; the flag is written when a scan links the item (delivery step) |
| admin `false`, ABS | stores it, writes nothing to ABS. Available → "Mark removed. If the book is marked explicit in Audiobookshelf, change it there." Plus, when other requests of the book that can still flag it (not cancelled, denied or deleted) are marked: "N other request(s) for this book are still marked; remove that mark too, or ReadMeABook marks the book explicit again once delivered." |
| Plex | stores the value only |

## Write and Guard
- **Writer:** `writeABSItem(itemId, {tags?, explicit?: true})` (`src/lib/services/audiobookshelf/api.ts`), shared with requester tags: one GET (only when tags are asked) and one `PATCH /api/items/:id/media` per item holding only what is missing. `{metadata: {explicit: true}}` changes no other field. **Never sends `explicit: false`; never sends tags when tagging is off; sends explicit alone when the tag list can't be read.** Response check: a boolean `explicit !== true` → failed "explicit flag not saved". 15 s per call; never throws. Result `explicit: none | set | present | failed`
- **Guard (required):** ABS hides explicit items from the API key's user too. Without access RMAB would lose sight of the book (listings drop it, `GET /items/:id` → 403), and a full scan's library-removal could move the available request back to `downloaded`. So before any explicit write: `canKeyUserSeeExplicit()` = `GET /api/me` (15 s) → `isActive === true && permissions.accessExplicitContent === true`; any error → false. The `/me` body carries a token: never logged
- **Guard false:** the flag is skipped (tags still written) and one warning per run says what would have happened: `Not marking "A", "B"… explicit: the Audiobookshelf API key's user can't see explicit books (or the check failed). Books already marked explicit in Audiobookshelf are hidden from ReadMeABook, and a full library scan can treat them as removed from the library. To fix: turn on "Can access explicit content" for that user in Audiobookshelf`
- **Once per scan:** the guard reads `/me` at most once per run; when no write needed it, it still runs once while any marked available request with an ABS item exists (one count query), so the warning shows even when nothing was written. It repeats every recently-added check (5 min) while that holds

## Per-run Step (`applyItemMarks`, `src/lib/services/audiobookshelf/requester-tags.ts`)
- `runItemMarkStep` runs after every scan's matching in ABS mode (recently-added check and full library scan), tagging on or off; with tagging off it reads only marked requests
- An item's plan gets `explicit` when **any** available, not deleted audiobook request of it is marked. Tag eligibility rules (approval record, requester state, admin import) don't apply: the flag only restricts
- Delivered books first, uncapped. **Repair:** a listed item whose listing has `explicit` false (or null, which maps to false) is written again; a listing without the field is left alone. Repair cap 25 items per run shared with tag repair; 3 failures in a row stop the run's writes
- Counters: `markedExplicit`, `explicitHeldBack` (also in the backfill job result). Log: `Marked "<title>" (Audiobookshelf item <id>) explicit`
- The requester-tag backfill also marks the marked items it lists

## Survival and Recovery
- An ABS quick match keeps the flag (only truthy values copy; Audible `isAdult: false` is skipped). A rescan keeps it (ABS's own metadata.json holds `explicit: true`)
- Lost only through a person's ABS edit/match dialog, overlapping writes, or a foreign `metadata.json` with `explicit: false`; the repair puts it back the next time the item is listed
- **A failed immediate write** leaves the request marked and available. It is applied by the next scan that lists the item with the flag off (the repair, within the 25-per-run cap; with the guard false it is held back with the run's warning until the API user can see explicit content), or by an admin removing and re-adding the mark (or, through the API, an admin's repeat mark). The recently-added check (5 min) lists only the 10 newest items; an older book waits for the full library scan
- **Full library scan** (`plex_library_scan`, every 6 h): its row is created disabled at startup and **setup completion turns it on** (`src/app/api/setup/complete/route.ts`). Setup doesn't schedule it: the scheduler registers enabled rows when the app starts, so on a fresh install the 6-hour schedule begins at the next restart (where it also runs once as overdue) or when an admin saves the job ([scheduler.md](../backend/services/scheduler.md))

## Edges
- **Window:** between ABS's own scan of a new folder and RMAB's next recently-added check (up to 5 min, longer when that job is off) the item is visible unmarked
- **Cross-user:** one marked request flags the whole item, so it hides the book from another requester of the same book whose ABS account can't see explicit content
- **Requester's own access:** ABS "user" accounts can't see explicit content by default; marking can hide the book from the requester too (the confirm says so)
- **Clearing:** clears RMAB's mark only; un-flag the book in ABS by hand. While another request of the book that can still be delivered stays marked, the next run that lists the item flags it again (the clear message counts them)
- **Separate ebook library:** with "Ebook Library" set, the ebook is its own ABS item that RMAB never matches; mark the ebook in Audiobookshelf. Without it, the flag covers the ebook file in the same item
- **Deleted request:** never a candidate; RMAB removes no flag
- **Downgrade:** below this version `db push` drops the column (marks lost; flags in ABS stay)

## Related
- [requester-tags.md](requester-tags.md), [database.md](../backend/database.md#requests), [api-tokens.md](../backend/services/api-tokens.md), [components.md](../frontend/components.md), [scheduler.md](../backend/services/scheduler.md)
