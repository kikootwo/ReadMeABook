# Manual Import Feature — Acceptance Criteria

**Status:** ⏳ In Progress

## Overview
Allow admins to manually import audiobook files from the server filesystem into RMAB's processing pipeline for a specific book.

## Acceptance Criteria

### AC-1: Manual Import Button (Frontend)
- [ ] "Manual Import" button visible on `AudiobookDetailsModal` for admin users only
- [ ] Button hidden when book is in active processing states: `downloading`, `processing`, `searching`
- [ ] Button uses `FolderArrowDownIcon` from Heroicons
- [ ] Clicking opens the file browser modal

### AC-2: File Browser Modal — Phase 1 (Browse)
- [ ] Modal opens at `max-w-2xl`, rounded-2xl, with header/breadcrumb/listing/footer regions
- [ ] Root view shows two entry tiles: Downloads and Media Library (paths from `download_dir` and `media_dir` config)
- [ ] Each folder row shows: folder icon, name, metadata line (audio file count, subfolder count, total size)
- [ ] Blue `♪ N` badge on folders containing audio files
- [ ] Folder icon swaps to `FolderOpenIcon` on hover (150ms transition)
- [ ] Single-click selects folder (only if it has audio files); double-click navigates into it
- [ ] Folders without audio files shown at reduced opacity, still navigable but not selectable
- [ ] Breadcrumb navigation with clickable segments, home icon for root, ellipsis collapse for deep paths
- [ ] Footer shows selected path (monospace), file stats, "Review Import →" button (only when valid selection)
- [ ] Directional slide animations: right when going deeper, left when going back
- [ ] Loading skeletons during directory fetch
- [ ] Empty state for empty directories
- [ ] Error state with "Try Again" for failed directory reads
- [ ] Dark mode support throughout

### AC-3: File Browser Modal — Phase 2 (Confirm)
- [ ] Slide transition from browse to confirm phase
- [ ] Shows book context: cover thumbnail + title + author
- [ ] Shows selected folder: path (monospace) + stats in inset block
- [ ] Numbered "What will happen" list: (1) copy to media library, (2) tag metadata, (3) download cover art, (4) scan library
- [ ] "Back" button returns to browse phase
- [ ] "Start Import" primary button triggers the import
- [ ] Button shows loading state during API call
- [ ] Success: close modal, show success toast, trigger request list refresh
- [ ] Error: show error toast, stay on confirm screen

### AC-4: Filesystem Browse API
- [ ] `GET /api/admin/filesystem/browse?path=...` — admin-only endpoint
- [ ] Returns directory listing: `{ entries: [{ name, type, audioFileCount, subfolderCount, totalSize }] }`
- [ ] If no `path` param, returns root directories (download_dir, media_dir from config)
- [ ] Path validation: must be within allowed root directories (prevent directory traversal)
- [ ] Handles permission errors gracefully
- [ ] Sorts: folders first, then alphabetical

### AC-5: Manual Import API
- [ ] `POST /api/admin/manual-import` — admin-only endpoint
- [ ] Request body: `{ audiobookId: string, folderPath: string }`
- [ ] Path validation: folderPath must be within allowed roots
- [ ] Validates folder exists and contains audio files
- [ ] If no existing request: creates request (status: `processing`) + queues `organize_files` job
- [ ] If existing request (non-active state): updates status to `processing` + queues `organize_files` job
- [ ] Returns: `{ success: true, requestId: string }`
- [ ] Proper error responses for: invalid path, no audio files, already processing, book not found

### AC-6: Integration with Existing Pipeline
- [ ] The `organize_files` job processes the manual import folder identically to download-client-delivered folders
- [ ] Files are copied (not moved) to the media library
- [ ] Metadata tagging, cover art download, file hash generation all work as normal
- [ ] Library scan triggered after organization (if configured)
- [ ] Request status progresses: processing → downloaded → available (via scheduled scan)

### AC-7: Docker Build
- [ ] `docker compose build readmeabook` succeeds with no errors

## Non-Goals
- No "move" option (copy only, matching existing pipeline)
- No file-level selection (folder only)
- No drag-and-drop upload
- No non-admin access

## Technical Notes
- Audio extensions: `.m4b`, `.m4a`, `.mp3`, `.mp4`, `.aa`, `.aax`, `.flac`, `.ogg` (from `src/lib/constants/audio-formats.ts`)
- Config keys: `download_dir` (database), `media_dir` (database)
- Existing file organizer: `src/lib/utils/file-organizer.ts`
- Organize processor: `src/lib/processors/organize-files.processor.ts`
- Job queue service: `src/lib/services/job-queue.service.ts`
- Auth middleware: `requireAuth()`, `requireAdmin()` from `src/lib/middleware/auth.ts`
- Frontend API pattern: `fetchWithAuth()` from `src/lib/utils/api.ts`
- Modal base: `src/components/ui/Modal.tsx`
- Audiobook details modal: `src/components/audiobooks/AudiobookDetailsModal.tsx`
- Toast: `useToast()` from toast context
