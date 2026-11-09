# Requester Tags on Audiobookshelf Items

**Status:** ✅ Implemented | Opt-in `req:<username>` tag on each delivered audiobook's ABS item (#229, #199; based on #232 by NichCodes)

## Overview
When a requested audiobook becomes `available`, RMAB adds `req:<username>` to its Audiobookshelf item and keeps the item's other tags. ABS can then limit each user to their own books (user permissions → tags). ABS backend only; Plex is untouched.

## Key Details
- **Setting:** `audiobookshelf.tag_requester` (`'true'` = on; absent/other = off). Admin → Settings → Library → Audiobookshelf, checkbox under "Trigger library scan after import". Saved by `PUT /api/admin/settings/audiobookshelf` field `tagRequester`, written only when it is a boolean (absent leaves the key alone)
- **Event:** the compare-and-set winner in `matchRequestsToLibrary` (`src/lib/services/library/match-requests.ts`): the library link or the ASIN match. Book ids collected in a `delivered` set; after the loop one delivery-steps block calls `applyRequesterTags` in its own try/catch, so tagging never blocks or undoes delivery or its notification. Runs in both scan jobs (full scan, recently-added check)
- **Write:** `addABSItemTags(itemId, tags)` (`src/lib/services/audiobookshelf/api.ts`): GET `/api/items/:id` → `media.tags` must be an array of strings, else warn and write nothing (ABS's PATCH replaces the whole array) → merged = current (order kept) + missing → `PATCH /api/items/:id/media {tags}` only if changed → the response's `libraryItem.media.tags` must hold ours. 15 s per call. Never throws: `added | present | unreadable | failed`
- **Tag format:** `req:` + the user's `plexUsername` (Plex username; OIDC `preferred_username || email || sub`; local username): NFKD, drop combining marks, trim, lowercase, whitespace runs → `_`, drop everything outside `[a-z0-9_-]`. A name with letters none of which survive gives no tag (`Дочь 1`, `李雷`), as does an empty result. `John Smith` → `req:john_smith`, `José` → `req:jose`, `john.smith@example.com` → `req:johnsmithexamplecom`. Code: `requesterTag()` in `src/lib/services/audiobookshelf/requester-tag-users.ts`
- **Per run:** one users query, one eligible-request query, one count of requests that are not eligible. A listed item whose `tags` already hold every expected tag costs no HTTP

## Who Gets Tagged
- Candidates: `type: 'audiobook'`, `status: 'available'`, not deleted, **`approvalBypassedBy` NULL**, book has `absItemId`, and the book was delivered this run or its item was listed this run (or, backfill, is in the library)
- The requester must be in the **tag set**: not deleted, `registrationStatus` `approved` or NULL. Pending/rejected users' own requests are skipped (counted `skippedUser`); they join on approval
- Usually only the first requester: a second user asking for a book already requested or in the library is refused (`request-creator.service.ts`). Exception: if the first request is `failed` or `warn`, another user can request it, and when it arrives both requests complete and both users are tagged. Give others access in ABS (add their tag by hand; RMAB never removes tags)

## Eligibility: `Request.approvalBypassedBy`
- Set (part 1, #552) when a request left `awaiting_approval`/`denied`/`cancelled` without approval: `asin_match:awaiting_approval`, `manual_import:<status>`, `bulk_import:<status>`. Never tagged on delivery, repair or backfill; counted `skippedUnapproved`, one info line per run (`N requests delivered without approval are not tagged`), per request at debug. A second, eligible request of the same book is still tagged. See [database.md](../backend/database.md#requests)
- Cleared by the approve route and by a manual import that names the request (API only). **The UI never names a request on an audiobook manual import** (`ManualImportBrowser` sends `requestId` for ebooks only): an admin fulfilling another user's pending, denied or cancelled request through Manual Import records it, and that user is never tagged for it. Remedy: add `req:<user>` in ABS by hand (RMAB never removes it)
- `cancelled` counts as unapproved even when the request had been approved before it was cancelled (e.g. auto-approved, cancelled while downloading, then imported by an admin without naming it): not tagged. Errs on the side of not tagging
- The record is sticky: a marked request later delivered by its own user's download (import failed → `failed` → the user's pick) stays untagged
- The denied gate reads only the current status: a download started while the request was approved still completes it after it was sent back to approval and denied (the download job stops only for `cancelled`); its record stays NULL, so it is tagged
- **Legacy rows:** rows from before the column existed are NULL and eligible. Books imported before this version for a user whose request was denied, cancelled or awaiting approval may be tagged for that user
- **Downgrade:** a downgrade drops the column (`db push --accept-data-loss`); upgrading again re-adds it NULL, so formerly marked requests become eligible and the repair/backfill tag them

## Repair (an ABS re-match drops the tag)
- An ABS match with `overrideDetails` (or "Prefer matched metadata") and an Audible tag genre replaces the item's tags. Any later run that lists the item re-adds the missing `req:` tag and keeps ABS's tags (full scan: every item; recently-added check: 10 newest)
- Repair acts only on a listed item whose `tags` array lacks an expected tag; a listing without a `tags` array → no GET, no PATCH. At most `REQUESTER_TAG_REPAIR_CAP` = 25 repaired items per scan run (delivered books uncapped); over the cap one info line `N more items need their requester tag; the next scan continues`
- While tagging is on, a `req:` tag removed by hand comes back. To take a book away from one user: turn tagging off, or change that user's access in ABS. There is no per-book opt-out
- After 3 consecutive ABS failures the step stops for the run with one error line (403 → the API key's user needs permission to update items); later runs retry

## Shared, Untaggable and Overlapping Names
| Case | Effect | Shown |
|---|---|---|
| Two or more tag-set users with one tag | none of them tagged, on every path | amber box; one warning per tag per run `Not tagging with req:x: shared by a, b`; backfill `skippedShared` |
| Pending/rejected user with a tag-set user's tag | warn only; the tag-set user is still tagged (approving the lookalike stops both) | amber box; one warning per tag per run |
| Name gives no tag | never tagged (no bare `req:`) | amber box "no letters or digits a tag can use"; one warning per user per run; `skippedNoTag` |
| Live user with a deleted user's tag | warn only; books tagged for the deleted user still carry it | amber box; one warning per tag per run |
- Run warnings are logged when a candidate of that tag (or user) is in the run
- Usernames come from Plex or the OIDC provider (changed there, applied at the next sign-in). RMAB can't rename a local user: tag those users' books in ABS by hand
- Settings GET computes the warnings regardless of the saved value (`audiobookshelf.requesterTagWarnings`); a users-query error gives empty lists, never a failed settings load

## Backfill Job `backfill_requester_tags`
- Queued only by the ABS settings PUT on a saved false → true change (`addBackfillRequesterTagsJob`, attempts 1, skipped while one is waiting or active; enqueue failure logged, save still succeeds). Label `Requester Tag Backfill`
- Lists the configured ABS library once; same `applyRequesterTags` in `backfill` mode: every eligible available request of a tag-set user whose item is listed; uncapped; an item listed without a `tags` array may GET (the GET guards the PATCH)
- Sequential; stops at the end, when tagging is turned off (re-read every 25 items), or after 3 consecutive ABS failures; Plex mode or tagging off → `{ skipped: true }`. Idempotent (a second run writes nothing)
- Result in the job record: `{ considered, tagged, alreadyTagged, skippedNoTag, skippedShared, skippedUser, skippedUnapproved, failed, stoppedEarly }` (`considered`, `skipped*` count requests; `tagged`, `alreadyTagged`, `failed` count items)

## Privacy
- Opt-in, off by default, admin-only, ABS only. Nothing leaves the box except to the configured ABS server; RMAB never creates ABS users or sets their tag permissions
- Inside ABS: anyone who can see an item sees its requester; **every ABS user of the library sees every `req:` tag** in the tag filter (`/api/libraries/:id/filterdata` is not filtered per user); OIDC users without a username get an email-derived tag (or their sign-in ID). Tags persist in ABS's database, metadata.json and backups
- Turning it off writes nothing new and removes nothing: delete tags in ABS (Settings → Tags; `DELETE /api/tags/:tag`)

## Critical Issues
- **Request delete:** RMAB removes no tag. Deleting the book's folder deletes the ABS item and its tag; when the item stays (files outside the folder, or the library delete guard refuses) the tag stays. A deleted request is never a candidate, so nothing re-adds it
- **Renames:** a Plex rename (`plexUsername` rewritten at sign-in) leaves the old tag; the repair adds the new one. A different user later taking the old name shares it undetected
- **Lost update:** GET-merge-PATCH is not atomic (ABS has no If-Match); an admin tag edit in the same second can be lost

## Related
- [database.md](../backend/database.md#requests), [manual-import.md](manual-import.md), [bulk-import.md](bulk-import.md), [settings-pages.md](../settings-pages.md), [jobs.md](../backend/services/jobs.md), [file-hash-matching.md](../fixes/file-hash-matching.md)
