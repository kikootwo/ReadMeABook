# Multi-Disc Folders (CD1/Disc 1)

**Status:** ✅ Implemented | One rule for books stored as `Book/Disc 1/`, `Book/Disc 2/`... in Manual Import, Bulk Import and the organizer

## Overview
A book folder whose audio sits in disc folders imports whole, as one book, in disc-then-track order. Code: `src/lib/utils/disc-layout.ts` (pure rule), `disc-layout-fs.ts` (listing, Manual Import validation, organizer order, in-place stop), `disc-fold.ts` (Bulk Import fold).

## Disc folder names
Whole name, trimmed, case-insensitive. Paths are always built from the raw name (`CD1 ` keeps its space).
| Kind | Pattern | Examples |
|---|---|---|
| disc | `(cd\|disc\|disk)` + optional ` ._-` + 1-3 digits + optional ` of N` | `CD1`, `cd 01`, `CD-2`, `Disc 1`, `Disc_02`, `DISK 3`, `Disc 1 of 3` |
| part | `part` + optional ` ._-` + 1-3 digits + optional `-M` (sorts by first number) | `Part 1`, `Part 02`, `Part 1-2` |
- Not discs (today's behaviour kept): `Vol 1`, `Volume 2`, `Book 1`, bare `1`, `Extras`, `Bonus`, `Sample`, `Part 1 - The Beginning`, `Title - CD1`, `CD1 (Bonus)`, `Disc One`.
- Generic search-term names (Bulk Import fallback) = disc names + `vol N`/`volume N` (`isGenericFolderName`).

## Multi-disc book folder
- 2+ **direct** children are disc folders holding audio **directly** inside them. One depth for detection, listing, the Manual Import allowlist and the book set: `Book/CD1/Unabridged/01.mp3` is not a disc layout (today's path).
- Not a disc layout: one disc folder, one nested folder, only non-disc subfolders.
- A configured root (`download_dir`, `media_dir`, `/bookdrop`; compared canonically: realpath + inode) never qualifies, in Manual or Bulk Import.
- Listing uses Dirent `isDirectory()`/`isFile()` only: symlinked folders and files are never listed or followed.
- **Book set** (Manual, Bulk): the folder's own audio + each disc folder's direct audio. `Extras/` etc. are not part of the book. The download path imports everything its walk finds.

## Order (multi-disc only; single-folder and other layouts keep today's order exactly)
1. The book folder's own files, natural order (an intro comes first).
2. Disc folders by number (`Disc 2` before `Disc 10`); a shared number (`CD1` + `Disc 1`) goes by name, with a log warning.
3. Within a disc: track tags if every file has one and they run 1..n (ffprobe, 4 at a time); else natural order. A failed probe = no tag.
4. Organizer only: other files (non-disc folders, deeper files) last, natural order. A shared wrapper folder is stripped first (`Book/CD1/...`).
- The result must be a permutation of the input, else today's order is kept. Never an error.
- The one order drives the merged chapters (`analyzeChapterFiles(..., keepOrder)`), the copy and the rename numbering.

## Manual Import
- Browse (`GET /api/admin/filesystem/browse`): a multi-disc folder also returns its disc files in `audioFiles` as `Disc 1/01.m4a` (import order, with sizes) + `discCount`. Footer: "N audio files in M discs" + "Select This Folder".
- `POST /api/admin/manual-import` (`resolveManualSelection`):
  - `selectedFiles` entries without `/`: today's stat check (single files in the folder).
  - Entries with `/`: must be exact members of the book set; `..`, `.`, absolute, `\`, `//`, NUL, `Extras/x` → 400 `Invalid file name`.
  - No `selectedFiles`: the folder's own audio (organizer walks it, as today); a disc-only folder gets the book set filled in, so the import and any source removal stay scoped to the book.
- Remove source: only verified disc files are removed; Extras, cue/m3u, covers stay. **Empty disc folders stay behind** (no sweep).

## Bulk Import fold (after the walk, before same-key dedup)
- Book folder R at or below the scan root, not a configured root; 2+ disc-folder discoveries under R, one discovery each (a disc folder holding two books never folds).
- `cd/disc/disk` folders fold when all untagged, or all tagged with keys (title\|author\|narrator) that agree once a disc suffix (`(Disc 2)`, `- CD 2`, `[Disc 1 of 3]`) is stripped from the album.
- `Part N` folders fold only when tagged and their keys agree (the suffix strip never touches `Part N`). Untagged `Part N` stay separate.
- A mix of tagged and untagged discs does not fold. R's own audio joins when untagged or its key agrees.
- Folded entry: `folderPath` = R, `audioFiles` = `CD1/01.mp3`... (R's files first, discs by number), search term from the stripped album or R's name, ASIN from R's name.

## In-place stop (Manual/Bulk Import only)
- A multi-disc source that is (or is inside) its own target folder stops right after file selection, before any merge, tagging or copy: "...nothing was changed". Canonical compare (`canonicalize`/`isSameEntry`/`isStrictlyInside`). Downloads are not stopped.
- The request is marked `failed` with that message (a recycled `available` book also ends `failed`; re-run the import from the right folder).

## Known limits
- Tagging and merge off: Audiobookshelf orders flattened files by its own name/number logic, so `Disc 1-01`, `Disc 2-01`, `Disc 1-02`... can still interleave in the player. The copy order and rename numbering are right; merging gives one ordered m4b.
- Books imported before this fix keep their old order; a re-import shows "different content" (source kept).
- Prefixed disc folders (`Title - CD1`) are not discs.

## Related
- [Manual Import](manual-import.md), [Bulk Import](bulk-import.md), [File Organization](../phase3/file-organization.md), [Chapter Merging](chapter-merging.md)
