# Requester Tags on Audiobookshelf Items

**Status:** ✅ Implemented | Opt-in `req:<username>` tag on each delivered audiobook's ABS item (#229, #199; based on #232 by NichCodes)

## Overview
When a requested audiobook becomes `available`, RMAB adds `req:<username>` to its Audiobookshelf item and keeps the item's other tags. ABS can then limit each user to their own books (user permissions → tags). ABS backend only; Plex is untouched.

## Key Details
- **Setting:** `audiobookshelf.tag_requester` (`'true'` = on; absent/other = off). Admin → Settings → Audiobookshelf, checkbox under "Trigger library scan after import". Saved by `PUT /api/admin/settings/audiobookshelf` field `tagRequester`, written only when it is a boolean (absent leaves the key alone)
- **Event:** the compare-and-set winner in `matchRequestsToLibrary` (`src/lib/services/library/match-requests.ts`): the library link or the ASIN match. Book ids collected in a `delivered` set; after the loop one delivery-steps block calls `applyRequesterTags` in its own try/catch, so tagging never blocks or undoes delivery or its notification. Runs in both scan jobs (full scan, recently-added check)
- **Notification first:** `request_available` is queued inside the loop, the tag is written after it. A user limited by tags in ABS can get the notification a moment before the book is visible; when the write fails or the tag is refused, nothing tells the user
- **Write:** `addABSItemTags(itemId, tags)` (`src/lib/services/audiobookshelf/api.ts`): GET `/api/items/:id` → `media.tags` must be an array of strings, else warn and write nothing (ABS's PATCH replaces the whole array) → merged = current (order kept) + missing → `PATCH /api/items/:id/media {tags}` only if changed → when the response carries a tag list (`libraryItem.media.tags`), it must hold ours; a response without one counts as saved. 15 s per call. Never throws: `added | present | unreadable | failed`
- **Tag format:** `req:` + the user's `plexUsername` (Plex username; OIDC `preferred_username || email || sub`; local username): NFKD, drop combining marks, trim, lowercase, whitespace runs → `_`, drop everything outside `[a-z0-9_-]`. A result with no letter or digit gives no tag (`---`, `_`, `- -`, emoji only, an empty result), and so does a name with letters none of which survive (`Дочь 1`, `李雷`). `John Smith` → `req:john_smith`, `José` → `req:jose`, `john.smith@example.com` → `req:johnsmithexamplecom`. Code: `requesterTag()` in `src/lib/services/audiobookshelf/requester-tag-users.ts`
- **Per run:** one users query and one read of the available requests of this run's delivered books and listed items (one read per 1,000 listed item ids; nothing else is read), split into eligible and not in memory. A listed item whose `tags` already hold every expected tag costs no HTTP

## Who Gets Tagged
- Candidates: `type: 'audiobook'`, `status: 'available'`, not deleted, **`approvalBypassedBy` NULL**, book has `absItemId`, and the book was delivered this run or its item was listed this run (or, backfill, is in the library)
- The requester must be in the **tag set**: not deleted, `registrationStatus` `approved` or NULL. Pending/rejected users' own requests are skipped (counted `skippedUser`); they join on approval
- **Books nobody requested:** a manual or bulk import with no request to recycle creates a request for the importing admin. Told apart without a schema change: the requester's `role` is `admin` and the request has no `download_history` row (an import never writes one; every RMAB download does). Not tagged on delivery, repair or backfill; counted `skippedImported`, per request at debug. The same rule also skips an admin's own request that reached the library without an RMAB download (an admin who requested a book, then imported it by hand). A user's request with no download record (a named import) is still tagged; an admin's request RMAB downloaded is tagged
- **The rule reads the role each run** (`loadRequesterTagMap`), not when the request was made: an admin later made a user gets `req:<them>` on their old imports at the next repair or backfill; a user later made an admin no longer gets a lost tag restored on their requests completed without a download (e.g. an ASIN match)
- **Replaced from a reported issue (#571):** Replace (`reported-issue.service.ts`) deletes the book's request and creates a new one for the same requester with the same `approvalBypassedBy`, and RMAB downloads it: the new item gets that requester's `req:` tag (none when the old request was delivered without approval). The admin who replaced it is the requester instead, and the item gets the admin's tag, when the book had no request, the requester is deleted, pending or rejected, or the old request was `awaiting_approval`, `denied` or `cancelled` ([request-deletion.md](../admin-features/request-deletion.md#reported-issue-replace))
- Usually only the first requester: a second user asking for a book already requested or in the library is refused (`request-creator.service.ts`). Exception: if the first request is `failed` or `warn`, another user can request it, and when it arrives both requests complete and both users are tagged. Give others access in ABS (add their tag by hand; RMAB never removes tags)

## Eligibility: `Request.approvalBypassedBy`
- Set (part 1, #552) when a request left `awaiting_approval`/`denied`/`cancelled` without approval: `asin_match:awaiting_approval`, `manual_import:<status>`, `bulk_import:<status>`; a reported-issue Replace copies it onto the replacement request (#571). Never tagged on delivery, repair or backfill; counted `skippedUnapproved`, one info line per run (`N requests delivered without approval are not tagged`), per request at debug. A second, eligible request of the same book is still tagged. See [database.md](../backend/database.md#requests)
- Cleared by the approve route and by a manual import that names the request (API only). **The UI never names a request on an audiobook manual import** (`ManualImportBrowser` sends `requestId` for ebooks only): an admin fulfilling another user's request that is awaiting approval, denied or cancelled through Manual Import records it (a `pending` request is approved and is not recorded, so it is tagged), and that user is never tagged for it. Remedy: add `req:<user>` in ABS by hand (RMAB never removes it)
- `cancelled` counts as unapproved even when the request had been approved before it was cancelled (e.g. auto-approved, cancelled while downloading, then imported by an admin without naming it): not tagged. Errs on the side of not tagging
- The record is sticky: a marked request later delivered by its own user's download (import failed → `failed` → the user's pick) stays untagged
- The denied gate reads only the current status: a download started while the request was approved still completes it after it was sent back to approval and denied (the owner re-picks a release while the first download runs, which sets `awaiting_approval`; the admin denies; the download job stops only for `cancelled`). Its record stays NULL, so it is tagged: the one case where a request whose last admin decision was "deny" is tagged. Needs a direct API call; the user gets only what was first approved
- **Legacy rows:** rows from before the column existed (before v1.2.13) are NULL and eligible. Books imported or matched before v1.2.13 for a user whose request was denied, cancelled or awaiting approval may be tagged for that user
- **Downgrade:** a downgrade drops the column (`db push --accept-data-loss`); upgrading again re-adds it NULL, so formerly marked requests become eligible and the repair/backfill tag them

## Repair (an ABS re-match drops the tag)
- An ABS match with `overrideDetails` (or "Prefer matched metadata") and an Audible tag genre replaces the item's tags. Any later run that lists the item re-adds the missing `req:` tag and keeps ABS's tags (full scan: every item; recently-added check: 10 newest)
- Repair acts only on a listed item whose `tags` array lacks an expected tag; a listing without a `tags` array → no GET, no PATCH. At most `REQUESTER_TAG_REPAIR_CAP` = 25 repaired items per scan run (delivered books uncapped); over the cap one info line `N more items need their requester tag; the next scan continues`
- While tagging is on, a `req:` tag removed by hand comes back. To hide a book from one user: change that user's access in ABS (turning tagging off removes no tag). There is no per-book opt-out
- Same-run gap: the "already tagged" check uses the listing taken at the start of the job, but RMAB's own ASIN match (`matchItemsWithoutAsin`) runs between that listing and the tag step. A tag that match replaces stays missing until the next run that lists the item (recently-added check if among the 10 newest, else the next full scan)
- After 3 consecutive ABS failures the step stops for the run with one error line (403 → the API key's user needs permission to update items); later runs retry

## Shared, Untaggable and Overlapping Names
| Case | Effect | Shown |
|---|---|---|
| Two or more tag-set users with one tag | none of them tagged, on every path | amber box; one warning per tag per run `Not tagging with req:x: shared by a, b`; backfill `skippedShared` |
| Pending/rejected user with a tag-set user's tag | warn only; the tag-set user is still tagged (approving the lookalike stops both) | amber box; one warning per tag per run |
| Name gives no tag | never tagged (no bare `req:`) | amber box "no letters or digits a tag can use"; one warning per user per run; `skippedNoTag` |
| Live user with a deleted user's tag | warn only; books tagged for the deleted user still carry it | amber box; one warning per tag per run |
- Run warnings are logged when a candidate of that tag (or user) is in the run
- A Plex or OIDC user who was deleted and signs in again gets a new account with the same username, so the deleted-overlap line appears; when it is the same person, nothing needs doing
- Amber box wording: two names on one tag → "neither is tagged", three or more → "none of them is tagged". The closing advice shows only for shared and untaggable names: usernames come from Plex or the OIDC provider (changed there, applied at the next sign-in); RMAB can't rename a local user, so give those users' books a tag of your own in ABS (never the shared tag, which would show the book to every user who has it)
- Settings GET computes the warnings regardless of the saved value (`audiobookshelf.requesterTagWarnings`); a users-query error gives empty lists, never a failed settings load

## Backfill Job `backfill_requester_tags`
- Queued only by the ABS settings PUT on a saved false → true change (`addBackfillRequesterTagsJob`, attempts 1, skipped while one is waiting or active; enqueue failure logged, save still succeeds). Label `Requester Tag Backfill`
- Lists the configured ABS library once; same `applyRequesterTags` in `backfill` mode: every eligible available request of a tag-set user whose item is listed; uncapped; an item listed without a `tags` array may GET (the GET guards the PATCH)
- Sequential; stops at the end, when tagging is turned off (re-read every 25 items), or after 3 consecutive ABS failures; Plex mode or tagging off → `{ skipped: true }`. Idempotent (a second run writes nothing)
- A container stop mid-run is handled like any job ([jobs.md](../backend/services/jobs.md#shutdown-and-cut-jobs)): left for retry, rerun from the start after the restart (items already tagged cost no write); a second cut fails it
- Result in the job record: `{ considered, tagged, alreadyTagged, skippedNoTag, skippedShared, skippedUser, skippedUnapproved, skippedImported, failed, stoppedEarly }` (`considered`, `skipped*` count requests; `tagged`, `alreadyTagged`, `failed` count items)
- **Run it again:** there is no button. Untick the setting, save, tick it, save; a failed or stopped run shows in the job list. Until then, existing books are tagged only by the repair (25 per scan run)

## Privacy
- Opt-in, off by default, admin-only, ABS only. Nothing leaves the box except to the configured ABS server; RMAB never creates ABS users or sets their tag permissions
- Inside ABS: anyone who can see an item sees its requester; **every ABS user of the library sees every `req:` tag** in the tag filter (`/api/libraries/:id/filterdata` is not filtered per user; ABS 2.37.1 caches that list per library for 30 minutes, so a new tag shows there within 30 minutes); OIDC users without a username get an email-derived tag (or their sign-in ID). Tags persist in ABS's database, metadata.json and backups
- Setting text (two paragraphs; the `<label>` is the title only, the paragraphs are the checkbox's `aria-describedby`): what it adds and that turning it on tags books already available and turning it off removes no tags; that every user of the library can see all requesters' usernames in its tag filter, the OIDC email/sign-in ID fallback, and that a removed tag comes back (hide a book from one user by changing their access in ABS)
- Turning it off writes nothing new and removes nothing: delete tags in ABS (Settings → Tags; `DELETE /api/tags/:tag`)

## Critical Issues
- **Request delete:** RMAB removes no tag. Deleting the book's folder deletes the ABS item and its tag; when the item stays (files outside the folder, or the library delete guard refuses) the tag stays. A deleted request is never a candidate, so nothing re-adds it
- **Renames:** a Plex rename (`plexUsername` rewritten at sign-in) leaves the old tag; the repair adds the new one. A different user later taking the old name shares it undetected
- **Lost update:** GET-merge-PATCH is not atomic (ABS has no If-Match); an admin tag edit in the same second can be lost. Two overlapping scan jobs with different expected tags for one item can drop one `req:` tag the same way; the next run that lists the item puts it back

## Related
- [database.md](../backend/database.md#requests), [manual-import.md](manual-import.md), [bulk-import.md](bulk-import.md), [settings-pages.md](../settings-pages.md), [jobs.md](../backend/services/jobs.md), [file-hash-matching.md](../fixes/file-hash-matching.md)
