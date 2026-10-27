# Manual Import Feature — Acceptance Criteria

**Status:** ⏳ In Progress

## Overview
Allow admins to manually import audiobook files from the server filesystem into RMAB's processing pipeline for a specific book. From an ebook request (My Requests ebook card) it imports ebook files for that ebook request instead.

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
- [x] Folders navigate on click; the footer "Select This Folder" (or "Select N Files") selects the current folder when it lists audio (single-click selection is not used)
- [x] Multi-disc book folders (2+ disc folders with direct audio: `Disc 1/`, `CD2/`) are selectable: their files are listed as `Disc 1/01.m4a`, footer "N audio files in M discs"; `Extras/` is not included. See [multi-disc-folders.md](multi-disc-folders.md)
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
- [x] `type=ebook` (ebook import): `{ path, entries, ebookFiles: [{ name, size }] }`, the ebook files directly in the folder (`EBOOK_EXTENSIONS`), no disc folders; unknown `type` → 400
- [x] Current response: `{ path, entries: [{ name, type }], audioFiles: [{ name, size }] }`; a multi-disc folder (never a configured root) adds its disc files to `audioFiles` (relative names, disc by disc, names in natural order inside a disc; the import may reorder a disc by its track tags)
- [ ] Path validation: must be within allowed root directories (prevent directory traversal)
- [ ] Handles permission errors gracefully
- [ ] Sorts: folders first, then alphabetical

### AC-5: Manual Import API
- [ ] `POST /api/admin/manual-import` — admin-only endpoint
- [ ] Request body: `{ audiobookId: string, folderPath: string }`
- [x] Ebook import: body adds `requestId` (the ebook request) and `requestType: 'ebook'`. The stored request's type decides (a `requestType` that disagrees, or an unknown one → 400); the files must be ebook files directly in the folder (audio, `/`, `..` → 400), none selected = every ebook file in the folder. Recycles or creates only an **ebook** request (new one: `parentRequestId` = the book's delivered audiobook request) and queues `organize_files` with the ebook files as `selectedFiles`; the ebook branch imports the preferred one of them (`preferredEbookFile`, `EBOOK_EXTENSIONS` order). Logic: `src/lib/services/manual-import.service.ts`
- [x] Current body: `{ audiobookId | asin | requestId, folderPath, selectedFiles?: string[], cleanupSource?: boolean, requestType?: 'audiobook' | 'ebook' }`. `selectedFiles` without `/` = files in the folder (stat-checked); with `/` = exact members of the multi-disc book set (`..`, `.`, absolute, backslash, `//`, NUL, `Extras/x` → 400). No `selectedFiles` on a disc-only folder: the route sends the book set itself, so the import and any source removal stay scoped to the book
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
- Indexer "remove after processing" cleanup never runs for manual imports (no `downloadHistoryId`); `cleanupSource` never deletes the organize target, a configured root, files inside the target, or a whole folder inside the media library. A failed manual import is marked `failed` (re-run it); it is never retried as a client download. Source files are removed only once their copy in the library is verified; files that were not imported stay and are listed in the job log, and the request shows `n of m files not imported`. See [file-organization.md](../phase3/file-organization.md#post-organize-cleanup-safety)

### AC-7: Docker Build
- [ ] `docker compose build readmeabook` succeeds with no errors

## Fixed Issues
- **Manual Import from an ebook request acted on the audiobook (#278):** the modal never passed the request type to `ManualImportBrowser`, so an ebook card listed only audio, accepted only audio, and recycled the book's **audiobook** request (even `available`), re-running the audiobook organize on the folder (with `cleanupSource` if ticked). Fixed: type flows card → modal → browser → browse/import APIs; an ebook import touches only ebook requests and files; its source cleanup removes only the imported ebook file, through the same delete guard

## Non-Goals
- No "move" option (copy only, matching existing pipeline)
- No drag-and-drop upload
- No non-admin access

## Technical Notes
- Audio extensions: `.m4b`, `.m4a`, `.mp3`, `.mp4`, `.aa`, `.aax`, `.flac`, `.ogg` (from `src/lib/constants/audio-formats.ts`)
- Ebook extensions: `EBOOK_EXTENSIONS` in the same file, the one list (`.epub`, `.pdf`, `.mobi`, `.azw3`, `.azw`, `.fb2`, `.cbz`, `.cbr`, preference order); `ORGANIZER_EBOOK_FORMATS` and `isEbookFile` (`import-inventory.ts`) derive from it
- Config keys: `download_dir` (database), `media_dir` (database)
- Existing file organizer: `src/lib/utils/file-organizer.ts`
- Organize processor: `src/lib/processors/organize-files.processor.ts`
- Job queue service: `src/lib/services/job-queue.service.ts`
- Auth middleware: `requireAuth()`, `requireAdmin()` from `src/lib/middleware/auth.ts`
- Frontend API pattern: `fetchWithAuth()` from `src/lib/utils/api.ts`
- Modal base: `src/components/ui/Modal.tsx`
- Audiobook details modal: `src/components/audiobooks/AudiobookDetailsModal.tsx`
- Toast: `useToast()` from toast context
