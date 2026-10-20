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

### Deletion Logic Flow

**Service:** `src/lib/services/request-delete.service.ts`

**Steps:**

1. **Find Request**
   - Query: `deletedAt: null`
   - Return 404 if not found or already deleted

2. **Handle Downloads & Seeding**

   For each selected download:

   ```
   IF torrent not in qBittorrent:
     → Skip (already removed)

   ELSE IF unlimited seeding (no indexer config, or seedingTimeMinutes AND ratioLimit both 0):
     → Log: "Keeping for unlimited seeding"
     → Do nothing (stop monitoring)
     → torrentsKeptUnlimited++

   ELSE IF download not completed, OR evaluateSeeding(config, {seedingTime, ratio}).met:
     (src/lib/utils/seeding-policy.ts, same rule as cleanup_seeded_torrents: every set
      limit met; 0 turns a limit off; unreported ratio with ratioLimit > 0 = not met)
     IF another active request uses the same torrentHash (otherActiveRequestsUsingTorrent,
        src/lib/utils/shared-torrent.ts, shared with the cleanup job):
       → Keep torrent → torrentsKeptShared++
     ELSE:
       → Delete torrent + files → torrentsRemoved++

   ELSE (still seeding):
     → Log: "Keeping ... to finish seeding: ratio a/b, time x/y min"
     → torrentsKeptSeeding++ (cleanup job removes it later)
   ```

3. **Library Delete Guard** (`src/lib/utils/library-delete-guard.ts`, run from `src/lib/services/request-delete-files.ts`)
   - Path: persisted `Audiobook.filePath` only (never rebuilt from `media_dir` or a template)
   - The stored folder is removed (`rm -rf`) only when ALL hold, else nothing is removed:
     | Rule | Refusal reason (`filesKeptReason`) |
     |------|------------------------------------|
     | a. strictly inside `media_dir` | `it is the media library root` / `it is outside the media library (...)` |
     | b. equals/contains no configured root (download dirs, client paths, mapped paths, `/bookdrop`) | `it is a configured root (...)` / `it contains a configured root (...)` |
     | c. equals/contains no other book's `filePath` (each row canonicalized: realpath + dev/ino; missing rows skipped) | `it is also the folder of "<title>"` / `it contains the folder of "<title>"` |
     | evidence: audio directly in the folder hashes to `filesHash` | `folder contents changed since import` / `there is no import record (files hash) for this folder` |
     | evidence: no audio in any subfolder (the removal is recursive) | `it has audio files in a subfolder` |
   - Roots are read strictly from the DB (`collectGuardRoots`, fail closed: any error refuses)
   - Symlinked title folder: rules a-c on the target AND the link location; only the link is removed
   - No stored path but a library item (`absItemId`/`plexGuid`): kept (`RMAB has no stored folder ...`); no path and no item: nothing to remove
   - Missing folder: "already gone" only when the library looks mounted (`media_dir` readable and not empty, and some other stored book folder exists when other rows have one); otherwise kept (`the folder is missing and ... is the media volume mounted?`): no backend call, row untouched (protects against a media volume not mounted yet)
   - Mount-check limit: a mount point that received new imports while the share was unmounted is not empty, so it passes; a missing folder there then counts as gone (no Plex delete; ABS `hard=0` only for an item inside that path; row cleared)
   - Stale record: the stored folder is gone AND outside the current `media_dir` (library moved): nothing removed or protected; the delete clears only `filePath`/`filesHash`/`fileFormat` (no backend call, records and status kept; message says so), a replace goes on
   - `rm` failure: kept (`the folder was partly removed (permission denied); remove the rest manually`); `fs.rm` stops at the first error, so earlier files are gone; backend and row untouched
   - After removal: empty parents swept up to the nearest root (`sweepEmptyParents`)
   - **Ebook requests (D2):** rules a-c on `filePath`, then unlink every ebook file directly in it if the folder passes the evidence rule, or the only one if it holds exactly one; otherwise kept (`it holds N ebook files and is not provably this book's folder (...)`). A shared `{author}` or flat `Ebooks` folder fails rule c when another book points at it. Never a sweep of other books' ebooks
   - Not handled (needs a separate ebook location, PR2): an ebook in a separate folder (custom `ebook_path_template`) is not removed by the audiobook delete

4. **Files kept: library left exactly as it is**
   - No backend delete, no plex_library cleanup, no status reset, linkage and stored paths kept
   - Request still soft-deleted; result `filesDeleted: false`, `filesKeptReason`, message `Request deleted; files kept: <reason>`

5. **Backend item (only after RMAB removed the folder, or found it already gone)**
   - **Audiobookshelf:** `DELETE /api/items/<id>?hard=0` (database entry only; RMAB already removed the files), only when the item's `path` is inside the removed folder, or its `relPath` matches the folder's path relative to `media_dir` (ABS mounting the library elsewhere). Otherwise skipped (a second copy elsewhere survives). The `relPath` match can also hit the same relative path in another ABS library folder; with `hard=0` only that item's database entry goes (the next ABS scan re-adds it)
   - **Plex:** `DELETE /library/metadata/{ratingKey}` only after RMAB removed the folder itself, and only when every file Plex lists for the item and its tracks (`getItemFilePaths`: Media > Part `file`) is inside it; otherwise (incl. a folder that was already gone) skipped, the next library scan drops it
   - `deleteABSItem(id, { hard })`: `hard: true` (`?hard=1`) also deletes files; only a replace of a book added outside RMAB (no request, no stored folder; `replace-library-content.ts`) uses it

6. **plex_library records, linkage, stored paths** (only after removal / already gone)
   - plex_library delete by ASIN, fallback exact title/author
   - Audiobook: `status = 'requested'`, clear `absItemId` (ABS) or `plexGuid` (Plex), clear `filePath`, `filesHash`, `fileFormat`
   - Child requests soft-deleted: `parentRequestId = id`, and ebook requests with no parent on the same book row

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
- **Active requests:** Delete torrent when seeding complete
- **Soft-deleted requests:** Delete torrent + hard-delete request when seeding complete
- **Unlimited seeding:** Hard-delete orphaned request immediately (no monitoring)

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
    "filesKeptReason": "folder contents changed since import"
  }
}
```
- `filesKeptReason` present only when library files were kept; the request is still deleted (HTTP 200)

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
- **Also:** deletion now skips removing a torrent another active request still uses (`otherActiveRequestsUsingTorrent()`, same check as the cleanup job). Behaviour change: a ratio-only indexer's incomplete download is removed on delete (it was kept forever as "unlimited")

## File Structure

```
Backend:
- prisma/schema.prisma (deletedAt, deletedBy fields)
- src/lib/services/request-delete.service.ts (deletion logic)
- src/lib/services/request-delete-files.ts (library files, backend items, plex_library records)
- src/lib/utils/library-delete-guard.ts (assertSafeLibraryDelete, planEbookDelete)
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
- `prowlarr_indexers` (per indexer `seedingTimeMinutes` and `ratioLimit`)

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
