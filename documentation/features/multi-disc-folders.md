# Multi-Disc Folders (CD1/Disc 1)

**Status:** ✅ Implemented | One rule for books stored as `Book/Disc 1/`, `Book/Disc 2/`... in Manual Import, Bulk Import and the organizer

## Overview
A book folder whose audio sits in disc folders imports whole, as one book, in disc-then-track order; with tagging on, each file also carries its disc and track. Code: `src/lib/utils/disc-layout.ts` (pure rule, order, disc/track values), `disc-layout-fs.ts` (listing, Manual Import validation, organizer order, in-place stop), `disc-fold.ts` (Bulk Import fold).

## Disc folder names
Whole name, trimmed, case-insensitive. Paths are always built from the raw name (`CD1 ` keeps its space).
| Kind | Pattern | Examples |
|---|---|---|
| disc | `(cd\|disc\|disk)` + optional ` ._-` + 1-3 digits + optional ` of N` | `CD1`, `cd 01`, `CD-2`, `Disc 1`, `Disc_02`, `DISK 3`, `Disc 1 of 3` |
| part | `part` + optional ` ._-` + 1-3 digits + optional `-M` (sorts by first number) | `Part 1`, `Part 02`, `Part 1-2` |
- Not discs (today's behaviour kept): `Vol 1`, `Volume 2`, `Book 1`, bare `1`, `Extras`, `Bonus`, `Sample`, `Part 1 - The Beginning`, `Title - CD1`, `CD1 (Bonus)`, `Disc One`, `CD1234`.
- Generic search-term names (Bulk Import fallback, `isGenericFolderName`) = disc names + `(cd|disc|disk|part|vol|volume) N` with any number of digits, as before (`CD 0001`, `Part 1000`, `cd1234`).

## Multi-disc book folder
- 2+ **direct** children are disc folders holding audio **directly** inside them. One depth for detection, listing, the Manual Import allowlist and the book set: `Book/CD1/Unabridged/01.mp3` is not a disc layout (today's path).
- Not a disc layout: one disc folder, one nested folder, only non-disc subfolders.
- A configured root (`download_dir`, `media_dir`, `/bookdrop`; compared canonically: realpath + inode) never qualifies, in Manual or Bulk Import.
- Listing uses Dirent `isDirectory()`/`isFile()` only: symlinked folders and files are never listed or followed.
- **Book set** (Manual, Bulk): the folder's own audio + each disc folder's direct audio. `Extras/` etc. are not part of the book. The download path imports everything its walk finds.

## Order (multi-disc only; single-folder and other layouts keep today's order exactly)
Every file is probed for its track tag (ffprobe, 4 at a time, root files included; a failed probe = no tag). First rule that holds:
1. Every file tagged and the tags run exactly 1..N (the merger's own rule): tag order. A root intro tagged 1 plays first, a root outro tagged N last.
2. Else:
   - the book folder's own files, natural order (an untagged outro kept at the root plays first);
   - disc folders by number (`Disc 2` before `Disc 10`); a shared number (`CD1` + `Disc 1`) goes by name, with a log warning;
   - inside the discs: tags that run 1..N across the discs in disc order (each disc continues the last: CD1 1-10, CD2 11-20) order every disc; else a disc whose files all carry distinct positive tags (gaps allowed: 1,2,3,5) orders by them, so a failed probe only affects its own disc; else natural order;
   - organizer only: other files (non-disc folders, deeper files) last, natural order. A shared wrapper folder is stripped first (`Book/CD1/...`).
- The result must be a permutation of the input, else today's order is kept. Never an error.
- The one order drives the merged chapters (`analyzeChapterFiles(..., keepOrder)`: no metadata/filename decision), the copy, the rename numbering and the disc/track tags.

## Disc and track tags (tagging on, not merged)
- Each file of a multi-disc import: `disc` = its folder's number of the highest (`d/D`), `track` = its position across the book in the order above (`n/N`). A file outside the disc folders takes the disc of the file before it (the first disc's at the start).
- No `disc` values at all when a disc folder is numbered 0 or the numbers would go down along the order: the source's disc is cleared (empty `disc`; FLAC also `DISCNUMBER`/`DISCTOTAL`/`TOTALDISCS`), so `track` alone carries the order.
- Replace any track/disc numbers the source carries (FLAC: `TRACKTOTAL`/`TOTALTRACKS` = N and `DISCTOTAL`/`TOTALDISCS` = D too); read back by ffprobe as `track`/`disc` for m4a/m4b, mp3 and flac, the keys Audiobookshelf orders by. Details: [file-organization.md](../phase3/file-organization.md) (Metadata Written).
- Not written: single-folder and non-disc imports, a merged m4b, tagging off (all exactly as before).

## Manual Import
- Browse (`GET /api/admin/filesystem/browse`): a multi-disc folder also returns its disc files in `audioFiles` as `Disc 1/01.m4a`, disc by disc with names in natural order inside a disc (with sizes). The import may still reorder a disc by its track tags. Footer: "N audio files in M discs" + "Select This Folder".
- `POST /api/admin/manual-import` (`resolveManualSelection`):
  - `selectedFiles` entries without `/`: today's stat check (single files in the folder).
  - Entries with `/`: must be exact members of the book set; `..`, `.`, absolute, `\`, `//`, NUL, `Extras/x` → 400 `Invalid file name`.
  - No `selectedFiles` (API only; the UI always sends them): a disc-only folder gets the book set filled in, so the import and any source removal stay scoped to the book. A folder with audio of its own keeps today's path: the organizer walks the whole tree (`Extras/` included) and remove source takes the whole folder, as before.
- Remove source: only verified disc files are removed; Extras, cue/m3u, covers stay. **Empty disc folders stay behind** (no sweep).

## Bulk Import fold (after the walk, before same-key dedup)
- Book folder R, not a configured root; 2+ disc-folder discoveries under R, one discovery each (a disc folder holding two books never folds).
- `cd/disc/disk` folders fold when all untagged, or all tagged with keys (title\|author\|narrator) that agree:
  - as they are (every disc's album the same): compared and searched unchanged, so `Hard Disk 3` on every disc stays `Hard Disk 3`;
  - else once a disc suffix is stripped from each album: after a `-`/`:`/`,` separator or a bracket (`(Disc 2)`, `- CD 2`, `: Disc 2`, `[Disc 1 of 3]`), or after a plain space when the keyword starts a word and the number is that folder's own (`The Hobbit Disc 1` in `Disc 1`, `The Hobbit CD2` in `CD2`, `Book Disc 1 of 3`; never `OCD 1`). The stripped stem is the search term.
  - Before the suffix match, whitespace runs in the album collapse to one space; an album over 500 characters keeps any suffix.
  - An album that strips to nothing (`' '`) keeps the scanner's own key (author and narrator kept).
- `Part N` folders fold only when tagged and their keys agree (the suffix strip never touches `Part N`). Untagged `Part N` stay separate.
- A mix of tagged and untagged discs does not fold. R's own audio joins when untagged or its key agrees.
- Nested disc folders: the deepest book folders fold first; a book folder whose members another fold already took stays unfolded, so no file is in two entries.
- Folded entry: `folderPath` = R, `audioFiles` = `CD1/01.mp3`... (R's files first, discs by number), search term from the stripped album or R's name, ASIN from R's name.

## In-place stop (Manual/Bulk Import only)
- Stops right after file selection, before any merge, tagging or copy: "...the files in its subfolders would be copied flat into the same folder; nothing was changed", when the source is (or is inside) its own target folder AND either the files form a multi-disc layout or the selection names any subfolder's file (one disc of the book, a root file plus one disc, a Bulk entry merged from `Part A/` + `Part B/`). Canonical compare (`canonicalize`/`isSameEntry`/`isStrictlyInside`). Downloads are not stopped.
- The request is marked `failed` with that message, also a recycled `available` book (the target depends on metadata the job fills in, so the route cannot check first). Re-run the import from the right folder.

## Known limits
- Tagging off and merge off: no disc/track tags are written, so Audiobookshelf orders the flat files by their names and `Disc 1-01`, `Disc 2-01`, `Disc 1-02`... can interleave in the player. The copy order and rename numbering are right; tagging on (disc/track tags) or merging (one ordered m4b) gives the player the order.
- Books imported before this fix keep their old order; a re-import shows "different content" (source kept).
- Prefixed disc folders (`Title - CD1`) are not discs.

## Related
- [Manual Import](manual-import.md), [Bulk Import](bulk-import.md), [File Organization](../phase3/file-organization.md), [Chapter Merging](chapter-merging.md)
