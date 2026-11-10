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
- **Guards (both ways):** link options disabled while Tags or chapter merge is on; Tags and merge disabled while linking (a selected value stays enabled so a stored conflict can be fixed).
- **Stored conflict** (e.g. tagging ticked in Plex mode, back to ABS): radios show what is stored; red alert "Needs Metadata: OPF file or None, and chapter merge off."; Save blocked with `pathsPlacementConflict()` text. Import meanwhile links untagged (`effectiveLibrarySettings`).
- **API** `PUT /api/admin/settings/paths`: `filePlacement` (400 `File placement must be copy, hardlink or hardlink_only`), `metadataOpfEnabled` (400 `metadataOpfEnabled must be true or false`); in ABS mode a link with tags → 400 `Hard links need Metadata set to OPF file or None.`, with merge → 400 `Turn off chapter merge to use hard links.` Absent fields are unchanged; Plex mode never refuses. `GET /api/admin/settings` → `paths.filePlacement`, `paths.metadataOpfEnabled`, `paths.linkFallbackLast`.

## Import flow
- `readImportLibrarySettings()` (`src/lib/processors/organize-library-placement.ts`): copy + no OPF returns early (no backend read); otherwise `effectiveLibrarySettings()` (`src/lib/utils/library-placement.ts`). Errors → copy, no OPF.
- **Enforcement:** `FileOrganizer.organize()` `linking = isLinkPlacement(filePlacement)` forces tagging off and skips chapter merge; `placeFile({link})` → `linkNew` never chmods. No chown exists. A linked book is never tagged, merged, cover-embedded or chmod-ed.
- **OPF** (`src/lib/utils/opf-sidecar.ts`): written create-only before the audio (ABS reads the first `*.opf`; its own metadata.json wins on later scans). An existing `metadata.opf` is kept. Escaped text, control chars stripped, no DTD. Order: title, subtitle, `dc:creator opf:role="aut"`, `nrt`, publisher, date (4-digit year), language, `dc:identifier opf:scheme="ASIN"`, description (≤16 KiB), subjects (≤20), `calibre:series` + `calibre:series_index`. Author split keeps `, Jr.`-style suffixes. Cover is copied as `cover.jpg` as before.
- **Link pass** (`organize-link-pass.ts` → `book-link.ts` `linkBook` under a book lock):
  - Precheck: guard roots readable (`ROOTS`), book folder inside media (`TARGET`), each source lstat'd: symlink / not regular / outside download roots → per-file refusal, never copied; source inside media → `IN_LIBRARY`; other device → `EXDEV`.
  - `linkInto()` (`link-file.ts`): `fs.link`, then verify target lstat = precheck dev/ino, regular, nlink ≥ 2, source unchanged; failed verify unlinks the new name by name → `VERIFY`. An interrupted copy in the library (`PREFIX`) refuses.
  - Book can't be linked → this run's links rolled back (only names whose identity still matches).
- **Hard link (copy if not possible):** whole book copied; request status line `copied, not hard-linked (<reason>)`; Paths page line "Last book copied instead of linked: <title> (<reason>), <date>".
- **Hard link only:** nothing imported; own OPF and created folders removed; request → `warn` (Retry) with `Not imported: hard link not possible (<words>, <CODE>). Nothing was copied. Fix the mounts, or set File placement to Hard link (copy if not possible), then retry.` One notification, no retry count, no auto-block. Manual import → failed with the import message.

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

## Deleting
- Every delete path unlinks names: download cleanup (whole folder or `removeImportedFilesOnly`) leaves the library file at nlink 1; request delete leaves the download byte-identical.
- Request delete treats `metadata.opf` like `cover.jpg` (removed only when nothing unrecorded stays).

## Critical Issues
- Separate ZFS datasets, btrfs subvolumes, Unraid pools and separate bind mounts return EXDEV even on one disk: mount one parent folder holding both downloads and media.
- Same PUID (or group-writable files) needed: `protected_hardlinks` refuses linking another user's file (EPERM).
- mergerfs symlink-on-EXDEV and CIFS `noserverino` are caught by the verify step.
- Don't use ABS's Embed Metadata on linked books: it rewrites the download too.
- A cross-filesystem category move in the download client after import undoes the saving.

## Related: [phase3/file-organization.md](../phase3/file-organization.md), [settings-pages.md](../settings-pages.md), [deployment/volume-mapping.md](../deployment/volume-mapping.md), [features/chapter-merging.md](chapter-merging.md), [admin-features/request-deletion.md](../admin-features/request-deletion.md)
