# Library Placement (hard links, metadata.opf)

**Status:** ✅ Implemented | Audiobookshelf mode only: File placement (copy / hard link) and Metadata (tags / OPF / none) (#68)

## Overview
In Audiobookshelf mode an import can hard-link the audio into the library instead of copying it (one copy on disk, seeding keeps working), and can describe the book with a `metadata.opf` instead of tagging the audio. Plex mode and absent settings keep today's behaviour byte for byte: copy, tags per `metadata_tagging_enabled`, no OPF.

## Settings (Paths page, Library files section, ABS mode only)
| Setting | Values (UI words) | Config key |
|---|---|---|
| File placement | `copy` Copy · `hardlink` Hard link (copy if not possible) · `hardlink_only` Hard link only (don't import if not possible) | `audiobook_file_placement` (absent/unknown → copy) |
| Metadata | Tags in the audio files · OPF file (metadata.opf) · None (leave files as they are) | `metadata_tagging_enabled` + `metadata_opf_enabled` (tags wins when both true) |
| (status) | last copy fallback `{title, reason, at}` JSON | `audiobook_link_fallback_last` (cleared by the next linked book) |

- No symlinks. No schema change. The section replaces the tagging checkbox in ABS mode; the chapter-merge checkbox moves into it.
- **Guards (both ways):** link options disabled while Tags or chapter merge is on; Tags and merge disabled while linking (a selected value stays enabled so a stored conflict can be fixed). A disabled option is dimmed as a whole (circle and words).
- **Stored conflict** (e.g. tagging ticked in Plex mode, back to ABS): radios show what is stored; red alert naming only what is missing (`linkBlockedReason()`: the two refusal texts below, or "Hard links need Metadata set to OPF file or None, and chapter merge off."; the same line in gray under disabled options); Save blocked with `pathsPlacementConflict()` text. Import meanwhile links untagged (`effectiveLibrarySettings`).
- **API** `PUT /api/admin/settings/paths`: `filePlacement` (400 `File placement must be copy, hardlink or hardlink_only`), `metadataOpfEnabled` (400 `metadataOpfEnabled must be true or false`); in ABS mode a link with tags → 400 `Hard links need Metadata set to OPF file or None.`, with merge → 400 `Turn off chapter merge to use hard links.` Absent fields are unchanged; Plex mode never refuses. `GET /api/admin/settings` → `paths.filePlacement`, `paths.metadataOpfEnabled`, `paths.linkFallbackLast`.

## Import flow
- `readImportLibrarySettings()` (`src/lib/processors/organize-library-placement.ts`): copy + no OPF returns early (no backend read); otherwise `effectiveLibrarySettings()` (`src/lib/utils/library-placement.ts`). Errors → copy, no OPF.
- **Enforcement:** `FileOrganizer.organize()` `linking = isLinkPlacement(filePlacement)` forces tagging off and skips chapter merge; `placeFile({link})` → `linkNew` never chmods. No chown exists. A linked book is never tagged, merged, cover-embedded or chmod-ed.
- **OPF** (`src/lib/utils/opf-sidecar.ts`, written by `placeOpf()`): created before the audio; a failed write is said on the request (`metadata.opf could not be written (<CODE>)`; cleared when the copy fallback's second write succeeds) (ABS reads the first `*.opf`; its own metadata.json wins on later scans). An existing `metadata.opf` is kept. Escaped text, control chars stripped, no DTD. Order: title, subtitle, `dc:creator opf:role="aut"`, `nrt`, publisher, date (4-digit year), language, `dc:identifier opf:scheme="ASIN"`, description (≤16 KiB), subjects (≤20), `calibre:series` + `calibre:series_index`. Author split keeps `, Jr.`-style suffixes. Cover is copied as `cover.jpg` as before.
- **Link pass** (`organize-link-pass.ts` → `book-link.ts` `linkBook` under a book lock):
  - **In place:** every source path already is its target path (a Bulk or Manual Import of a book in its library folder) → `inplace`, in both link settings: the copy loop finds each file there (`identical`), nothing copied or linked, no copy note on the request, the Paths line untouched.
  - Precheck vets EVERY file before the first link: symlink (`SYMLINK`), not a regular file (`NOT_REGULAR`), outside the download roots + `/bookdrop` (`OUTSIDE`: Manual Import, Bulk Import from the media folder), inside media (`IN_LIBRARY`). Then: roots unreadable (`ROOTS`), book folder outside media (`TARGET`), first unsafe file, other device (`EXDEV`). Any one makes the whole book `cannot`; an unsafe file is never linked.
  - **Pinned sources:** the precheck opens each vetted source (`pinFile()`, `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`, fstat must be a regular file with the lstat's dev/ino) and `linkBook` closes every handle after the pass and any rollback. Linux gives a freed inode number to the next new file at once, so dev/ino alone can't tell a swapped file from the original; an open handle keeps the inode allocated, so no replacement can carry its numbers while the pass compares them. One open file per audio file of the book during the pass.
  - `linkInto()` (`link-file.ts`): `fs.link`, then verify target lstat = precheck dev/ino, regular, nlink ≥ 2, source unchanged; failed verify unlinks the new name by name → `VERIFY`. An interrupted copy in the library (`PREFIX`) refuses. Any other link error (EACCES, EIO, ...) is a refusal too.
  - **Never half-linked:** any refusal, error or throw during the pass → `rollback()` (`book-link.ts`) removes by name every name that wasn't there before the pass and is the download file, then `runLinkPass` removes this run's `metadata.opf` (`removeOwnOpf()`: same dev/ino AND the sha256 of the bytes it wrote), before the copy or the refusal. A name that can't be removed is never deleted recursively: it is named in the log and on the request (`could not remove …` / `Could not remove: …`).
- **Hard link (copy if not possible):** the book is imported exactly as Copy mode imports it (OPF, then the same `placeAudio` calls for every file: it copies what Copy mode copies and refuses what Copy mode refuses); request status line `copied, not hard-linked (<words>, <CODE>)`; Paths page line "Last book copied instead of linked: <title> (<words>, <CODE>), <date>. Cleared when a book is next linked."
- **Hard link only:** nothing imported; created folders removed (plain rmdir). Client download → `warn` (Retry); manual or bulk import → `failed`. Message (`linkRefusedMessage()`): `Not imported: hard link not possible (<words>, <CODE>). Nothing was copied. <advice>` with advice by code: EXDEV/EPERM `Fix the mounts, or set File placement to Hard link (copy if not possible), then retry.`; OUTSIDE `Only files in a download folder can be hard-linked: set File placement to Hard link (copy if not possible), then retry.`; others `Set File placement to Hard link (copy if not possible) to copy the book instead, then retry.` (imports: `then run the import again`). Written only if the request wasn't cancelled or deleted meanwhile (`updateRequestUnlessStopped`); then one notification. No retry count, no auto-block.

## Refusal words (`linkRefusal(code)`)
| Code | Words |
|---|---|
| EXDEV | the download and library folders are separate mounts |
| EPERM | not permitted: the filesystem has no hard links, or the files belong to another user |
| ENOTSUP / EOPNOTSUPP / ENOSYS | the filesystem has no hard links |
| EMLINK | too many links to the download file |
| EINVAL | the filesystem refused the link |
| VERIFY | the link could not be verified |
| PREFIX | an interrupted copy of this file is in the library |
| ROOTS | the configured folders could not be read |
| TARGET | the book folder is outside the media folder |
| IN_LIBRARY | the download is inside the media folder |
| OUTSIDE | the files are not in a download folder |
| SYMLINK | a download file is a symbolic link |
| NOT_REGULAR | a download file is not a regular file |
| EACCES / EIO / ENOENT / ERROR | permission denied / a read or write error / a file is missing / the link failed |

One format everywhere (`describeRefusal`): `<words>, <CODE>`.

## Deleting
- Every delete path unlinks names: download cleanup (whole folder or `removeImportedFilesOnly`) leaves the library file at nlink 1; request delete leaves the download byte-identical.
- Request delete treats `metadata.opf` like `cover.jpg` in every mode (removed only when nothing unrecorded stays), so a `metadata.opf` RMAB didn't write goes with the folder too.

## Critical Issues
- Separate ZFS datasets, btrfs subvolumes, Unraid pools and separate bind mounts return EXDEV even on one disk: mount one parent folder holding both downloads and media.
- Same PUID (or group-writable files) needed: `protected_hardlinks` refuses linking another user's file (EPERM).
- mergerfs symlink-on-EXDEV and CIFS `noserverino` are caught by the verify step.
- Don't use ABS's Embed Metadata on linked books: it rewrites the download too.
- A cross-filesystem category move in the download client after import undoes the saving.

## Related: [phase3/file-organization.md](../phase3/file-organization.md), [settings-pages.md](../settings-pages.md), [deployment/volume-mapping.md](../deployment/volume-mapping.md), [features/chapter-merging.md](chapter-merging.md), [admin-features/request-deletion.md](../admin-features/request-deletion.md)
