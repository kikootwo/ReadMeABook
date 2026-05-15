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

## How It Works

### Organization Phase
**File:** `src/lib/processors/organize-files.processor.ts`

```typescript
const filesHash = generateFilesHash(result.audioFiles);
await prisma.audiobook.update({
  data: {
    filesHash: filesHash,  // SHA256 of sorted audio filenames
    // ... other fields
  }
});
```

### Library Scan Phase
**Files:** `scan-plex.processor.ts`, `plex-recently-added.processor.ts`

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
  await triggerABSItemMatch(item.externalId, matched?.audibleAsin);
}
```

**Phase 2: Request Matching**
```typescript
// Match requests to library items and mark as available
const match = await findPlexMatch({
  asin: audiobook.audibleAsin,
  title: audiobook.title,
  author: audiobook.author
});

if (match) {
  // Update audiobook and request status
  await prisma.audiobook.update({ data: { absItemId: match.plexGuid } });
  await prisma.request.update({ data: { status: 'available' } });

  // No metadata match triggering needed:
  // - Items without ASIN: Already handled in Phase 1
  // - Items with ASIN: Already have correct metadata
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

## Related
- [Audiobookshelf Integration](../integrations/audiobookshelf.md) - Backend mode
- [File Organization](../phase3/file-organization.md) - Organization flow
- [Database Schema](../backend/database.md) - Audiobook model
