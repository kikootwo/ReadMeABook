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

   ELSE IF unlimited seeding (0):
     → Log: "Keeping for unlimited seeding"
     → Do nothing (stop monitoring)
     → torrentsKeptUnlimited++

   ELSE IF download not completed:
     → Delete torrent + files
     → torrentsRemoved++

   ELSE:
     → Query actual seeding time
     → Calculate remaining = (target - actual)

     IF remaining > 0:
       → Log: "Keeping for X more minutes"
       → torrentsKeptSeeding++
     ELSE:
       → Delete torrent + files
       → torrentsRemoved++
   ```

3. **Delete Media Files**
   - Path: `[media_dir]/[author]/[title]/`
   - **ONLY deletes title folder** (not author folder)
   - Handles missing folders gracefully

4. **Soft Delete Request**
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
    "torrentsKeptUnlimited": 0
  }
}
```

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
2. ✅ **Unlimited seeding (0)** - Keep in qBittorrent, hard-delete orphaned request
3. ✅ **Incomplete download** - Delete torrent + files immediately
4. ✅ **Seeding requirement met** - Delete torrent + files
5. ✅ **Still seeding** - Keep torrent, soft-delete request, cleanup job handles later
6. ✅ **Media folder not found** - Log and continue (already deleted)
7. ✅ **Multiple delete clicks** - Button disabled during deletion
8. ✅ **Network error** - Alert shown, request remains

## File Structure

```
Backend:
- prisma/schema.prisma (deletedAt, deletedBy fields)
- src/lib/services/request-delete.service.ts (deletion logic)
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
- `prowlarr_indexers` (seeding time per indexer)
- `media_dir` (file deletion path)

## Security

- **Authorization:** Admin role required
- **Audit Trail:** `deletedBy` tracks admin user ID
- **Soft Delete:** Preserves history, prevents permanent data loss
- **Confirmation Required:** Prevents accidental deletion

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
