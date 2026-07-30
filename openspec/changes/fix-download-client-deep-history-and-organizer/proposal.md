# Proposal: Deep Download Client History, Orphaned Download Scanner, and Duplicate Classification

## Why
Two major bugs cause completed audiobooks to become stuck in `downloading` status or fail incorrectly:
1. **SABnzbd 100-Item Roll-Off Bug:** `sabnzbd.service.ts` line 615 hardcodes `getHistory(100)`. During high-volume batch runs, fast-downloading Usenet releases (which finish in ~20s) roll past the 100-item history limit before `monitor-download` polls them. `getNZB()` returns `null` ("not found"), leaving requests stuck in `downloading` status indefinitely while completed files sit unorganized in `/storage/downloads/nzb/complete/default/`.
2. **SABnzbd Duplicate Rejection Misclassification:** When an NZB is re-submitted for an already-downloaded file, SABnzbd rejects it with `Failing duplicate NZB` (mode `no_dupes = 3`). ReadMeABook misclassifies this rejection as "Download Failed" and marks the request as `failed`—even though the media file is already downloaded on disk.

## What Changes
1. **Deep History & Direct NZO Lookup:** Update `sabnzbd.service.ts` to query history by `nzo_id` directly (`/api?mode=history&nzo_id=...`) or paginate history without arbitrary 100-item cutoffs.
2. **Orphaned Completed Download Scanner:** Add a background worker (`scan-orphaned-downloads.processor.ts`) that periodically inspects `/storage/downloads/nzb/complete/default/` and matches un-imported folders to requests stuck in `downloading` / `awaiting_import` status, triggering `organize_files` automatically.
3. **Duplicate NZB Classifier:** Parse SABnzbd failure messages for `"duplicate nzb"` or `"already in history"`. When detected, verify if the completed media file exists in storage and transition request status to `downloaded` / `available` rather than `failed`.

## Capabilities

### User Capabilities
- Administrators can trigger an manual "Scan Completed Downloads Folder" job from the Web UI.
- Administrators can view detailed download client status and file organization logs for every request.

### System Capabilities
- The system automatically links fast Usenet downloads to requests regardless of SABnzbd history depth or queue roll-off.
- The system automatically recovers and imports existing media files when duplicate NZBs are rejected by SABnzbd.

## Impact & Non-Goals
- **Impact:** Eliminates orphaned completed downloads stuck in `downloading` status and prevents false `failed` status flags on duplicate Usenet submissions.
- **Non-Goals:** Does not alter SABnzbd's internal `no_dupes` policy setting; handles duplicate responses gracefully within ReadMeABook.
