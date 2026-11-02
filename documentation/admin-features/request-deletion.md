# Request Deletion (Admin Feature)

**Status:** ✅ Implemented

Admin feature for deleting requests with intelligent cleanup of media files and torrents.

## Overview

Allows admins to delete requests from the admin dashboard with smart handling of:
- Soft deletion (allows re-requesting)
- Media file cleanup
- Torrent seeding management
- Orphaned download tracking

## Key Features

1. **Soft Delete** - Preserves request history, allows re-requesting
2. **1:1 Request-to-Files** - No duplicate requests for same audiobook
3. **Seeding Awareness** - Keeps torrents seeding until requirements met
4. **Confirmation Dialog** - Prevents accidental deletions
5. **Automatic Cleanup** - Scheduled job handles orphaned downloads

## User Flow

### Admin Dashboard

1. Navigate to Admin Dashboard → Recent Requests table
2. Click "Delete" button next to request
3. Review confirmation dialog with details:
   - Request title
   - Actions that will be taken
   - Warning about re-requesting
4. Click "Delete" to confirm or "Cancel" to abort
5. Request deleted, UI updates automatically

## Technical Implementation

### Database Schema

**Soft Delete Fields:**
```prisma
model Request {
  // ... existing fields ...
  deletedAt  DateTime? @map("deleted_at")
  deletedBy  String?   @map("deleted_by")
}
```

**Unique Constraint:** Removed from schema, enforced in application code

**Ebook placement record (#497):** `placedEbookFiles Json? @map("placed_ebook_files")` on Request: the ebook files the request's imports copied (D2 below). Nullable, no default (added by `prisma db push`; existing rows NULL)

### Deletion Logic Flow

**Service:** `src/lib/services/request-delete.service.ts`; download handling in `src/lib/services/request-delete-download.ts` (`cleanUpRequestDownload()`, never throws)

**Steps:**

1. **Find Request**
   - Query: `deletedAt: null`
   - Return 404 if not found or already deleted

2. **Handle Downloads & Seeding**

   For each selected download:

   ```
   IF row is 'removed' (gone from the client) or addedByRmab = false (taken over, #423):
     → No client call at all; taken over → torrentsKeptNotOwned++ ('removed' only logs)

   IF recorded client type != configured client type:
     → Leave it (warn): the id means nothing in the new client
       (torrent and usenet: a usenet delete also skips when another usenet client type is configured)

   IF torrent not in the client:
     → Skip (already removed)

   (usenet: delete the job + files; a taken-over job (#329) was left above; RMAB's own job is kept
    while another active request's selected row has the same nzo_id → torrentsKeptShared++)

   IF resolveOwnership(row, client added time) says not RMAB's
      (src/lib/utils/torrent-ownership.ts; see download-clients.md#torrent-ownership-423):
     → Keep it exactly as it is → torrentsKeptNotOwned++
       (legacy NULL row added ≥ 24 h before the request: also write addedByRmab = false)

   ELSE IF unlimited seeding (no indexer config, or seedingTimeMinutes AND ratioLimit both 0):
     → Log: "Keeping for unlimited seeding"
     → Do nothing (stop monitoring)
     → torrentsKeptUnlimited++

   "completed" = history downloadStatus completed, OR the live client reports completed/seeding
     or progress >= 1 (history lags for a cancelled request: the monitor stops polling it)

   ELSE IF download not completed, OR evaluateSeeding(config, {seedingTime, ratio}).met:
     (src/lib/utils/seeding-policy.ts, same rule as cleanup_seeded_torrents: every set
      limit met; 0 turns a limit off; unreported ratio with ratioLimit > 0 = not met)
     IF another active request uses the same torrentHash (otherActiveRequestsUsingTorrent,
        src/lib/utils/shared-torrent.ts), whatever its status, even finished and done seeding:
       → Keep torrent → torrentsKeptShared++ (the cleanup job may remove it later, see below)
     ELSE:
       → Delete torrent + files → torrentsRemoved++ → row downloadStatus = 'removed'

   ELSE (still seeding):
     → Log: "Keeping ... to finish seeding: ratio a/b, time x/y min"
     → History not yet completed → write downloadStatus completed (cleanup only reads completed rows)
     → torrentsKeptSeeding++ (cleanup job removes it later)
   ```

3. **Library Delete Guard** (`src/lib/utils/library-delete-guard.ts`, run from `src/lib/services/request-delete-files.ts`)
   - Path: persisted `Audiobook.filePath` only (never rebuilt from `media_dir` or a template)
   - Files are removed from the stored folder (D1 below) only when ALL hold, else nothing is removed:
     | Rule | Refusal reason (`filesKeptReason`) |
     |------|------------------------------------|
     | a. strictly inside `media_dir` | `it is the media library root` / `it is outside the media library (...)` |
     | b. equals/contains no configured root (download dirs, client paths, mapped paths, `/bookdrop`) | `it is a configured root (...)` / `it contains a configured root (...)` |
     | c. equals/contains no other book's `filePath` (each row canonicalized: realpath + dev/ino; missing rows skipped) | `it is also the folder of "<title>"` / `it contains the folder of "<title>"` |
     | evidence: audio directly in the folder hashes to `filesHash` | `folder contents changed since import` / `there is no import record (files hash) for this folder` |
     | evidence: no audio in any subfolder | `it has audio files in a subfolder` |
   - Roots are read strictly from the DB (`collectGuardRoots`, fail closed: any error refuses)
   - Symlinked title folder: rules a-c on the target AND the link location; only the link is removed
   - **What D1 removes (#526, `src/lib/utils/book-folder-delete.ts`):** one `readdir` of the canonical folder; every decision by name inside it (`unlink` never follows a link in the last component; a parent swapped mid-delete is followed, a smaller exposure than the former `rm -rf`)
     | Entry | Action | Kept `why` |
     |-------|--------|------------|
     | direct non-folder entries with an audio name | unlinked first, only when they still hash to `filesHash` (else nothing removed: `folder contents changed since import`); ENOENT = already gone | |
     | `.rmab-partial-*.part` regular file (`PARTIAL_FILE_PATTERN`) | older than 24 h: unlinked; newer: kept | `an import is still writing it` |
     | `cover.jpg` (regular file, never a link) and the junk list | unlinked only when nothing else is left but these and ebooks recorded by active ebook requests | `kept with the other files` |
     | ebook file named by an active ebook request's `placedEbookFiles` (canonical folder + name; a label, never a delete input) | kept; does not keep the cover | `ebook of another request` |
     | anything else (user files, unrecorded/legacy ebooks, subfolders `name/`, links) | kept; never entered | `RMAB has no record that it placed it` |
   - Junk list (`src/lib/utils/book-folder-junk.ts`): files `.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`, `metadata.json`, `metadata.abs` (exact names, regular files); folders `@eaDir`, `.@__thumb` through a limited walk (lstat, links never followed, files unlinked and folders rmdir'd one by one, each folder re-checked by dev/ino first); a junk folder holding a link, special file, audio or ebook file, deeper than 3 levels or more than 500 entries is kept whole (`RMAB has no record that it placed it (<why>)`)
   - Audio unlink failure: stop; outcome kept (library untouched): `<name> could not be removed (<why>)`, or `the folder was partly removed (<why>); remove the rest manually` after ≥1 file; a failed first `readdir`: kept, nothing removed. Cover/junk/partial unlink failure: listed `could not be removed (<why>)`
   - Then the folder: empty → `rmdir` (non-recursive) + empty-parent sweep; every rmdir error ignored; a non-ENOTEMPTY one is logged and returned as `folderKept.error` (`could not be removed (<code>)`; message `Request deleted; the emptied book folder could not be removed (<code>)` when nothing else is listed), never listed as the folder's content; not empty → stays, result `folderKept`
   - AppleDouble files with an audio extension (`._Book.m4b`) count as audio (guard hash and D1), not junk: a folder holding one fails the hash check and is kept whole
   - No stored path but a library item (`absItemId`/`plexGuid`): kept (`RMAB has no stored folder ...`); no path and no item: nothing to remove
   - Missing folder: "already gone" only when the library looks mounted (`media_dir` readable and not empty, and some other stored book folder exists when other rows have one); otherwise kept (`the folder is missing and ... is the media volume mounted?`): no backend call, row untouched (protects against a media volume not mounted yet)
   - Mount-check limit: a mount point that received new imports while the share was unmounted is not empty, so it passes; a missing folder there then counts as gone (no Plex delete; ABS `hard=0` only for an item inside that path; row cleared)
   - Stale record: the stored folder is gone AND outside the current `media_dir` (library moved): nothing removed or protected; the delete clears only `filePath`/`filesHash`/`fileFormat` (no backend call, records and status kept; message says so), a replace goes on
   - Symlinked title folder `rm` failure: kept (`the folder was partly removed (permission denied); remove the rest manually`); backend and row untouched
   - After the folder is removed: empty parents swept up to the nearest root (`sweepEmptyParents`)
   - **Ebook requests (D2, #497):** only the files the request's imports recorded in `Request.placedEbookFiles` (`[{ path, size, sha256, placedAt }]`, `src/lib/utils/ebook-placement.ts`); status and the rest of the folder never count. `Audiobook.filePath` is not read. Per entry, in order (kept reasons joined `; `, each reason once):
     | Check | Kept reason |
     |-------|-------------|
     | entry well-formed: absolute path, no NUL, ebook extension (`isEbookFile`), safe-integer size ≥ 0, 64-hex sha256 (non-array value = one bad entry) | `the placement record could not be read` |
     | rules a-c on the file's folder (`assertSafeLibraryDelete(dir, book, { evidence: false })`; symlinked folder: target + link location) | rule a-c reasons above |
     | `lstat` regular file (not a symlink/folder) | `<name> is no longer the file RMAB placed` |
     | size and sha256 match the entry | `<name> changed since RMAB placed it` |
     | not the same file as an entry of another active (`deletedAt null`) ebook request, any book: same sha256 + size and its path reaches the same file (`lstat` dev/ino, so a symlinked folder or another spelling of the folder counts; a stale entry with other bytes does not) | `<name> is also the ebook of another request` (that lstat fails other than ENOENT/ENOTDIR: `<name> could not be compared with another request's record (<code>)`) |
     | `unlink` | `<name> could not be removed (<why>)` |
   - File or its folder already gone (library mounted): nothing, no reason
   - No record: SQL NULL or JSON null (imported before the field, a record write that failed, or never imported). Kept reason only when the request ever delivered (`status = 'downloaded'` or `completedAt`): `RMAB has no record of the ebook files this request placed (it was imported before RMAB kept one, or the record could not be saved), so no ebook file was removed`; otherwise none (`Request deleted successfully`)
   - `[]` (the import found the file already in the library: `identical`/`present`/`differs`): `RMAB has no record that this request placed the ebook (its import found it already in the library), so it was not removed`
   - Earlier-import marker `{ "earlierImport": "unrecorded" }` (first item; `recordEbookPlacement` writes it when the stored value is NULL but `completedAt` is already set, i.e. the request delivered before: a pre-upgrade import or a failed record write, then a re-import such as Manual Import): never removable; adds `an earlier import of this request has no record (it was imported before RMAB kept one, or the record could not be saved), so its ebook file was not removed`; the recorded entries after it are still removed
   - Never a folder sweep: a flat `Ebooks`/shelf folder loses only the recorded file (foreign ebooks stay); a folder another book stores still fails rule c
   - Not handled (needs a separate ebook location, PR2): an ebook in a separate folder (custom `ebook_path_template`) is not removed by the audiobook delete
   - D2 empty-folder step (#526): after unlinking ≥1 file, that file's folder (only when the recorded folder is a real folder, not a link, at the canonical path rules a-c passed on) goes when nothing but the junk list is left (a written exception to "D2 removes only recorded files"), then empty parents are swept; every rmdir error ignored (a non-ENOTEMPTY one is only logged: the recorded files are gone, so it is not `filesKeptReason`; `filesDeleted: true`, success toast). When that folder was `Audiobook.filePath`, `filePath`/`fileFormat`/`filesHash` are cleared. Main's ebook delete removed only recorded files; this step also unlinks the junk files (`metadata.json`, `desktop.ini`, `._*`, ...) and empties junk folders (`@eaDir`, `.@__thumb`) of a folder nothing else is left in

4. **Files kept: library left exactly as it is**
   - No backend delete, no plex_library cleanup, no status reset, linkage and stored paths kept
   - Request still soft-deleted; result `filesDeleted: false`, `filesKeptReason`, message `Request deleted; files kept: <reason>`

5. **Backend item (only after RMAB removed the folder, or found it already gone)**
   - **Audiobookshelf:** `DELETE /api/items/<id>?hard=0` (database entry only; RMAB already removed the files), only when the item's `path` is inside the removed folder, or its `relPath` matches the folder's path relative to `media_dir` (ABS mounting the library elsewhere). Otherwise skipped (a second copy elsewhere survives). The `relPath` match can also hit the same relative path in another ABS library folder; with `hard=0` only that item's database entry goes (the next ABS scan re-adds it)
   - **Plex:** `DELETE /library/metadata/{ratingKey}` only after RMAB removed the folder itself, and only when every file Plex lists for the item and its tracks (`getItemFilePaths`: Media > Part `file`) is inside it; otherwise (incl. a folder that was already gone) skipped, the next library scan drops it
   - `deleteABSItem(id, { hard })`: `hard: true` (`?hard=1`) also deletes files; only a replace of a book added outside RMAB (no request, no stored folder; `replace-library-content.ts`) uses it

6. **plex_library records, linkage, stored paths** (only after removal / already gone)
   - plex_library delete by ASIN, fallback exact title/author
   - Audiobook: `status = 'requested'`, clear `absItemId` (ABS) or `plexGuid` (Plex), clear `filesHash`; `filePath`/`fileFormat` cleared, or, when a delivered ebook request stays and its newest recorded ebook is still on disk, set to that ebook's folder and format (the state an ebook-only import leaves; status stays `requested`). Same in the stale branch. Several delivered ones: the newest (`createdAt desc`) whose recorded ebook is on disk. A delivered legacy child (no record) stays with `filePath` null: its download 404s until the book is imported again
   - Child requests (`parentRequestId = id`, and ebook requests with no parent on the same book row; `src/lib/services/request-delete-children.ts`): undelivered ones soft-deleted; delivered ones (`placedEbookFiles` not NULL, `status = 'downloaded'` or `completedAt`) stay with `parentRequestId = null` (their file stays, so select-ebook, the list's `downloadAvailable` and the download route keep working)
   - Re-request: the next audiobook import of the book (`createEbookRequestIfEnabled` → `relinkParentlessEbookRequest`, whatever the ebook settings) sets the newest parentless active ebook request's `parentRequestId` to the new request (compare-and-set on `parentRequestId: null`; skipped when the new request already has one), so fetch-ebook, select-ebook and interactive-search-ebook find it by parent and open no second one
   - "This book already has an ebook request" (automatic request, `find_missing_ebooks`) is checked by book (`audiobookId`), so it also sees other users' ebook requests on the book: one user's cancelled/denied ebook request skips another user's audiobook request, and a parentless failed one is retried automatically

7. **Soft Delete Request**
   - UPDATE: `deletedAt = NOW(), deletedBy = adminUserId`
   - Preserves for audit trail and orphaned download tracking

### Cleanup Job Enhancement

**Processor:** `src/lib/processors/cleanup-seeded-torrents.processor.ts`

**Query:** Finds both active + soft-deleted requests

```typescript
where: {
  OR: [
    { status: ['available', 'downloaded'], deletedAt: null },
    { deletedAt: { not: null } }
  ]
}
```

**Behavior:**
- **Active requests:** Delete torrent when seeding complete (row → `removed`)
- **Soft-deleted requests:** Delete torrent + hard-delete request when seeding complete
- **Unlimited seeding:** Hard-delete orphaned request immediately (no monitoring)
- **Not RMAB's torrent:** never removed; a soft-deleted request is hard-deleted, the torrent stays. Details: [scheduler.md](../backend/services/scheduler.md) (cleanup_seeded_torrents)
- **Shared torrent (#283):** after ownership and this row's seeding check, `otherActiveRequestsSharingTorrent()` lists the other non-deleted requests on the torrent (same hash forms as the delete guard). Each keeps it (logged with the reason) unless `siblingKeepsTorrent()` (`src/lib/utils/shared-torrent.ts`) finds it:
  - finished: `FINISHED_REQUESTS` (audiobook `available`, ebook `downloaded`; also the candidate query's statuses). Any other status keeps it (`downloading`, `processing`, audiobook `downloaded`, `failed`, `cancelled`, ...)
  - an audiobook also imported by RMAB since it took the torrent: its book record `completed` with a `filePath` (written only by the organizer after the copy) and `completedAt` later than the row's `createdAt`. A library scan can mark it `available` mid-copy, and a library match alone never passes, so either keeps it
  - every row it has for the torrent recorded for the configured client type
  - its own indexer's requirement met (`evaluateSeeding()` with its row's indexer, by the same probe answer); unlimited or unconfigured indexer keeps it
  - None keeps it → one `deleteDownload`, this row `removed` (or soft-deleted: hard-deleted), the siblings' rows `removed` in one `updateMany` (also rows RMAB did not add, which never reach the guard themselves). Same run: `deletedHashes`; later runs: the probe's not-found → `removed`
  - Soft-deleted requests never keep it (unchanged)

### API Endpoint

**DELETE** `/api/admin/requests/:id`

**Authorization:** Admin only

**Request:** No body

**Response:**
```json
{
  "success": true,
  "message": "Request deleted successfully",
  "details": {
    "filesDeleted": true,
    "torrentsRemoved": 2,
    "torrentsKeptSeeding": 1,
    "torrentsKeptUnlimited": 0,
    "torrentsKeptShared": 0,
    "torrentsKeptNotOwned": 0,
    "filesKeptReason": "folder contents changed since import",
    "folderKept": { "folder": "/media/Author/Book", "files": [{ "name": "Book.epub", "why": "ebook of another request" }], "more": 0 }
  }
}
```
- `filesKeptReason` present only when library files were kept (nothing removed); the request is still deleted (HTTP 200)
- `folderKept` (#526) present only when the audio was removed but the folder stays: first 20 entries, `more` = the rest; message `Request deleted; the book folder stays because it still holds: Book.epub (ebook of another request), cover.jpg (kept with the other files), notes.txt (RMAB has no record that it placed it)`; `filesDeleted: true`; `error` when only the emptied folder's own rmdir failed. The reported-issue replace stops only on `filesKeptReason`
- `torrentsKeptNotOwned`: torrents left in the client because RMAB did not add them (or can't tell that it did)

**Errors:**
- 401: Unauthorized (not logged in)
- 403: Forbidden (not admin)
- 404: Request not found or already deleted
- 500: Internal server error

### Frontend Components

**ConfirmDialog** (`src/app/admin/components/ConfirmDialog.tsx`)
- Reusable confirmation modal
- Props: title, message, confirmLabel, confirmVariant
- Supports danger (red) and primary (blue) variants

**RecentRequestsTable** (`src/app/admin/components/RecentRequestsTable.tsx`)
- Added "Actions" column with Delete button
- State management for confirmation dialog
- SWR cache invalidation after deletion
- Loading states during deletion
- Files kept: warning toast `Request deleted; files kept: <reason>` (10 s) instead of the success toast
- Folder kept (#526): warning toast with the result message (10 s)

## Re-Requesting After Deletion

**Application-Level Uniqueness:**

All `prisma.request.findMany/findFirst` queries include:
```typescript
where: {
  // ... other conditions
  deletedAt: null  // Only active requests
}
```

**Re-Request Flow:**

1. User requests audiobook previously deleted
2. Query checks for existing request: `deletedAt: null`
3. No active request found → allowed to create new request
4. Old soft-deleted request remains in DB for audit

## Edge Cases Handled

1. ✅ **Torrent not in qBittorrent** - Skip deletion, continue with files
1a. ✅ **Torrent RMAB did not add** (already in the client at grab time, #423) - Kept, never removed or re-categorized; `torrentsKeptNotOwned`
1b. ✅ **Row already `removed`** - No client call, never written back to `completed`
2. ✅ **Unlimited seeding (time and ratio both 0, or no config)** - Keep in qBittorrent, hard-delete orphaned request
3. ✅ **Incomplete download** - Delete torrent + files immediately
4. ✅ **Seeding requirement met** - Delete torrent + files
5. ✅ **Still seeding** - Keep torrent, soft-delete request, cleanup job handles later
6. ✅ **Media folder not found** - Log and continue (already deleted)
7. ✅ **Multiple delete clicks** - Button disabled during deletion
8. ✅ **Network error** - Alert shown, request remains
9. ✅ **ABS library item deletion fails** - Log error, continue with soft delete
10. ✅ **No absItemId present** - Skip ABS deletion (not yet in library)
11. ✅ **Plex library item deletion fails** - Log error, continue with soft delete
12. ✅ **No plexGuid present** - Skip Plex deletion (not yet in library)
13. ✅ **Plex deletion not enabled in settings** - Log error, continue with soft delete
14. ✅ **Title mismatch in plex_library** - ASIN-based deletion handles title variations (e.g., "(Unabridged)" suffix)
15. ✅ **No ASIN available** - Falls back to exact title/author matching
16. ✅ **Path template changed after organization** - Deletes only the persisted organized path
17. ✅ **Legacy row has no stored path** - Skips file deletion without guessing a path
18. ✅ **Folder shared with other books, foreign files, symlinks, roots** - Library delete guard keeps the files and says why
19. ✅ **Reported-issue replace when files would be kept** - `replaceAudiobook` stops with HTTP 409 and the reason before deleting anything (and again if `deleteRequest` kept files); no record reset, no new request, issue stays open
20. ✅ **Replace with no active request but a stored folder** (an earlier delete kept the files) - `removeLibraryContentForReplace`: the folder goes through the guard (409 when kept), backend item as in step 5; never an ABS hard delete
21. ✅ **Replace after a library move** - stale stored folder (gone, outside `media_dir`): no backend call, the replace resets the stored path and continues
22. ✅ **Replace that keeps refusing** (e.g. a legacy row whose stored folder is shared with other books): every 409 names the way out: "Remove those files manually, then re-request the book after the next library scan."
23. ✅ **ABS hard delete for a book added outside RMAB** (no stored folder, item looked up by ASIN in plex_library): refused when more than one library item matches the ASIN

## Fixed Issues ✅

**1. Book Shows "Available" After Deletion Until Library Scan**
- **Issue:** Deleted books remained "available" until the next library scan
- **Cause:** plex_library deletion used title/author matching, but availability check used ASIN matching
- **Impact:** Title variations (e.g., "Book Title" vs "Book Title (Unabridged)") caused plex_library records to persist
- **Fix:** Changed plex_library deletion to use ASIN-based matching (same as availability check)
- **Result:** Books immediately show as NOT available after deletion, can be re-requested right away

**2. Changed Path Template Deletes an Unrelated Directory**
- **Issue:** Deletion rebuilt a directory from the current media path and template
- **Cause:** `Audiobook.filePath` was persisted during organization but omitted from the deletion query
- **Fix:** Delete only the persisted path; legacy rows without one skip file cleanup
- **Result:** Configuration changes cannot redirect deletion to a newly rendered directory

**3. Deleting a Request Removed Other Books' Files**
- **Issue:** `fs.rm(filePath, { recursive })` with no checks; an ebook import overwrote `filePath` with its folder (`{author}` or flat `Ebooks` templates), and the ebook delete unlinked every ebook in that folder. ABS deletes always sent `hard=1`
- **Fix:** library delete guard (rules a-c + evidence); backend deletes only after RMAB removed the folder, ABS with `hard=0`, Plex only for items inside the folder
- **Note:** `filesHash` covers file names only (a same-named replacement passes); it is built from this import's audio after format coercion, excluding files the library already held with different content (`differs`)

**4. Deletion Ignored the Indexer Ratio Limit**
- **Issue:** Deleting a request removed a torrent once its seeding time was met even when its ratio limit was not; a ratio-only indexer (`seedingTimeMinutes: 0`) was treated as unlimited and kept forever
- **Cause:** request deletion had its own time-only check; the scheduled cleanup already used time AND ratio
- **Fix:** both use `evaluateSeeding()` (`src/lib/utils/seeding-policy.ts`)
- **Also (rename):** settings were found by indexer name, so a rename in Prowlarr made the torrent "unlimited"; both now match by `indexerId` first, name as fallback
- **Also:** deletion now skips removing a torrent another active request still uses (`otherActiveRequestsUsingTorrent()`, same check as the cleanup job). Behaviour change: a ratio-only indexer's incomplete download is removed on delete (it was kept forever as "unlimited")

**5. Deleting a Request Removed a Torrent RMAB Did Not Add (#423)**
- **Issue:** a release already in the client (added by hand or another app) was grabbed by its existing hash; deleting the request (or the seeding cleanup) then removed it with its files
- **Fix:** `DownloadHistory.addedByRmab` recorded at the grab; delete and cleanup act only on RMAB's torrents (`resolveOwnership()`); rows from before the fix are judged by the client's added time

**6. Torrent Shared by Several Finished Requests Never Cleaned Up (#283)**
- **Issue:** a series pack (or re-request) used by several finished requests stayed in the client forever
- **Cause:** the cleanup job's shared-torrent check counted every non-deleted sibling, so each finished request kept it for the others
- **Fix:** cleanup job only: a sibling keeps it unless finished and done seeding by its own indexer's rule (`siblingKeepsTorrent()`); request deletion unchanged

**7. Deleted Request Still Took a Torrent Pick or a Search (#470)**
- **Issue:** `select-torrent`, `interactive-search`, `manual-search` and `fetch-ebook` (`/api/requests/[id]/`) and admin approve/deny (`/api/admin/requests/[id]/approve`) loaded the request by id only, so a deleted request could still start a download or a search
- **Fix:** each loads with `deletedAt: null` (as `select-ebook`/`interactive-search-ebook` do since #463); a deleted request answers that route's usual "Request not found" 404

**8. Ebook Request Delete Removed the User's Own Ebook (#497)**
- **Issue:** every ebook request delete (any status, e.g. a `failed` one that never downloaded) unlinked the only ebook in `Audiobook.filePath`, or every ebook there when the folder passed the audio evidence rule: the user's own epub beside an imported audiobook went
- **Cause:** nothing recorded which file an ebook import placed; `planEbookDelete` guessed from the folder
- **Fix:** the ebook organize records the file it copied (`Request.placedEbookFiles`, only for placeFile `copied`); the delete removes only recorded, unchanged files behind rules a-c (D2 above). `planEbookDelete` removed
- **Responses:** the record holds absolute library paths and is read only by the delete: every response that returns a request row leaves it out, for admins too (`hidePlacementRecord()`/`hideStoredPick()` in `src/lib/services/request-detail-query.ts`; `GET /api/requests` sets it `undefined` as it does `audiobook.filePath`)
- **Limits** (none removes more than before #497; all but the second keep the file):
  - Ebook requests imported before this version have no record: their delete removes no ebook file (reason shown; remove by hand). A crash between the copy and the record write, or a failed record write, leaves that file unrecorded (kept)
  - Another active ebook request on the same book whose import found this file already there (`[]`) does not hold it: deleting the request that placed it removes it, and the other request still shows `downloaded` (as before #497)
  - A delete while the request's import is still running: the file that import places afterwards is not recorded on a live request, so RMAB never removes it
  - Two organizes of one request at once (e.g. a Manual Import while a stalled job re-runs) can lose one entry: that file is kept
  - A flat ebook shelf stored by two books (`ebook_path_template = Ebooks`): rule c keeps every recorded file there (`it is also the folder of "<title>"`)
  - After `media_dir` moves, recorded paths under the old location fail rule a (`it is outside the media library (...)`) and are kept
  - The ebook's own folder (custom `ebook_path_template`) is left empty after its only file goes (no empty-parent sweep)

**9. Audiobook Request Delete Removed the Whole Book Folder (#526)**
- **Issue:** after the guard passed, `fs.rm(folder, { recursive })` removed everything in it: the ebook the same book's ebook request placed, the user's own files, NAS/ABS leftovers
- **Cause:** the evidence check proves only that the folder's direct audio is this import; nothing limited the removal to it
- **Fix:** D1 table above (audio of the hashed set; cover and junk only when nothing else is left; folder only when empty; `folderKept` lists what stayed); delivered ebook children stay, unlinked, the book keeps their folder; D2 empty-folder step. The automatic ebook request (`createEbookRequestIfEnabled`) and `find_missing_ebooks` look for an active ebook request by book (`audiobookId`), not by parent; a re-request's import links the surviving ebook request to the new audiobook request (the manual ebook routes look it up by parent). A reported-issue replace keeps the stored ebook path while a delivered ebook request remains
- **Limits:** other users' audiobook requests for the same book still lose the shared audio (per-user duplicate check, `request-creator.service.ts`; as before); a user-customized `cover.jpg` in a folder with nothing else of theirs is removed; folders holding other user files now stay (listed); a delivered legacy ebook child (no record) survives with `filePath` null, so its download 404s until the book is imported again; another user's completed audiobook request on the same book keeps a Download button that 404s after the delete (the stored path now points at the ebook folder, the download serves audio only)

## File Structure

```
Backend:
- prisma/schema.prisma (deletedAt, deletedBy fields)
- src/lib/services/request-delete.service.ts (deletion logic)
- src/lib/services/request-delete-download.ts (download in the client: remove / keep seeding / leave alone)
- src/lib/utils/torrent-ownership.ts (whether RMAB added the torrent)
- src/lib/services/request-delete-files.ts (library files, backend items, plex_library records)
- src/lib/utils/library-delete-guard.ts (assertSafeLibraryDelete)
- src/lib/utils/ebook-placement.ts (Request.placedEbookFiles: record write, read, per-file delete checks)
- src/lib/services/replace-library-content.ts (replace with no active request)
- src/app/api/admin/requests/[id]/route.ts (DELETE endpoint)
- src/lib/processors/cleanup-seeded-torrents.processor.ts (orphaned cleanup)

Frontend:
- src/app/admin/components/ConfirmDialog.tsx (confirmation modal)
- src/app/admin/components/RecentRequestsTable.tsx (Delete button + logic)

Queries Updated (deletedAt: null filters):
- src/app/api/requests/route.ts (GET, POST)
- src/app/api/requests/[id]/route.ts (GET, PATCH)
- src/app/api/admin/requests/recent/route.ts (GET)
- src/app/api/admin/metrics/route.ts (GET)
- src/app/api/admin/downloads/active/route.ts (GET)
- src/lib/processors/*.ts (all processors)
```

## Configuration

**No new config required** - uses existing:
- `prowlarr_indexers` (per indexer `seedingTimeMinutes` and `ratioLimit`), matched to the download by Prowlarr indexer id, else by name (`findIndexerConfig()`; the id is ignored when the recorded name is another configured indexer or the id's indexer has another protocol). Not a JSON list → the download is left in the client

## Security

- **Authorization:** Admin role required
- **Audit Trail:** `deletedBy` tracks admin user ID
- **Soft Delete:** Preserves history, prevents permanent data loss
- **Confirmation Required:** Prevents accidental deletion
- **Stored Path Only:** File cleanup targets the path recorded by the organizer; no template-based fallback

## Monitoring & Logging

**Logs:**
- `[RequestDelete]` prefix for deletion service
- `[CleanupSeededTorrents]` prefix for cleanup job
- Torrent status (removed/kept/unlimited)
- File deletion success/failure
- Orphaned request hard deletion

**Admin Dashboard:**
- Request count updates after deletion
- Recent requests table refreshes automatically
- Toast notifications (via console.log - can be enhanced)

## Future Enhancements

- Toast notifications instead of console.log
- Deletion history view (soft-deleted requests)
- Bulk delete operations
- Restore deleted requests (undo)
- Email notifications for deletions
- Deletion reason/notes field

## Related

- [Admin Dashboard](../admin-dashboard.md) - Dashboard overview
- [Scheduler](../backend/services/scheduler.md) - Cleanup job details
- [File Organization](../phase3/file-organization.md) - Media directory structure
- [qBittorrent](../phase3/qbittorrent.md) - Torrent management
