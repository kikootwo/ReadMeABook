# Bulk Import Feature

**Status:** ✅ Implemented | Admin-only | Multi-step wizard modal

## Overview
Lets admins scan a server folder recursively, discover audiobook subfolders, match against Audible, review matches, and import selected books via the existing manual import pipeline.

## Flow
1. **Select Folder** — Browse base folders (Downloads, Media Library, Book Drop), pick scan root
2. **Scan & Match** — Recursively discover audiobook folders (max 10 levels), read metadata via ffprobe, search Audible per book (1.5s rate limit)
3. **Review & Import** — Scrollable list with skip toggles, library status, confidence badges, **Change match / Find match** per row (#189); Start Import queues organize_files jobs

## Change match / Find match (#189)
- **Rows with the control:** matched (incl. Low Confidence) and Requested rows → "Change match"; No Match rows → "Find match". **None** on In Library rows or rows with `inMediaFolder` (`canChangeMatch`, `row-match.ts`)
- **Dialog** (`ChangeMatchDialog.tsx`, absolute overlay inside the wizard panel): one search field ("Title, author or ASIN", `text-base sm:text-sm`), pre-filled with the row's `searchTerm` cut to `MATCH_QUERY_MAX_LENGTH` (200; also the field's `maxLength`). A row with a book searches on open; a No Match row waits for Search/Enter. One request in flight: a new Search replaces one still loading (the last is aborted). Results: cover, title, author · narrator, ASIN · duration; In Library / Requested hits show the badge and are disabled. Polite live region: `Searching…`, `N results`, `No results`, `Nothing came back for <ASIN> from <store>` (the Audible service answers an outage with nothing, so empty answers are worded to be true either way), `Couldn't reach Audible. Try again.` (route 502). Phones (below `sm`): once results show, focus moves from the field to the panel so the keyboard drops. Esc, × or a click on the dimmed panel (press and release both on it; a drag out of the field doesn't close) closes it; Tab stays inside; focus returns to the row's button
- **Typed ASIN:** `TYPED_ASIN_PATTERN` `^(B0[A-Z0-9]{8}|\d{9}[\dX])$` (i, trimmed, upper-cased; `asin.ts`); a 10-letter title stays a text search. Region: the configured one
- **Row state (client only, never stored):** `chosen: { match }` beside the scan's `match` (kept for Undo). Effective match = `chosen ?? match`; a changed row has no In Library/Requested flags, no Low Confidence badge, is included, and shows "Undo" (back to the scan match and its default skip). Picking the scan's own ASIN = no change, unless the scan flagged it In Library/Requested and the dialog found it free: then it is kept as a pick (no stale flag, can be skipped, Undo). A reload, Back or rescan drops changes
- **Same book twice:** included rows sharing an effective ASIN get an amber `SAME_BOOK_MARKER` badge ("Same book as another row: change or skip one") and are held back (`splitForImport`): not in "N books to import", never sent; with only marked rows included Start Import is disabled; the finished screen lists them as "Same book as another row". Execute refuses every repeated row as the backstop. Merging is not offered: a book split across folders (Part 1, Part 2) imports whole only after its parts are moved into one folder and scanned again (the scanner folds them into one entry); skipping one part imports a partial book under the full book's ASIN
- **Dimming:** a skipped row dims cover, text and badges only; Change match, Find match and Undo stay full strength
- **While importing:** Change match and Undo are disabled
- **Backdrop:** while the dialog is open or any row is changed, a click on the wizard backdrop does nothing (× still closes); on the finished screen it closes again
- **Finished screen:** queued count + rows not queued with reasons (refused by execute, then held back); nothing queued → "Nothing Queued", grey icon, no success text

## Key Details
- **Access:** Admin-only, modal opened from admin dashboard Quick Actions
- **Audio detection:** Uses `AUDIO_EXTENSIONS` from `src/lib/constants/audio-formats.ts`
- **Audiobook boundary:** A folder containing audio files = one audiobook. Files with matching metadata tags are grouped by title+author+narrator. Files with no metadata title tag are all grouped together per folder (one entry, not one per file).
- **Grouping key** (`buildGroupingKey`): `title|author|narrator`, each part = `normalizeForMatching` ([ranking-algorithm.md](../phase3/ranking-algorithm.md)) with everything but letters, marks and digits dropped. Every script is kept (`Война и мир`/`Лев Толстой` → `воинаимир|левтолстои|`, `三体` → `三体|…`); case, accents, NFC/NFD and fullwidth fold; ASCII keys are exactly the old `[a-z0-9]` keys. Same key in two folders = one book (merged at the common parent).
- **Title with no letter or digit** (`' '`, `!!!`, `📚`): key `__ungrouped_notitle|author|narrator` (`NO_TITLE_PREFIX`): grouped per folder with its author and narrator, never merged across folders; its disc folders still fold.
- **Known limits (split, never merge):** tags that mix mojibake with clean text (`CafÃ©` vs `Café`), or `Ⅱ` with `II`, ligatures (`ﬁ`), halfwidth with fullwidth katakana, or Arabic/Hebrew vowel marks with none, get different keys, so those files stay separate entries.
- **Disc folders:** `Book/CD1/`, `Book/CD2/`... fold into ONE entry at `Book` (`audioFiles` = `CD1/01.mp3`...) when untagged or when their tags agree as they are or after a disc suffix is stripped; untagged `Part N`, mixed tagged/untagged and configured roots never fold. Rule and guards: [multi-disc-folders.md](multi-disc-folders.md)
- **Metadata extraction:** ffprobe (`execFile` argv, no shell) reads `album` (title), `album_artist` (author), `composer` (narrator) from all audio files in folder
- **Search term fallback chain** (when no `album` tag):
  1. **ASIN in folder name** — scans folder name for pattern `B[A-Z0-9]{9}` bounded by bracket/paren/space; if found, uses direct ASIN lookup instead of text search; no badge shown. All-digit ASIN (`\d{9}[\dX]`, ISBN-10; scan route, `bulk-import-asin.ts`, only when no `B` ASIN): the last bounded run is a candidate, direct match only when the catalog title (`normalizeTitle`, no subtitle, no trailing `, Book N`/`Volume N`/`Vol. N`/`Part N`) has `matchShare` >= 0.8 in the folder name; else today's text search on `searchTerm`, `extractedAsin` stays unset. Skipped: only runs touching a letter/digit or joined to a number by `- . : , _ /` (ISBN-13, joined date stamps); space-separated stamps and phone-like numbers are read, and the title check stops them
  2. **Folder name** — cleaned (strips bracketed ASIN/year, underscores→spaces); skipped if generic (CD1, Disc 2, Part 3, Vol 1, etc.); shows "Low Confidence" badge
  3. **First file name** — last resort; shows "Low Confidence" badge
- **Generic folder detection:** disc/part folder names ([multi-disc-folders.md](multi-disc-folders.md)) + `(cd|disc|disk|part|vol|volume) N` with any number of digits (`isGenericFolderName`) — skipped as search terms
- **Author/narrator dedup:** Splits on `,;& ` delimiters, removes names appearing in both fields
- **Scan depth:** Max 10 levels recursion
- **Language filter:** never applied; scan text searches pass `ignoreLanguageFilter: true` ([audible-language-filter.md](../integrations/audible-language-filter.md))
- **Rate limiting:** 1.5s delay between Audible searches (same as existing scraping rate limit)
- **Library check:** `getImportBlocks()` (`bulk-import-checks.ts`): In Library = `plex_library.asin` equal ignoring case (`mode: 'insensitive'` in the query) or the ASIN in `plex_guid` (as `findPlexMatch`); Requested = any user's request in `IMPORT_BLOCKING_STATUSES` (`request-statuses.ts`: pending, searching, downloading, processing, awaiting_search, awaiting_import, awaiting_approval, downloaded, available). One query per table for any number of ASINs; the scan, the match route and execute share it
- **Media-folder rows:** `inMediaFolder` = the folder or the folder of any `audioFiles` entry is under the media root (`getMediaDir()`), after `realpath`; the deepest root decides (downloads nested in media count as downloads), media wins a tie (download_dir = media_dir). UI only: execute has no media check (admins may bulk-import from the media folder). Under a hard-link File placement such files are not linked (`OUTSIDE`): Hard link (copy if not possible) copies them as Copy mode does, Hard link only fails the request ([library-placement.md](library-placement.md))
- **Import:** Reuses existing `organize_files` job queue (same as manual import)
- **No new database tables** — all state is ephemeral during wizard session

## API Endpoints

**POST /api/admin/bulk-import/scan** (SSE stream)
- Body: `{ rootPath: string }`
- Path validation: must be within download_dir, media_dir, or /bookdrop
- Streams events: `progress`, `discovery_complete`, `matching`, `book_matched`, `complete`, `error`
- Each `book_matched` event includes: folderPath, match (Audible data), inLibrary, hasActiveRequest (only when not inLibrary), inMediaFolder, metadataSource

**GET /api/admin/bulk-import/match?q=** (admin session only; not on the API token allowlist, so a token gets 403)
- `q` 1-200 chars trimmed, else 400. Typed ASIN → `resolveBookByAsin` (audiobooks row → audible_cache → `getAudiobookDetails(asin, { fillSeries: false })`); else `search(q, 1, { ignoreLanguageFilter: true })`, first 20 (`MATCH_RESULT_LIMIT`)
- Returns `{ kind: 'asin'|'search', asin: string|null, store: 'audible.com'|..., results: [{ asin, title, author, narrator?, coverArtUrl?, durationMinutes?, inLibrary, hasActiveRequest }] }`; anything that throws (in practice a database error: `search`/`getAudiobookDetails` catch Audible failures and answer empty/null, so an outage reads as no results) → 502 `{ error: 'Audible lookup failed' }`. Calls only Audible/Audnexus hosts the app already calls

**POST /api/admin/bulk-import/execute**
- Body: `{ imports: Array<{ folderPath: string, asin: string, audioFiles?: string[] }> }`
- Creates audiobook records + requests, queues organize_files jobs
- **Every row, in this order** (no flag; changed and scan-matched rows alike, #189/#588); a refusal is `{ success: false, error }` for that row, nothing written, other rows continue:
  1. ASIN shape (`asinShaped`, upper-cased) → `Invalid ASIN`; a missing ASIN runs no lookup (#588: `findFirst` with an undefined ASIN matched any book)
  2. ASIN named by another row of the call → `Same book as another row` (every such row)
  3. Folder under a root / is a directory / has audio (existing messages)
  4. Resolve (audiobooks row → audible_cache → live) → `Audiobook not found` / `Failed to fetch audiobook details`
  5. In the library → `Already in your library`
  6. Any user's request in `IMPORT_BLOCKING_STATUSES` → `Already requested`; checked again just before the write on any audiobooks row with the ASIN (`audible_asin` is not unique), and on this row's newest request
- Reasons: `BULK_IMPORT_REFUSAL` (`src/lib/constants/bulk-import.ts`), shown per row on the finished screen (mapped by index)
- Then recycles the book's newest audiobook request of **any** user when it is `failed`/`warn`/`cancelled`/`denied`, else creates one for the admin. Guarded on the exact status that was read: a row that changed meanwhile -> that item `{ success: false, error: 'Request changed while importing; try again' }`, no job queued, other items continue (#232). Before #189 it also recycled `pending`/`awaiting_search`/`awaiting_approval`/`downloaded`/`available` (rows the review screen already blocked)
- Recycling another user's `denied` or `cancelled` request sets `Request.approvalBypassedBy = bulk_import:<status>` (status, notifications and delivery unchanged); the importing admin's own request is never recorded. A recorded request is never given a requester tag, and neither is a request the import creates for the importing admin when there is none to recycle ([requester-tags.md](requester-tags.md)). See [database.md](../backend/database.md#requests)
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
| Skipped by user | Cover/text 40% opacity, gray toggle OFF; controls full strength |
| Already in library | Cover/text 40% opacity, green "In Library" badge, toggle disabled, no Change match |
| Active request exists | Cover/text 40% opacity, purple "Requested" badge, toggle disabled, "Change match" |
| No Audible match | Red "No Match" badge, folder name shown, pre-skipped, "Find match" |
| Changed (book picked) | Picked cover/title/author · narrator, no flags, included, "Undo" |
| Same book as another included row | Amber "Same book as another row: change or skip one" badge; held back (not counted, not sent) |
| In the media folder | No Change match / Find match |
| ASIN extracted from folder name | No badge (high confidence — direct ASIN lookup) |
| Low confidence (folder name or file name fallback, no ASIN) | Amber "Low Confidence" badge |

## Files

**Backend:**
- `src/lib/utils/bulk-import-scanner.ts` — Folder discovery + ffprobe metadata
- `src/lib/utils/bulk-import-keys.ts` — Grouping key (`buildGroupingKey`, every script via `match-normalize.ts`), `UNGROUPED_PREFIX`/`UNGROUPED_FOLDER_KEY`/`NO_TITLE_PREFIX`
- `src/lib/utils/async-pool.ts` — Concurrency-limited map (ffprobe reads)
- `src/lib/utils/disc-fold.ts` — Disc folder fold (after the walk, before same-key dedup)
- `src/lib/utils/bulk-import-asin.ts` — All-digit ASIN candidate (`extractDigitAsinCandidate`) + title check (`catalogTitleFitsFolder`)
- `src/app/api/admin/bulk-import/scan/route.ts` — SSE scan endpoint
- `src/app/api/admin/bulk-import/execute/route.ts` — Batch import endpoint
- `src/app/api/admin/bulk-import/match/route.ts` — Change match search / typed ASIN
- `src/lib/utils/bulk-import-checks.ts` — `getImportBlocks`, `resolveBookByAsin`, `loadImportRoots`/`rootKind`/`isInMediaFolder`
- `src/lib/constants/bulk-import.ts` — refusal reasons, match limits (client-safe)

**Frontend:**
- `src/components/admin/BulkImportWizard.tsx` — Modal orchestrator
- `src/components/admin/bulk-import/types.ts` — Shared types
- `src/components/admin/bulk-import/ScanFolderStep.tsx` — Folder browser
- `src/components/admin/bulk-import/ScanProgressStep.tsx` — Progress display
- `src/components/admin/bulk-import/MatchReviewStep.tsx` — Review list + import
- `src/components/admin/bulk-import/ChangeMatchDialog.tsx` — Change match / Find match dialog
- `src/components/admin/bulk-import/ImportResultsView.tsx` — Finished screen (refused rows + reasons)
- `src/components/admin/bulk-import/row-match.ts` — Effective match, eligibility, Undo, payload, shared ASINs, `splitForImport` (send / held back)

**Modified:**
- `src/app/admin/page.tsx` — Added Bulk Import quick action + modal

## Fixed Issues
- **Row without an ASIN imported an arbitrary book (#588):** execute looked the row up with `audibleAsin: undefined`, which Prisma drops, so `findFirst` returned any audiobook. Fixed: ASIN shape checked first, no lookup
- **All-digit ASINs ignored (#280):** only `B` ASINs were read, so an ISBN-10 ASIN (also in the default `{title} {asin}` folder, no brackets) fell to a text search that could pick another book. Fixed: read as a candidate, confirmed by the catalog title (above)

## Related
- [Manual Import](manual-import.md) — Single-book import (reused pipeline)
- [Multi-Disc Folders](multi-disc-folders.md) — Disc folder rule and import order
- [File Organization](../phase3/file-organization.md) — organize_files job
- [Audible Integration](../integrations/audible.md) — Search/scraping
- [Background Jobs](../backend/services/jobs.md) — Job queue system
