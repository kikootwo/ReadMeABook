# Request Approval System

**Status:** ✅ Implemented | Admin approval workflow for user requests with global & per-user auto-approve controls

## Overview
Allows admins to review and approve/deny user requests before they are processed. Supports global auto-approve toggle and per-user auto-approve overrides. Interactive search requests store pre-selected torrents when approval is required.

## Key Details

### Request Statuses
- **awaiting_approval** - New status for requests pending admin approval
- **denied** - New status for requests rejected by admin
- **pending** - Status after approval (triggers search job)
- Applies to all existing statuses: pending, searching, downloading, processing, downloaded, available, failed, cancelled, awaiting_search, awaiting_import, warn

### Configuration Keys
- `auto_approve_requests` (Configuration table) - Global setting (true/false string)
- `User.autoApproveRequests` (User table) - Per-user override (boolean, nullable)
  - `null` = Use global setting
  - `true` = Always auto-approve for this user
  - `false` = Always require approval for this user

### Approval Logic

**When user creates request (automatic search via POST /api/requests):**
1. Check `User.autoApproveRequests`:
   - If `true` → Set status to 'pending', trigger search job, send approved notification
   - If `false` → Set status to 'awaiting_approval', wait for admin, send pending notification
   - If `null` → Check global `auto_approve_requests` setting
     - If 'true' → Auto-approve (status: 'pending', send approved notification)
     - Otherwise → Require approval (status: 'awaiting_approval', send pending notification)

**When user creates request with pre-selected torrent (interactive search):**
- **Via POST /api/audiobooks/request-with-torrent** (book detail page):
  1. Check approval requirements (same logic as above)
  2. If approval needed → Set status to 'awaiting_approval', store torrent in `selectedTorrent`, send pending notification
  3. If auto-approved → Set status to 'downloading', start download immediately, send approved notification

- **Via POST /api/requests/{id}/select-torrent** (existing request):
  1. Check if request already in 'awaiting_approval' status → Block with 403 error
  2. Check approval requirements based on CURRENT settings
  3. If approval needed → Set status to 'awaiting_approval', store torrent in `selectedTorrent`, send pending notification
  4. If auto-approved → Set status to 'downloading', start download immediately, send approved notification

**Admin approval actions:**
- **Approve:**
  - If request has `selectedTorrent` → Download that specific torrent (clear `selectedTorrent` field)
  - If no `selectedTorrent` → Trigger automatic search job (status: 'pending')
  - Send approved notification
- **Deny:** → Change status to 'denied', no further processing

## API Endpoints

### POST /api/audiobooks/request-with-torrent
Create request with pre-selected torrent (book detail page interactive search)

**Auth:** User or Admin

**Request:**
```json
{
  "audiobook": { /* audiobook metadata */ },
  "torrent": { /* selected torrent data */ }
}
```

**Approval Check:**
- Checks approval requirements
- If needed → Status 'awaiting_approval', stores torrent, sends pending notification
- If auto-approved → Status 'downloading', starts download, sends approved notification

**Response (awaiting approval):**
```json
{
  "success": true,
  "request": { /* request with status: 'awaiting_approval' */ },
  "message": "Request submitted for admin approval"
}
```

**Response (auto-approved):**
```json
{
  "success": true,
  "request": { /* request with status: 'downloading' */ }
}
```

### POST /api/requests/[id]/select-torrent
Select torrent for existing request (request page interactive search)

**Auth:** User (owner) or Admin

**Request:**
```json
{
  "torrent": { /* selected torrent data */ }
}
```

**Approval Check:**
- Blocks if already in 'awaiting_approval' status
- Re-checks approval requirements based on CURRENT settings
- If needed → Status 'awaiting_approval', stores torrent, sends pending notification
- If auto-approved → Status 'downloading', starts download, sends approved notification

**Response (awaiting approval):**
```json
{
  "success": true,
  "request": { /* request with status: 'awaiting_approval' */ },
  "message": "Request submitted for admin approval"
}
```

**Response (auto-approved):**
```json
{
  "success": true,
  "request": { /* request with status: 'downloading' */ },
  "message": "Torrent download initiated"
}
```

### GET /api/admin/requests/pending-approval
Fetch all requests with status 'awaiting_approval'

**Auth:** Admin only

**Response:**
```json
{
  "success": true,
  "requests": [
    {
      "id": "uuid",
      "createdAt": "2026-01-15T12:00:00Z",
      "audiobook": {
        "title": "Book Title",
        "author": "Author Name",
        "coverArtUrl": "https://..."
      },
      "user": {
        "id": "uuid",
        "plexUsername": "username",
        "avatarUrl": "https://..."
      }
    }
  ],
  "count": 5
}
```

### POST /api/admin/requests/[id]/approve
Approve or deny a specific request

**Auth:** Admin only

**Request:**
```json
{
  "action": "approve" | "deny"
}
```

**Approval Logic:**
- If request has `selectedTorrent`:
  - Downloads that specific torrent directly (status: 'downloading')
  - Clears `selectedTorrent` field after use
  - Message: "Request approved and download started with pre-selected torrent"
- If no `selectedTorrent`:
  - Triggers automatic search job (status: 'pending')
  - Message: "Request approved and search job triggered"
- Both send approved notification

**Response (approve with pre-selected torrent):**
```json
{
  "success": true,
  "message": "Request approved and download started with pre-selected torrent",
  "request": { /* full request object with status: 'downloading' */ }
}
```

**Response (approve without pre-selected torrent):**
```json
{
  "success": true,
  "message": "Request approved and search job triggered",
  "request": { /* full request object with status: 'pending' */ }
}
```

**Response (deny):**
```json
{
  "success": true,
  "message": "Request denied",
  "request": { /* full request object with status: 'denied' */ }
}
```

**Errors:**
- `404` - Request not found
- `400` - Request not in 'awaiting_approval' status
- `400` - Invalid action (must be 'approve' or 'deny')

### GET /api/admin/settings/auto-approve
Get global auto-approve setting

**Auth:** Admin only

**Response:**
```json
{
  "autoApproveRequests": true
}
```

### PATCH /api/admin/settings/auto-approve
Update global auto-approve setting

**Auth:** Admin only

**Request:**
```json
{
  "autoApproveRequests": true
}
```

**Response:**
```json
{
  "autoApproveRequests": true
}
```

### PUT /api/admin/users/[id]
Update user (includes autoApproveRequests field)

**Auth:** Admin only

**Request:**
```json
{
  "autoApproveRequests": true | false | null
}
```

## UI Features

### Admin Dashboard (/admin)
**Requests Awaiting Approval Section:**
- Shows only when pending approval requests exist
- Grid layout with book cards (3 columns on desktop)
- Each card displays:
  - Book cover image
  - Title and author
  - User avatar and username
  - Request timestamp (relative: "2 hours ago")
  - Info button (ⓘ, top-right corner) — opens AudiobookDetailsModal for full book details
  - Approve button (green, checkmark icon)
  - Search button (blue, magnifier icon) — opens InteractiveTorrentSearchModal
  - Deny button (red, X icon)
- **Info modal:** `AudiobookDetailsModal` rendered with `adminActions` prop containing Approve/Search/Deny buttons, allowing admin to review full book details (cover, description, series, genres, narrator, etc.) without leaving the approval workflow
- Auto-refreshes every 10 seconds (SWR)
- Loading states on buttons during approval/denial
- Success/error toast notifications
- Mutates multiple caches on action: pending-approval, recent requests, metrics

### Admin Users Page (/admin/users)
**Global Auto-Approve Toggle:**
- Checkbox at top of page
- Label: "Auto-approve all requests by default"
- Updates `auto_approve_requests` configuration
- Optimistic UI update with revert on error
- Toast notification on success/error

**Per-User Auto-Approve Control:**
- Each user row has toggle dropdown:
  - "Use Global Setting" (null, default)
  - "Always Auto-Approve" (true)
  - "Always Require Approval" (false)
- Updates `User.autoApproveRequests` field
- Shows current effective setting (considers global + per-user)
- Optimistic UI update

### User Request Flow
**When creating request (POST /api/requests):**
- System checks approval logic (see above)
- If awaiting approval → User sees status "Awaiting Approval" on request card
- If auto-approved → User sees status "Pending" and processing begins

### Request Status Badges
- **awaiting_approval** → Amber badge with warning icon
- **denied** → Red badge with X icon
- All other statuses → Existing badge colors

## Security

**Interactive Search Approval Enforcement:**
- All interactive search flows (request-with-torrent, select-torrent) check approval requirements
- If approval needed, torrent is stored in `selectedTorrent` field and request enters 'awaiting_approval' status
- Admin sees exact torrent user selected when reviewing approval
- Upon approval, admin approves THAT specific torrent (no re-search)

**Settings Change Protection:**
- `select-torrent` endpoint re-checks approval requirements based on CURRENT settings
- Prevents bypass: User with auto-approve enabled creates request → Admin disables auto-approve → User tries to download
- If settings changed, torrent is stored and request enters approval queue

**Notification Timing:**
- Automatic search: Notification sent immediately on request creation
- Interactive search (auto-approved): Notification sent when torrent selected and download starts
- Interactive search (approval needed): Pending notification sent immediately, approved notification sent on admin approval

## Database Schema

### User Table
```prisma
autoApproveRequests: Boolean (nullable, default null)
- null: Use global setting
- true: Always auto-approve
- false: Always require approval
```

### Request Table
```prisma
status: Enum (includes 'awaiting_approval', 'denied')
selectedTorrent: Json (nullable)
- Stores pre-selected torrent data from interactive search
- Set when approval needed, cleared after admin approval
- Contains: guid, title, size, seeders, indexer, downloadUrl, format, etc.
```

### Configuration Table
```prisma
key: 'auto_approve_requests'
value: 'true' | 'false' (string)
```

## Fixed Issues ✅

**1. BookDate Requests Bypass Approval System**
- Issue: Requests created through BookDate (right swipe) bypassed approval system entirely
- Security Impact: Critical - allowed users to bypass admin approval controls
- Cause: BookDate swipe route created requests with hardcoded 'pending' status, no approval checks, no notifications
- Fix: Implemented full approval logic in BookDate swipe route (same as POST /api/requests)
  - Checks user.autoApproveRequests and global auto_approve_requests setting
  - Sets correct status ('awaiting_approval' or 'pending')
  - Sends appropriate notifications (request_pending_approval or request_approved)
  - Only triggers search job if auto-approved
- Files updated: `src/app/api/bookdate/swipe/route.ts:124-217`, `tests/api/bookdate.routes.test.ts:470-648`

## Related
- [Admin Dashboard](../admin-dashboard.md) - Dashboard UI features
- [Database Schema](../backend/database.md) - User and Request tables
- [Settings Pages](../settings-pages.md) - Global settings management
- [BookDate Feature](../features/bookdate.md) - AI recommendations (Fixed Issues #9)
