# File Hash-Based Library Matching

**Status:** ✅ Implemented | Accurate ASIN matching for RMAB-organized audiobooks

## Overview
Solves false positive matches in Audiobookshelf fuzzy search by using file hash matching for RMAB-downloaded content.

## Problem
- New ABS items without ASIN → fuzzy Audible search by title/author
- Risk: Wrong book matches (e.g., "Foundation" → "Foundation and Empire")
- Result: Incorrect metadata, false positives

## Solution
**File Hash Matching Strategy:**
1. Generate SHA256 hash of audio filenames during organization
2. Store hash in `Audiobook.filesHash` field
3. During library scan: compare ABS item files against database hashes
4. Match found → Use request's ASIN for 100% accurate metadata
5. No match → Fallback to fuzzy search (external content)
6. ASIN read-back (#287): store the ASIN from the ABS match response on `plex_library` in the same scan

## How It Works

### Organization Phase
**File:** `src/lib/processors/organize-files.processor.ts`

```typescript
// This import's audio after format coercion; 'differs' targets (files the library already held) excluded
const filesHash = generateFilesHash(importedAudio);
await prisma.audiobook.update({
  data: {
    filesHash: filesHash,  // SHA256 of sorted audio filenames
    // ... other fields
  }
});
```

### Library Scan Phase
**Files:** `scan-plex.processor.ts`, `plex-recently-added.processor.ts` → both call `matchItemsWithoutAsin(items, logger)` in `src/lib/services/audiobookshelf/match-missing-asins.ts`

**Phase 1: File Hash Matching (Items WITHOUT ASIN)**
```typescript
const itemsWithoutAsin = libraryItems.filter(item => !item.asin && item.externalId);

for (const item of itemsWithoutAsin) {
  // 1. Fetch ABS item details
  const absItem = await getABSItem(item.externalId);

  // 2. Generate hash from ABS audio filenames
  const audioFilenames = absItem.media.audioFiles.map(f => f.metadata.filename);
  const itemHash = generateFilesHash(audioFilenames);

  // 3. Query for matching RMAB download
  const matched = await prisma.audiobook.findFirst({
    where: { filesHash: itemHash, status: 'completed' }
  });

  // 4. Trigger metadata match (with ASIN if matched, undefined if not)
  const outcome = await triggerABSItemMatch(item.externalId, matched?.audibleAsin);

  // 5. Read the ASIN back (#287): request checks see it now, not at the next scan
  await storeMatchedAsin(item.externalId, item.title, outcome, logger);
}
```

**Phase 2: Request Matching** (`matchRequestsToLibrary`, `src/lib/services/library/match-requests.ts`, shared by both jobs; the scan job still logs `Matched N/M requests` and both return `matchedDownloads`)
```typescript
// ABS only, request 'downloaded' + book folder on record: library link first (#284, below)
// Otherwise, and when the link finds nothing: match by the book's ASIN
const match = await findPlexMatch({ asin: audiobook.audibleAsin, title, author });
if (match) {
  // compare-and-set: two jobs in one window notify once, and only the winner records the item
  const { count } = await prisma.request.updateMany({
    where: { id, status: { notIn: ['available', 'cancelled', 'denied'] } },
    data: { status: 'available' /* + completedAt, counters reset */ },
  });
  if (count === 1) {
    await prisma.audiobook.update({ data: { absItemId: match.plexGuid } }); // kept when this run linked the book
    notify('request_available');
  }
}
```

## Hash Generation Algorithm
**File:** `src/lib/utils/files-hash.ts`

**Process:**
1. Extract basenames from file paths
2. Filter to audio extensions: `.m4b`, `.m4a`, `.mp3`, `.mp4`, `.aa`, `.aax`
3. Normalize to lowercase (case-insensitive)
4. Sort alphabetically (deterministic order)
5. Generate SHA256: `crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex')`

**Properties:**
- Deterministic: Same files → same hash (regardless of order/path)
- Path-agnostic: Only basenames matter
- Case-insensitive: "CHAPTER 01.mp3" === "chapter 01.mp3"
- Fast: O(1) database lookup with indexed field

## Database Schema

**Model:** `Audiobook`

```prisma
model Audiobook {
  // ... existing fields
  filesHash String? @map("files_hash") @db.Text  // SHA256 (64 chars)

  @@index([filesHash])  // Fast O(1) lookups
}
```

**Migration:** `20260126100000_add_audiobook_files_hash`

## Implementation Details

### Metadata Match Strategy

**Phase 1 (File Hash):** Handle NEW items WITHOUT ASIN
- Filter: `libraryItems.filter(item => !item.asin)`
- Trigger metadata match with file-hash-matched ASIN or undefined
- **This is the ONLY phase that triggers ABS metadata matching**
- Read-back: the ASIN ABS holds after the match is stored at once (runs before Phase 2, so a waiting request goes `available` in the same scan)

### ASIN Read-Back (#287)
- **Why:** the match response was discarded; the ASIN reached `plex_library` only at the next full scan (up to 6 h), so a request for an owned book inside that window passed the library check
- **ABS API:** `POST /api/items/:id/match` (ABS 2.36/2.37) is synchronous and saves before replying
  - No match: `200 { warning: "No <provider> match found" }`
  - Else: `{ updated, libraryItem }`, ASIN at `libraryItem.media.metadata.asin`
- **Client:** `triggerABSItemMatch(itemId, asin?)` → `ABSMatchOutcome` = `matched {updated, libraryItem}` | `no_match {warning}` | `error {error}`; never throws; `ABS_MATCH_TIMEOUT_MS = 180_000` (a legitimate match takes ~60 s; Node fetch would stop at 300 s)

| Case | Write |
|---|---|
| Valid ASIN (`/^[A-Z0-9]{10}$/i` after trim; numeric Audible ASINs pass) | `plexLibrary.updateMany({where:{plexGuid}})` |
| Different valid ASIN on the row | Replaced + logged (same end state as the next scan's `item.asin \|\| existing.asin`) |
| No match, timeout, HTTP/JSON error | None; next scan retries |
| Empty, null, ISBN-13, hyphenated, non-string, missing `media.metadata` | None; an existing ASIN is never blanked |
| ISBN only | None (`isbn` is never read as an ASIN) |
| File-hash ASIN sent but ABS reports none | None: store only what ABS reports |
| No `plex_library` row / write throws | None / own catch (logged; the item's match is not counted twice), loop continues |

### Delivered requests link to the library item (#284)
- **Why:** organize ends at `downloaded`, and only an ASIN match moved the request on. When ABS holds RMAB's folder under another ASIN (tags, folder name, its own match, another region), the request stayed `downloaded` forever.
- **Rule:** after delivery the library item that holds RMAB's folder is the record. Before delivery the request ASIN still drives search (no change). Never link an item that might be another copy or another book; when unsure, link nothing (the ASIN match still runs, the next run tries again).
- **When:** `backendMode === 'audiobookshelf'`, audiobook request `status === 'downloaded'`, `audiobook.filePath` set. Tried before the ASIN match, once per audiobook and delivery time per run. Plex: ASIN match only (unchanged). Every other status: ASIN match only. Ebook requests are never matched.
- **Data:** the ABS list's `path`/`isMissing` → `LibraryItem`; both jobs store `plex_library.file_path = item.path ?? existing.filePath` (also on the #222 race fallback). `isMissing` is not stored: it comes from this run's listing, else from the item fetch. ABS `relPath` is not used (it is relative to *its* ABS library folder, so it collides across folders).
- **Modules:** `src/lib/services/library/request-library-link.ts` → `findDeliveredLibraryItem(book, deliveredAt, ctx)` → `{status:'linked', plexGuid, via:'path'|'hash'}` | `{status:'ambiguous', ids}` | `{status:'unknown'}` | `{status:'none'}`. Item reads + cache: `library-item-lookup.ts`. Path helper shared with the request delete's `absItemInside`: `src/lib/utils/library-item-path.ts`.
- **Window:** `delivery - 1 h` to `delivery + 72 h` (`LINK_WINDOW_BEFORE_MS`, `LINK_WINDOW_AFTER_MS`) on ABS `addedAt`.

| Step | Candidates (this library's rows, loaded once per run, compared in JS) | Links when |
|---|---|---|
| Path | `rel` = RMAB folder relative to the canonical `media_dir` (none when empty or starting with `..`). Exact: row path (`\` → `/`, no trailing `/`, NFC) equals RMAB's folder (as stored or canonical). Suffix-only: the path equals `rel` or ends with `'/' + rel` (another mount, another ABS library folder). Missing and 404 items skipped | exact: on its own (a hash difference does not block it); suffix-only: files hash equal, or `addedAt` in the window (one-segment `rel`, e.g. template `{title}`: files hash only) |
| `audiobook.fileFormat` is an ebook format | the folder on record may be the ebook's (an ebook import overwrites `filePath`) | every path candidate needs the files hash |
| Several qualified | the qualified ones | exactly 1 with files hash = `audiobook.filesHash`; else ambiguous |
| None qualified | rows in the window, not linked to another audiobook (`absItemId`, or linked / ASIN-matched earlier in this run), not at another audiobook's folder (its path, or a path ending with that folder relative to `media_dir`); oldest first, at most 20 (`HASH_FALLBACK_LIMIT`) | exactly 1 equal files hash; 2+ ambiguous |

- **Unreadable item** (any fetch error but 404, or the run's budget spent) while it is a path candidate, needs a hash check, or sits in the fallback pool before a decision: `unknown`, no link this run.
- **Delivery time:** each audiobook request's own `completedAt` (organize sets it at `downloaded`), `updatedAt` when null. Never `audiobook.completedAt`: an ebook import overwrites that row's `completedAt` and `filePath`.
- **Caveats:** a separate ebook path template can leave `filePath` at the ebook folder: the link then needs the files hash (path candidate or fallback). The files hash covers only the audio RMAB imported, while ABS lists every audio file in the folder: when RMAB's folder already held other audio, the hash never matches, so only an exact path links that book (fails safe: no link, the ASIN match still applies).
- **Load:** each run fetches (`GET /api/items/:id`) an item at most once and at most 50 items (`LINK_HASH_LOOKUP_BUDGET`). Reads are cached per process: an item (or a 404) 6 h (`ITEM_CACHE_MS`), a failed read 1 h (`ITEM_ERROR_CACHE_MS`). A request that never links re-reads each item it looks at (its path candidates, at most 20 pool rows) at most once per 6 h, and its pool stops growing 72 h after delivery.
- **On link / ASIN match:** request `updateMany({where:{id, status}})` first (link: `'downloaded'`; ASIN: non-terminal) → `available` + `completedAt` + counters reset; only when the count is 1: `audiobook.absItemId` (ASIN on Plex: `plexGuid`) and one `request_available`. An ASIN match of another request on a book this run linked keeps the link's item. Two requests of one book linking two different items: the second is ambiguous. `audible_asin`, title, author and narrator are **not** written.
- **Ambiguous:** no link, the ASIN match still runs; warn once per audiobook per process, then debug. Each run with any link outcome logs `Library link: N by path, N by hash, N ambiguous, N left for the next run`.
- **Upgrade:** the first full scan fills `file_path` for every ABS row; requests stuck in `downloaded` then go `available` with one notification each.

**Phase 2 (Request Match):** Match requests, no metadata triggering
- Match requests to library items by ASIN/title/author
- Update request status to 'available'
- **No metadata match triggering** - items either:
  - Were handled in Phase 1 (new items without ASIN)
  - Already have correct metadata (items with ASIN from ABS)

**Why This Works:**
- **Single source of truth**: Only file hash phase triggers metadata matching
- **No redundant API calls**: Items with ASIN already have correct metadata
- **Clean separation**: Phase 1 = metadata, Phase 2 = request matching
- **Simple and efficient**: No duplicate checks, no wasted API calls

## Edge Cases

### Externally-Added Content
- User manually imports audiobook to ABS (not via RMAB)
- No matching `filesHash` in database
- **Fallback:** Fuzzy metadata match (current behavior preserved)

### Modified Files
- User adds/removes chapters after organization
- ABS hash won't match RMAB hash
- **Fallback:** Fuzzy metadata match

### Existing Content (Before Feature)
- Audiobooks organized before hash feature
- `filesHash` field is NULL
- **Behavior:** Continues using fuzzy matching
- **Future:** Admin job could backfill hashes (out of scope)

### Chapter-Merged Files
- 20 MP3s → 1 M4B via chapter merging
- Hash generated AFTER merging
- **Works correctly:** Hash reflects final organized state

### Coerced Files (Plex Format Coercion)
- Files renamed from `.mp4` → `.m4b` (or single-file `.m4a` → `.m4b`) by Plex format coercion
- Hash generated AFTER coercion → reflects post-coercion filenames
- **Works correctly going forward:** ABS sees post-coercion names, hash matches
- **Pre-existing library entries** hashed before coercion was enabled will NOT match post-coercion files — retroactive library sweep is out of scope (see issue #166)

### Multiple Downloads (Same Book)
- User re-downloads same audiobook (different edition/request)
- Multiple records with same `filesHash`
- **Solution:** `findFirst()` returns first match (acceptable - same ASIN)

## Performance

**Storage:**
- New index: ~8 bytes per row (minimal)
- SHA256 hash: 64 characters per record

**API Calls:**
- One additional `getABSItem()` call per item without ASIN
- Typical response: ~1-5KB JSON
- Latency: ~50-100ms per call

**Database:**
- Index lookup: O(1) with hash index (extremely fast)

**Impact:**
- 10 items without ASIN → +500-1000ms per scan (acceptable)

## Logging

**Organization:**
```
[INFO] Generated files hash: abc123def456... (5 audio files)
```

**Library Scan (Match Found):**
```
[INFO] File hash match found for "Foundation" → ASIN: B08G9PRS1K (from "Foundation (Unabridged)")
[INFO] Triggered metadata match with ASIN B08G9PRS1K for: "Foundation"
```

**Library Scan (No Match):**
```
[INFO] No file match found, triggering fuzzy metadata match for: "The Expanse"
```

## Benefits

✅ **100% Accurate Matching** - RMAB-organized content always gets correct ASIN
✅ **Path-Agnostic** - Works regardless of folder structure differences
✅ **Fast Lookups** - O(1) database query with indexed field
✅ **Graceful Fallback** - External content still works via fuzzy matching
✅ **No Breaking Changes** - Existing content continues working

## Testing

**Unit Tests:** `tests/utils/files-hash.test.ts`
- Hash generation correctness
- Deterministic behavior
- Edge case handling

**Integration Tests:** `tests/processors/*.test.ts`
- Hash storage during organization
- Hash matching during library scan
- Fallback to fuzzy matching

## Fixed Issues
- ✅ #284: a delivered request whose ABS item carries another ASIN stayed `downloaded` forever → linked by path or files hash (`request-library-link.ts`, `match-requests.ts`); the request ASIN and metadata are unchanged; both match paths complete the request with a compare-and-set, so two library jobs in one window notify once; an exact `relPath` in another ABS library folder, an unreadable candidate, an item added long after delivery, an item at another audiobook's folder and a lost compare-and-set no longer link or record the wrong item
- ✅ #287 window: ASIN from the ABS match was discarded until the next full scan → read back in the same scan (`match-missing-asins.ts`); BookDate right swipe now runs the two ownership checks of `POST /api/requests` (any user's downloaded/available request, then library; not the in-flight check) and returns `requestCreated` + `reason`

## Related
- [Audiobookshelf Integration](../integrations/audiobookshelf.md) - Backend mode
- [File Organization](../phase3/file-organization.md) - Organization flow
- [Database Schema](../backend/database.md) - Audiobook model
