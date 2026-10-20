# File Organization System

**Status:** ✅ Implemented

Copies completed downloads to standardized directory structure for Plex. Automatically tags audio files with correct metadata. Originals kept for seeding, cleaned up by scheduled job after requirements met.

## Target Structure

Target directory read from database config `media_dir` (configurable in setup wizard and settings).

**Template-based organization:**
- Config key: `audiobook_path_template`
- Default: `{author}/{title} {asin}`
- Variables: `{author}`, `{title}`, `{narrator}`, `{asin}`, `{year}`
- Optional variables (narrator, asin, year) are removed if not available

**Examples:**
```
Template: {author}/{title} {asin}
Result: Douglas Adams/The Hitchhiker's Guide to the Galaxy B0009JKV9W/

Template: {author}/{title} ({year})
Result: Douglas Adams/The Hitchhiker's Guide to the Galaxy (2005)/

Template: {author}/{narrator}/{title}
Result: Douglas Adams/Stephen Fry/The Hitchhiker's Guide to the Galaxy/
```

**Legacy behavior (hardcoded):**
- With year and ASIN: `Book Title (Year) ASIN`
- With ASIN only: `Book Title ASIN`
- With year only: `Book Title (Year)`
- Fallback: `Book Title`

**Rationale:** Template system allows customization for different metadata agent configurations and user preferences while maintaining backward compatibility.

## Process

1. Download completes in `/downloads/[torrent-name]/` or `/downloads/[filename]` (single file)
1b. **Path stored** in `DownloadHistory.downloadPath` (mapped local path) for retry reliability — avoids reconstructing path from `torrentName` which may differ from actual folder name
2. Identify audiobook files (.m4b, .m4a, .mp3, .mp4, .aa, .aax, .flac, .ogg) - supports both directories and single files
3. Read media directory and path template from database config (`media_dir`, `audiobook_path_template`)
4. Apply template to create target path: `[media_dir]/[template result]/`
5. **Copy** files (not move - originals stay for seeding)
6. **Tag metadata** (if enabled) - writes correct title, author, narrator, ASIN to audio files
7. Copy cover art if found, else download from Audible. `coverArtUrl` must be a cached thumbnail `/api/cache/thumbnails/<file>` (plain file name, resolved in `/app/cache/thumbnails`) or an https URL on `COVER_ART_HOSTS` (`*.media-amazon.com`, `*.ssl-images-amazon.com`, `*.images-amazon.com`), up to `MAX_COVER_ART_REDIRECTS` (3) redirects with every hop checked; anything else is skipped with a warning (`src/lib/utils/cover-art-url.ts`). Downloaded and copied covers get the library file mode. At request creation, covers are stored for display if they are any http(s) URL or a safe cached path (`sanitizeCoverArtUrl`; shelf-sync Goodreads/Hardcover fallbacks stay visible); a stored cover the library can't use is replaced by a later usable one (`isLibraryCoverSource`)
8. **Coerce file formats** (if enabled) - rename .mp4 → .m4b and single-file .m4a → .m4b for Plex compatibility (see: Plex Format Coercion below)
9. **Generate file hash** - SHA256 of sorted audio filenames for library matching (see: [fixes/file-hash-matching.md](../fixes/file-hash-matching.md))
10. Update request status to `downloaded` and store file hash in `audiobooks.files_hash`
11. **Trigger filesystem scan** (if enabled) - tells Plex/ABS to scan for new files
12. Originals remain until seeding requirements met

## Filesystem Scan Triggering

**Status:** ✅ Implemented (Both Backends)

**Purpose:** Trigger Plex/Audiobookshelf to scan filesystem after organizing files, ensuring new books appear immediately for users with disabled filesystem watchers.

**Configuration:**
- Plex: `plex.trigger_scan_after_import` (boolean, default: false)
- Audiobookshelf: `audiobookshelf.trigger_scan_after_import` (boolean, default: false)

**Flow:**
1. Files organized to media directory
2. Request status updated to `downloaded`
3. Check config setting (backend-specific)
4. If enabled: Call `ILibraryService.triggerLibraryScan(libraryId)`
5. Media server scans filesystem (async operation)
6. RMAB's scheduled check eventually detects new book
7. Request status updates to `available`

**Implementation:**
- Uses existing `ILibraryService` abstraction
- `PlexLibraryService.triggerLibraryScan()` → `POST /library/sections/{id}/refresh`
- `AudiobookshelfLibraryService.triggerLibraryScan()` → `POST /api/libraries/{id}/scan`
- Called from `organize-files.processor.ts` after status update
- Backend-agnostic using factory pattern

**Error Handling:**
- Scan failures logged but don't fail organize job
- Graceful degradation: scheduled scans eventually detect the book
- Non-blocking: async operation doesn't delay other jobs

**Use Cases:**
- Users with Plex/ABS filesystem watcher disabled
- Network-mounted media directories with delayed inotify
- Users who prefer manual control over automatic scanning
- Most users keep this disabled (default) and rely on built-in watchers

## Metadata Tagging

**Status:** ✅ Implemented

**Purpose:** Automatically writes correct metadata to audio files during file organization to improve Plex matching accuracy.

**Supported Formats:**
- m4b, m4a, mp4 (AAC audiobooks)
- mp3 (ID3v2 tags)
- flac (Vorbis comment tags)

**Metadata Written:**
- `title` - Book title
- `album` - Book title (PRIMARY field for Plex matching)
- `album_artist` - Author (PRIMARY field for Plex matching)
- `artist` - Author (fallback)
- `composer` - Narrator (standard audiobook field)
- `date` - Year
- `ASIN` - Audible ASIN (custom tag)
  - M4B/M4A/MP4: `----:com.apple.iTunes:ASIN`
  - MP3: Custom ID3v2 tag

**Note:** ASIN is a custom metadata tag and may not appear in standard file properties viewers (Windows/macOS/Linux). Use specialized tools to verify:
```bash
# Verify ASIN metadata with ffprobe
ffprobe -v quiet -print_format json -show_format "audiobook.m4b" | grep -i asin

# Or use exiftool
exiftool "audiobook.m4b" | grep -i asin
```

**Configuration:**
- Key: `metadata_tagging_enabled` (Configuration table)
- Default: `true`
- Configurable in: Setup wizard (Paths step), Admin settings (Paths tab)

**Implementation:**
- Uses ffmpeg with `-codec copy` (no re-encoding, metadata only)
- Fast (no audio transcoding)
- Lossless (original audio preserved)
- Runs after file copy, before cover art download
- Non-blocking (errors don't fail file organization)
- Logs success/failure per file

**Benefits:**
- Fixes torrents with missing/incorrect metadata
- Ensures Plex can match audiobooks correctly
- Writes metadata from Audible/Audnexus (known accurate)
- Prevents "[Various Albums]" and other metadata issues
- Embeds ASIN directly in audio files for better identification and matching

**Tech Stack:**
- ffmpeg (system dependency - included in Docker image)
- `src/lib/utils/metadata-tagger.ts` - Tagging utility
- Integrated into `src/lib/utils/file-organizer.ts`

**Requirements:**
- ffmpeg + ffprobe must be on PATH (`/usr/local/bin`)
- **Image install** (`dockerfile.unified`): see [deployment/unified.md](../deployment/unified.md) → ffmpeg (pinned static 9.0.2, amd64 + arm64)
- Codecs/formats RMAB needs: demux concat/ffmetadata/mov/mp3/flac/aac/ogg; decode mp3/flac/aac/alac/ogg (vorbis, opus); encode aac (libfdk_aac optional, not in image); mux mp4/ipod/mp3/flac/null; bsf aac_adtstoasc
- **Verify installation:** `docker exec readmeabook ffmpeg -version`
- **Fixed (#230):** arm64 images shipped an amd64 ffprobe (`Exec format error`), silently disabling tagging + chapter merge

## Plex Format Coercion

**Status:** ✅ Implemented | Issue #166

**Purpose:** Rename audiobook files to Plex-recognized extensions before the library scan. Plex silently ignores `.mp4` files in audiobook libraries; this step prevents that silent-failure mode. Rename-only — no transcoding.

**When:** After file organization and metadata tagging, before file-hash generation and before library scan trigger.

**Scope:** Audio path only. Not applied to ebook organization.

**Coercion Table:**

| Source ext | Action |
|---|---|
| `.mp4` | Rename to `.m4b` |
| `.m4a` (single audio file in folder) | Rename to `.m4b` |
| `.m4a` (multi-file folder) | No-op |
| `.m4b`, `.mp3`, `.flac`, `.aac`, `.wav`, `.alac` | No-op |
| `.aa`, `.aax` | No-op + warn ("DRM, Plex cannot import") |
| `.ogg`, `.opus`, `.wma`, other | No-op + warn ("requires transcode, not supported in v1") |

**Configuration:**
- Key: `plex_format_coercion_enabled` (Configuration table)
- Default: `true`
- Read contract: `value !== 'false'` enables (default-on semantics)
- Configurable in: Setup wizard (Paths step), Admin settings (Paths tab)

**Behavior:**
- Each audio file evaluated independently (mixed-format folders supported).
- Pre-rename collision check: if target exists → no-op + info log. Never overwrites.
- Idempotent: re-running on already-coerced folder is a no-op (extension is the signal — no marker files).
- Operates on `targetPath` (organized library files) only — never touches `/downloads` (seeding-safe).

**Failure Isolation:**
- Coercion wrapped in try/catch at processor level.
- Any failure (e.g., EPERM) logs a warning; request remains organized; original file untouched.
- A failed rename never regresses the request to "stuck."

**Tech Stack:**
- `src/lib/utils/format-coercion.ts` — coercion module
- `src/lib/constants/audio-formats.ts` — `PLEX_COMPATIBLE_EXTENSIONS`, `COERCION_RENAME_MAP`, `DRM_EXTENSIONS`, `TRANSCODE_REQUIRED_EXTENSIONS`
- Invoked from `src/lib/processors/organize-files.processor.ts` between file organization and `generateFilesHash`
- `fs.rename` (same filesystem — no cross-mount issues)

**Hash Interaction:**
- File hash (`audiobooks.files_hash`) is generated AFTER coercion → reflects post-coercion filenames.
- See: [fixes/file-hash-matching.md](../fixes/file-hash-matching.md) for hash semantics.

**Out of Scope (v1):**
- Transcoding (`.ogg`, `.opus`, `.wma`)
- DRM decoding (`.aa`, `.aax`)
- FLAC → M4B (already Plex-recognized)
- Per-request override UI
- Retroactive library sweep (new downloads only)

## Seeding Support

**Config:** `seeding_time_minutes` (0 = unlimited, never cleanup)

**Cleanup Job:** `cleanup_seeded_torrents` (every 30 mins)
1. Find requests with status 'available' or soft-deleted (orphaned downloads)
2. Query qBittorrent for actual `seeding_time` field
3. **CRITICAL: Check if torrent hash is shared by other active requests**
   - If yes → Skip torrent deletion, only hard-delete the soft-deleted request record
   - If no → Delete torrent + files
4. Delete torrent + files only after seeding requirement met
5. Respects config (0 = never cleanup)

**Shared Torrent Protection:**
When user deletes and re-requests the same audiobook:
- Both requests share the same torrent hash (same files)
- Cleanup finds old soft-deleted request
- Before deleting torrent, checks if any active (non-deleted) request uses same hash
- If found → Keeps torrent, only removes soft-deleted database record
- Prevents deleting source files for active requests during chapter merging

## Post-Organize Cleanup Safety

**Code:** `src/lib/processors/organize-cleanup.ts`, `src/lib/processors/organize-cleanup-guard.ts`, `src/lib/utils/delete-guard.ts`, `src/lib/utils/import-inventory.ts`

**Download cleanup** (indexer `removeAfterProcessing`, non-torrent) runs only when all hold:
- Job payload carries `downloadHistoryId` (set by monitor-download, retry-failed-imports, direct-download, request retry route; never by manual or bulk import)
- That row belongs to the request, `downloadStatus = completed`, stored `downloadPath` == job `downloadPath`
- Protocol: indexer `protocol` (case-insensitive), else `CLIENT_PROTOCOL_MAP[downloadClient]`; unknown or `torrent` → skip
- retry-failed-imports writes a client-reported (mapped) path back to the row before queueing; a failed write only skips cleanup

**`assertSafeToDelete(path, ctx)`** guards every delete in both cleanups (download + manual-import `cleanupSource`). Refused deletes log a warning; the job still succeeds.

| Rule | Refuses |
|------|---------|
| a | Equals, contains, or is inside the organize target |
| b | Equals or contains any root: `media_dir`, `download_dir`, `download_dir/customPath` per client, mapped `localPath` per client, `/bookdrop` |
| c | Inside `media_dir`, unless inside a download root that itself sits strictly inside `media_dir` (`allowMediaSources` bypasses c for `cleanupSource` files only; a whole folder inside `media_dir` is never removed) |

- Comparison: realpath of candidate, target and roots (symlinks, junctions), plus dev+inode identity of the entry and its ancestors (case-insensitive mounts). Inode 0 never matches.
- Acts on the path the guard returns (the canonical path it checked). For a symlink candidate the rules are applied to both the link's target and the link's own location (canonical parent + name, lstat identity); only the link is removed. A library entry that is a link to a seeding file is therefore refused.
- Fail closed: roots are read straight from the database (`download_dir`, `download_clients`, legacy mapped path; no cache, no swallowed errors). Any database, decryption or JSON error, or any root that is a filesystem root, → nothing is deleted (job still succeeds).
- Empty-parent sweep: walks up to the nearest ancestor that is a configured root (canonical path or dev+inode match) and stops there, never removing it. No sweep when no ancestor is a root, or when the nearest root is only a client's mapped `localPath` (a mapped path that is also `download_dir` still sweeps).
- `cleanupSource` + `selectedFiles`: each file is checked; files inside the target are kept and listed in a warning (in-place renamed re-imports keep the old-named file).
- Ebook `cleanupSource` removes only the imported ebook file (`result.sourceFile`; the original EPUB when the Kindle fix ran), never its folder.
- Direct HTTP download files (`downloadClient = direct`) are removed by `cleanupDirectDownloadSource` (same provenance gate + guard); the organizer itself never deletes its source.
- Manual vs download job: `isManualImport = !downloadHistoryId && typeof cleanupSource === 'boolean'` (manual sends `true`, bulk `false`; download jobs leave it unset). A failed manual/bulk import → request `failed` with `Import from <path> did not complete: <error>. Fix the folder and run the import again.`, one notification without the path, result `success: false` (not thrown, so no queue retries); never `awaiting_import` (that path re-queues the request's last client download).
- Windows drive roots normalize to `C:/` (`normalizeGuardPath`), never `C:.` (the drive's current directory).
- `media_dir` resolution shared via `src/lib/utils/media-dir.ts` (`media_dir` → `MEDIA_DIR` → `/media/audiobooks`).

**Same-file copies:** `copyFile` is a no-op when source and destination are the same file (`isSameFile`: realpath equal, or same dev + non-zero inode); the organizer skips audio and cover art already in place.

## Verified Import (delete only what reached the library)

**Code:** `src/lib/utils/copy-file.ts`, `src/lib/utils/organize-copy.ts`, `src/lib/utils/import-inventory.ts`, `src/lib/utils/audio-duration.ts`, `src/lib/processors/organize-evidence.ts`

**Atomic copy (`copyFile`):** writes `<target dir>/.rmab-partial-<sha256(name)[:12]>-<rand>.part` through one FileHandle (write, fsync, close all fatal) → size must equal the source → publish → final path must have that size and the partial's dev/ino (when ino ≠ 0) → best-effort directory fsync (EINVAL/ENOTSUP/EISDIR/EBADF/EPERM/EACCES ignored). An inode change after publish or a failed folder fsync is accepted only if the final file holds the source's exact bytes. Failed rename/link (EXDEV, EBUSY, EACCES, …) = failed; never falls back to writing the final name. A crash leaves only a hidden `.part` file.
- Publish modes: `replace` (rename over; used to repair an interrupted copy or replace a bad tagged copy) and `create` (new targets: `link(partial, dest)` then unlink the partial; `EEXIST` if the target appeared → `placeFile` re-runs the existing-target rules on it). Filesystems without hard links fall back to lstat + rename, serialized in-process.
- `placeFile` also serializes placements per target name (any extension) in-process: two organize jobs (queue concurrency 2) placing the same generic file name never overwrite each other; the second gets `identical`/`differs`.

**Stale partials:** before placing, regular files in that one target folder matching the exact pattern are removed when they belong to this target name or are older than 24 h.

**`placeFile(source, target)` statuses** (records keyed on the original source path):

| Existing target | Status |
|-----------------|--------|
| none | `copied` |
| not a regular file (symlink, dir) | `differs`, never overwritten |
| same regular file (hard link ok) | `identical` |
| smaller and a byte-prefix of the source (interrupted copy) | re-copied → `copied` |
| smaller, not a prefix (other book, edited tags) | `differs` |
| same size | `identical` / `differs` by chunked compare when a delete depends on it, else `present` |
| larger | `differs` |

- `.mp4` / `.m4a` targets also match an existing `<name>.m4b` (Plex format coercion rename).
- Tagged derivative (`<source>.tmp`): checked before it is placed: its audio duration must be within 1 s of the original's, both measured from the first audio stream's packets (`probeStreamDurationMs`; `format.duration` is an estimate for e.g. VBR MP3 without a Xing header). Otherwise (or on probe failure) the original is placed untagged (byte-checked). A derivative that fails or differs at placement falls back to the original. Tagging does not use `-xerror` (codec copy would turn benign timestamp warnings into lost tags).
- Chapter merge: inputs map to the merged target; verified only if the merged duration is within min(2%, half the shortest chapter) of the chapters' total (`MergeResult.durationVerified`). Otherwise the merged file and all sources are kept. Merges do not use `-xerror` (one bad frame must not drop the merge; `durationVerified` guards deletes).
- Compare cost: same-size compares run only when a delete may follow (manual `cleanupSource`, or a download that cleanup would remove); they stop at the first differing chunk.

**Deletes consume the records (`ImportEvidence`):**
- Selected files (`cleanupSource` + `selectedFiles`): only those with a verified record (`copied`/`identical`); others are kept and listed in a warning.
- Whole folder or file (download cleanup, `cleanupSource` without selection, direct download): inventory complete (every source folder readable) and every audio file found in it verified; then a fresh walk right before removal must be complete and find no audio (or ebook) file the import never saw. Otherwise the download is kept and `postProcess` (client history archive) is skipped.
- Ebook folders: kept when they hold more ebook files than were imported.
- Only audio (or the ebook) is verified: non-audio extras (cover, nfo, samples) go with the folder.
- Request messages (`errorMessage` on status `downloaded`, shown amber in the admin requests table; a full import clears it; audiobooks and ebooks):

| Situation | Message |
|-----------|---------|
| some files failed | `<n> of <m> files not imported; source files kept` |
| every file already in the library with different content | `already in the library with different content; source kept` (not a failure; no failure notification) |
| merge kept outside the strict duration window | `merged file kept; sources kept` |
| source folder not fully readable | `... source folder could not be fully read; source files kept` |

- Kindle-fixed EPUB: the library gets the fixed copy; the original EPUB counts as imported once that copy is placed (`copied`/`identical`).
- EPUB folders: other files next to the ebook (cover, opf, extras) are not verified and go with the folder when it is removed.
- Not covered here: seeded-torrent cleanup (`cleanup_seeded_torrents`) removes torrent data after seeding without import evidence, and library matching clears the partial-import message. Tracked separately.

## Interface

```typescript
interface OrganizationResult {
  success: boolean;
  targetPath: string;
  filesMovedCount: number;
  errors: string[];
  audioFiles: string[];
  coverArtFile?: string;
}

async function organize(
  downloadPath: string,
  audiobook: {title: string, author: string, year?: number, coverArtUrl?: string, asin?: string}
): Promise<OrganizationResult>;
```

## Path Sanitization

- Remove invalid chars: `<>:"/\|?*`
- Trim dots/spaces
- Collapse multiple spaces
- Limit to 200 chars
- Example: `Author: The <Best>! Book?` → `Author The Best! Book`

## Configuration

- **Media directory:** Read from database config key `media_dir` (set in setup wizard or settings)
- **Path template:** Read from database config key `audiobook_path_template` (default: `{author}/{title} {asin}`)
- **Metadata tagging:** `metadata_tagging_enabled` (boolean, default: true)
- **Chapter merging:** `chapter_merging_enabled` (boolean, default: false)
- **Plex format coercion:** `plex_format_coercion_enabled` (boolean, default: true)
- **Fallback:** `/media/audiobooks` if media_dir not configured
- **Temp directory:** `/tmp/readmeabook` (or `TEMP_DIR` env var)

## Fixed Issues ✅

**1. EPERM errors** - Fixed with stream-based copy (`pipeline` + `createReadStream`/`createWriteStream`) instead of `fs.copyFile()` which uses `copy_file_range()` — a syscall that returns EPERM on cross-export NFS4 and some FUSE mounts
**2. Immediate deletion** - Changed to copy-only, scheduled cleanup after seeding
**3. Files moved not copied** - Now copies to support seeding
**4. Single file downloads** - Now supports files directly in downloads folder (not just directories)
**5. Hardcoded media path** - Now reads `media_dir` from database config instead of hardcoded `/media/audiobooks`
**6. Invalid URL error for cached cover art** - Fixed by detecting local cached thumbnails (`/api/cache/thumbnails/*`) and copying from `/app/cache/thumbnails/` instead of attempting HTTP download
**7. Manual import deleted library folders (#242)** - Download cleanup used the request's newest download row regardless of origin and `rm -rf`'d the import folder (even the media root); `cleanupSource` with source == target unlinked the library files; in-place re-import truncated `cover.jpg` to 0 bytes. Fixed by provenance gate + delete guard + same-file copy skip (see Post-Organize Cleanup Safety)
   - Upgrade note: organize jobs queued before this change carry no `downloadHistoryId`, so they skip download cleanup once (files stay on disk, client history entry is not archived). Their import retry on transient errors is unchanged; only manual/bulk imports fail without retry
**8. Cleanup after partial or interrupted imports** - A download was removed when at least one file copied, an interrupted copy left a truncated file under the final name that later counted as done, and a same-named existing file skipped the copy while the source was still deleted. Fixed by atomic copies, per-file placement records and verified-only deletes (see Verified Import)

## Tech Stack

- Node.js `fs/promises`
- `path` module
- axios (cover art download)
