# Bulk Import Feature

**Status:** ✅ Implemented | Admin-only | Multi-step wizard modal

## Overview
Lets admins scan a server folder recursively, discover audiobook subfolders, match against Audible, review matches, and import selected books via the existing manual import pipeline.

## Flow
1. **Select Folder** — Browse base folders (Downloads, Media Library, Book Drop), pick scan root
2. **Scan & Match** — Recursively discover audiobook folders (max 10 levels), read metadata via ffprobe, search Audible per book (1.5s rate limit)
3. **Review & Import** — Scrollable list with skip toggles, library status, confidence badges; Start Import queues organize_files jobs

## Key Details
- **Access:** Admin-only, modal opened from admin dashboard Quick Actions
- **Audio detection:** Uses `AUDIO_EXTENSIONS` from `src/lib/constants/audio-formats.ts`
- **Audiobook boundary:** A folder containing audio files = one audiobook. Files with matching metadata tags are grouped by title+author+narrator. Files with no metadata title tag are all grouped together per folder (one entry, not one per file).
- **Metadata extraction:** ffprobe reads `album` (title), `album_artist` (author), `composer` (narrator) from all audio files in folder
- **Search term fallback chain** (when no `album` tag):
  1. **ASIN in folder name** — scans folder name for pattern `B[A-Z0-9]{9}` bounded by bracket/paren/space; if found, uses direct ASIN lookup instead of text search; no badge shown
  2. **Folder name** — cleaned (strips bracketed ASIN/year, underscores→spaces); skipped if generic (CD1, Disc 2, Part 3, Vol 1, etc.); shows "Low Confidence" badge
  3. **First file name** — last resort; shows "Low Confidence" badge
- **Generic folder detection:** `/^(cd|disc|disk|part|vol(ume)?)\s*\d+$/i` — these names are skipped as search terms
- **Author/narrator dedup:** Splits on `,;& ` delimiters, removes names appearing in both fields
- **Scan depth:** Max 10 levels recursion
- **Rate limiting:** 1.5s delay between Audible searches (same as existing scraping rate limit)
- **Library check:** Uses `findPlexMatch()` for ASIN-based availability detection
- **Import:** Reuses existing `organize_files` job queue (same as manual import)
- **No new database tables** — all state is ephemeral during wizard session

## API Endpoints

**POST /api/admin/bulk-import/scan** (SSE stream)
- Body: `{ rootPath: string }`
- Path validation: must be within download_dir, media_dir, or /bookdrop
- Streams events: `progress`, `discovery_complete`, `matching`, `book_matched`, `complete`, `error`
- Each `book_matched` event includes: folderPath, match (Audible data), inLibrary, hasActiveRequest, metadataSource

**POST /api/admin/bulk-import/execute**
- Body: `{ imports: Array<{ folderPath: string, asin: string }> }`
- Creates audiobook records + requests, queues organize_files jobs
- Returns: `{ success, results[], summary: { total, succeeded, failed } }`

## SSE Event Types

| Event | Data | When |
|---|---|---|
| `progress` | `{ phase, foldersScanned, audiobooksFound, currentFolder }` | During folder discovery |
| `discovery_complete` | `{ totalFound, message }` | All folders scanned |
| `matching` | `{ current, total, folderName, searchTerm }` | Before each Audible search |
| `book_matched` | Full book result with match data | After each Audible search |
| `complete` | `{ audiobooks[], totalFound, matched, inLibrary }` | All matching done |
| `error` | `{ message }` | On failure |

## UI States

| State | Visual |
|---|---|
| Normal (will import) | Full opacity, blue toggle ON |
| Skipped by user | 40% opacity, gray toggle OFF |
| Already in library | 40% opacity, green "In Library" badge, toggle disabled |
| Active request exists | 40% opacity, purple "Requested" badge, toggle disabled |
| No Audible match | Red "No Match" badge, folder name shown, pre-skipped |
| ASIN extracted from folder name | No badge (high confidence — direct ASIN lookup) |
| Low confidence (folder name or file name fallback, no ASIN) | Amber "Low Confidence" badge |

## Files

**Backend:**
- `src/lib/utils/bulk-import-scanner.ts` — Folder discovery + ffprobe metadata
- `src/app/api/admin/bulk-import/scan/route.ts` — SSE scan endpoint
- `src/app/api/admin/bulk-import/execute/route.ts` — Batch import endpoint

**Frontend:**
- `src/components/admin/BulkImportWizard.tsx` — Modal orchestrator
- `src/components/admin/bulk-import/types.ts` — Shared types
- `src/components/admin/bulk-import/ScanFolderStep.tsx` — Folder browser
- `src/components/admin/bulk-import/ScanProgressStep.tsx` — Progress display
- `src/components/admin/bulk-import/MatchReviewStep.tsx` — Review list + import

**Modified:**
- `src/app/admin/page.tsx` — Added Bulk Import quick action + modal

## Related
- [Manual Import](manual-import.md) — Single-book import (reused pipeline)
- [File Organization](../phase3/file-organization.md) — organize_files job
- [Audible Integration](../integrations/audible.md) — Search/scraping
- [Background Jobs](../backend/services/jobs.md) — Job queue system
