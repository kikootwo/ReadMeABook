# Chapter Merging Feature

**Status:** ✅ Implemented (v2 - Enhanced) | Auto-merge multi-file chapters to M4B

## Overview

Automatically merge multi-file audiobook downloads (separate MP3/M4A files per chapter) into a single M4B file with proper chapter markers during file organization.

## Recent Updates

### v3 - Book Title Detection (2026-01-14)

**Status:** ✅ Implemented

**Critical Fix:**
- ✅ **Fixed identical chapter names bug** - Detects when title metadata contains book title instead of chapter names
- ✅ **Smart book title detection** - Analyzes files; if >80% have same title, flags it as book title
- ✅ **Updated filename patterns** - Added support for "BookTitle - 01 - ChapterName" format
- ✅ **Revised priority logic** - Prioritizes filename extraction over metadata when book title detected
- ✅ **Enhanced logging** - Reports book title detection and filename extraction strategy

**Impact:**
- Before: Files with book title in metadata → All chapters named "The Let Them Theory"
- After: Filename extraction prioritized → Ch1: "Opening Credits", Ch2: "Introduction: My Story", etc.

### v2 - Corruption Fixes (2026-01-09)

**Status:** ✅ Implemented

**Critical Fixes:**
1. ✅ **Fixed corruption on long audiobooks** - Dynamic timeout calculation (16h book = 254min vs old 20min)
2. ✅ **Fixed 1-minute playback delay** - Added `-movflags +faststart` (moov atom at beginning)
3. ✅ **Fixed seeking/timestamp issues** - Added `-fflags +genpts`, `-avoid_negative_ts`, `-max_muxing_queue_size`
4. ✅ **Added output validation** - Catches corrupt files before marked successful (duration, decode test, size)
5. ✅ **Quality preservation** - Matches source bitrate (64-320k) instead of fixed 128k
6. ✅ **Higher quality encoding** - Uses libfdk_aac if available (VBR mode 4)
7. ✅ **Fixed validation timeout bug** - Decode timeout was in seconds instead of milliseconds (killed valid files)
8. ✅ **Optimized validation** - Fast integrity test (first/last 10s) instead of decoding entire 16h file

**Impact:**
- Before: 16h audiobook → 20min timeout → Killed mid-process → Corrupt 6h file → Marked "successful" → 1-min playback delay
- After: 16h audiobook → 254min timeout → Completes fully → Valid 16h file → Validated → Instant playback

## Problem Statement

**Current Behavior:**
- Torrents with individual chapter files (e.g., `ch01.mp3`, `ch02.mp3`) are copied as-is
- Results in 10-50+ individual files in Plex library
- Poor playback experience (no chapter navigation, file switching)
- Inconsistent with single-file audiobook standard

**User Impact:**
- Must manually skip between files
- No chapter bookmarks/navigation
- Cluttered library view
- Some audiobook players don't handle multi-file books well

## Solution

Detect multi-file chapter downloads and merge into single M4B with embedded chapters.

## Key Requirements

### Detection Logic

**Simplified Detection Approach (v2):**

Detection now uses a **permissive heuristic** instead of strict filename pattern matching:

**Trigger Conditions:**
- 3+ audio files in download (2 files might be "Book + Credits", so require 3+)
- All files same format (m4a, m4b, mp3, etc.)
- Feature enabled in config

**Ordering Strategy (metadata-first):**
1. **Primary:** Use embedded track numbers if all files have sequential track metadata
2. **Fallback:** Use natural filename sorting if metadata incomplete
3. **Validation:** Compare both methods when available for confidence

**Why This Works Better:**
- Catches edge cases like `Andy Weir - Project Hail Mary - 03.mp3` (doesn't match patterns)
- Trusts metadata over filenames (more reliable)
- Graceful fallback to filename sorting if metadata missing
- Attempts merge on any multi-file audiobook, lets analysis phase decide ordering

**Exclusions (do NOT merge):**
- Less than 3 audio files
- Mixed formats (some MP3, some M4A)
- Single file downloads
- Unsupported formats

### Chapter Metadata Generation

**Chapter Naming Strategy (Updated v3):**

**Priority Order:**
1. **From filename:** Extract chapter name from filename patterns (most reliable)
   - "01 - The Beginning" → "The Beginning"
   - "Chapter 1 - Introduction" → "Introduction"
   - "BookTitle - 01 - ChapterName" → "ChapterName" (NEW: supports book title prefix)
2. **From metadata:** Use embedded title tag (only if chapter-specific)
   - Automatically detects if title metadata is the book title (appears in >80% of files)
   - Skips metadata that matches the book title to avoid "every chapter named the same"
3. **Fallback numbering:** "Chapter 1", "Chapter 2" if no name found

**Book Title Detection (NEW):**
- Analyzes all files to detect if title metadata contains the book title instead of chapter names
- If >80% of files have identical title metadata, flags it as the book title
- Prioritizes filename extraction when book title is detected in metadata
- Logs detection: "Detected book title in metadata: [title] (appears in X/Y files)"

**Chapter Timing:**
- Calculate from individual file durations using ffprobe
- Format: FFMETADATA1 standard
- Timestamps in milliseconds

**Example:**
```
;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=2700000
title=Chapter 1: The Beginning

[CHAPTER]
TIMEBASE=1/1000
START=2700000
END=5400000
title=Chapter 2: The Journey
```

### FFmpeg Implementation

**For M4A/M4B files (same format, no re-encode):**
```bash
# 1. Create concat list
echo "file '/path/ch01.m4a'" > filelist.txt
echo "file '/path/ch02.m4a'" >> filelist.txt

# 2. Generate chapter metadata
# [Create chapters.txt with timing from durations]

# 3. Merge with chapters (v2 - enhanced)
ffmpeg -y -f concat -safe 0 -i filelist.txt \
  -i chapters.txt \
  -map_metadata 1 \
  -map 0:a \
  -codec copy \
  -movflags +faststart \           # NEW: Index at beginning (instant playback)
  -fflags +genpts \                 # NEW: Regenerate timestamps
  -avoid_negative_ts make_zero \    # NEW: Handle negative timestamps
  -max_muxing_queue_size 9999 \     # NEW: Prevent buffer overflow
  -metadata title="Book Title" \
  -metadata album="Book Title" \
  -metadata album_artist="Author" \
  -metadata artist="Author" \
  -metadata composer="Narrator" \
  -metadata date="2024" \
  -f mp4 \
  output.m4b
```

**For MP3 files (requires conversion - v2 enhanced):**
```bash
# Re-encode to M4B (AAC) with quality preservation
# Uses libfdk_aac if available (higher quality) or native aac
ffmpeg -y -f concat -safe 0 -i filelist.txt \
  -i chapters.txt \
  -map_metadata 1 \
  -map 0:a \
  -c:a libfdk_aac -vbr 4 \          # High quality AAC (or: -c:a aac -b:a <source_bitrate> -profile:a aac_low)
  -movflags +faststart \             # CRITICAL: Instant playback
  -fflags +genpts \                  # Fix timestamps
  -avoid_negative_ts make_zero \     # Handle edge cases
  -max_muxing_queue_size 9999 \      # Long file support
  -metadata title="Book Title" \
  # ... (same metadata)
  -f mp4 \
  output.m4b
```

**Quality Settings (MP3 → M4B - v2):**
- **Bitrate:** Matches source average (64-320kbps range)
  - Example: 128kbps MP3 source → 128kbps AAC output
  - Example: 192kbps MP3 source → 192kbps AAC output
- **Encoder:** libfdk_aac (VBR mode 4, high quality) if available, else native aac
- **Profile:** AAC-LC (maximum compatibility)
- **Sampling rate:** Preserved from source
- **Channels:** Preserved (mono/stereo)

**Critical Flags (v2):**
- **`-movflags +faststart`**: Moves moov atom to file beginning → instant playback (fixes 1-min delay)
- **`-fflags +genpts`**: Regenerates presentation timestamps → fixes seeking/timing issues
- **`-avoid_negative_ts make_zero`**: Handles negative timestamps at concat boundaries
- **`-max_muxing_queue_size 9999`**: Prevents buffer overflow on long audiobooks (16h+)

### File Naming

**Output filename:**
```
[Author]/[Title] ([Year])/[Title].m4b
```

**Cover art:** Extract from first file or download from Audible (existing logic)

### Configuration

**New config keys:**
- `chapter_merging_enabled` (boolean, default: false)
- `chapter_merging_mp3_bitrate` (string, default: "128k")
- `chapter_merging_delete_originals` (boolean, default: true - after successful merge)

**Settings UI (Admin → Paths tab):**
```
☐ Merge multi-file chapter downloads into single M4B
  ↳ Audio quality for MP3 conversion: [128kbps ▼]
  ↳ ☑ Delete original chapter files after merge
```

**Setup wizard (Paths step):**
- Checkbox: "Merge chapter files" (default: unchecked)
- Tooltip: "Combines separate chapter files into single audiobook with chapter markers"

## Logging & Transparency

**Status:** ✅ Implemented (v2)

All chapter merging decisions are **fully logged** for user transparency:

**Detection Phase Logs:**
- File count and format detection
- Chapter merge setting status
- Reason for skipping merge (if applicable)
- Disk space validation

**Analysis Phase Logs:**
- Sample filenames for debugging
- Book title detection in metadata (NEW v3)
- Metadata availability (track numbers)
- Ordering strategy chosen (metadata vs filename)
- Sample chapter titles generated
- Confidence level assessment

**Merge Phase Logs:**
- Book title, author, output filename
- Total duration and estimated size
- Merge strategy (codec copy vs re-encode)
- Bitrate decision for MP3 conversions
- FFmpeg execution status
- Final file size and chapter count
- Cleanup status

**Example Log Output (v3 with book title detection):**
```
[FileOrganizer] Multiple audio files detected (31 files) - checking chapter merge settings...
[FileOrganizer] Chapter merging enabled - analyzing files...
[FileOrganizer] Chapter detection: 31 files with format .mp3 - attempting chapter merge
[FileOrganizer] Analyzing 31 chapter files...
[FileOrganizer] Sample filenames: The Let Them Theory - 01 - Opening Credits.mp3, The Let Them Theory - 02 - Introduction_ My Story.mp3, ...
[FileOrganizer] Detected book title in metadata: "The Let Them Theory" (appears in 31/31 files)
[FileOrganizer] Title metadata flagged as book title - will prioritize filename extraction for chapter names
[FileOrganizer] Metadata analysis: 31/31 files have track numbers
[FileOrganizer] Track numbers: 1, 2, 3 ... 31
[FileOrganizer] Chapter ordering: Filename and metadata orders match - high confidence
[FileOrganizer] Using metadata-based ordering for 31 chapters
[FileOrganizer] Sample chapter titles: Ch1: "Opening Credits", Ch2: "Introduction: My Story", Ch3: "Dedication", ...
[FileOrganizer] Starting chapter merge: "The Let Them Theory" by Mel Robbins
[FileOrganizer] Merge strategy: Re-encoding MP3 → AAC/M4B at 128k
[FileOrganizer] Executing FFmpeg merge (timeout: 254 minutes)...
[FileOrganizer] ✓ Chapter merge successful!
[FileOrganizer]   - Chapters: 31
[FileOrganizer]   - Duration: 16h 32m 10s
[FileOrganizer]   - Size: 452MB
```

## User Experience

### Success Flow

1. Download completes: 30 chapter MP3 files
2. File organization starts
3. System checks chapter merge settings (logs: enabled/disabled)
4. Detects multi-file audiobook (logs: file count, format)
5. Analyzes ordering strategy (logs: metadata vs filename, sample files)
6. Merges files with detailed logging:
   - Detection: "30 files with format .mp3 - attempting chapter merge"
   - Analysis: "Using metadata-based ordering for 30 chapters"
   - Merge: "Re-encoding MP3 → AAC/M4B at 128k"
   - Progress: "Executing FFmpeg merge (timeout: 20 minutes)..."
   - Success: "✓ Chapter merge successful! 30 chapters, 16h 32m, 452MB"
7. Copies merged M4B to target directory (logs: copy status)
8. Cleans up temp files (logs: cleanup status)
9. Originals kept for seeding (cleaned up by separate scheduled job)
10. Plex scans single M4B with full chapter navigation

### Fallback Flow

**If merge fails or skipped:**
1. System logs reason clearly:
   - "Chapter merging disabled in settings - organizing 30 files individually"
   - "Only 2 file(s) - not enough for chapter merge (minimum: 3)"
   - "Mixed formats detected (.mp3, .m4a) - skipping merge"
   - "Insufficient disk space - organizing files individually"
   - "Chapter merge failed: [FFmpeg error] - organizing files individually"
2. Falls back gracefully: organize individual files
3. Mark request as "available" (not failed)
4. User can manually merge later or enable setting

**Failure scenarios with logging:**
- Feature disabled → Logs: "Chapter merging disabled in settings"
- Too few files → Logs: "Only X file(s) - not enough for chapter merge"
- Mixed formats → Logs: "Mixed formats detected - skipping merge"
- Insufficient disk space → Logs: "Insufficient disk space for merge"
- FFmpeg crash/timeout → Logs: "FFmpeg merge failed: [error details]"
- Corrupted source files → Logs: "Failed to probe audio file: [error]"

## Technical Implementation

### File: `src/lib/utils/chapter-merger.ts`

**Exports:**
```typescript
interface ChapterFile {
  path: string;
  filename: string;
  duration: number; // seconds
  chapterName: string; // extracted from filename
}

interface MergeOptions {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
  outputPath: string;
  mp3Bitrate?: string; // default: "128k"
}

interface MergeResult {
  success: boolean;
  outputPath?: string;
  chapterCount?: number;
  duration?: number; // total seconds
  error?: string;
}

// Main functions
async function detectChapterFiles(files: string[], logger?: JobLogger): Promise<boolean>;
async function analyzeChapterFiles(filePaths: string[], logger?: JobLogger): Promise<ChapterFile[]>;
async function probeAudioFile(filePath: string): Promise<AudioProbeResult>;
async function mergeChapters(chapters: ChapterFile[], options: MergeOptions, logger?: JobLogger): Promise<MergeResult>;
function formatDuration(ms: number): string;
async function checkDiskSpace(directory: string): Promise<number | null>;
async function estimateOutputSize(filePaths: string[]): Promise<number>;
```

### Integration Points

**File: `src/lib/utils/file-organizer.ts`**

**Modify `organize()` method (Updated v2):**
```typescript
// After finding audiobook files (line ~98)
if (audioFiles.length > 1) {
  await logger?.info(`Multiple audio files detected (${audioFiles.length} files) - checking chapter merge settings...`);

  const config = await prisma.configuration.findUnique({
    where: { key: 'chapter_merging_enabled' }
  });

  const mergingEnabled = config?.value === 'true';

  if (!mergingEnabled) {
    await logger?.info(`Chapter merging disabled in settings - organizing ${audioFiles.length} files individually`);
  } else {
    await logger?.info(`Chapter merging enabled - analyzing files...`);

    // Build full paths
    const sourceFilePaths = audioFiles.map(f => path.join(downloadPath, f));

    // Simple detection: 3+ files, same format
    const isChapterDownload = await detectChapterFiles(sourceFilePaths, logger);

    if (isChapterDownload) {
      // Check disk space
      const estimatedSize = await estimateOutputSize(sourceFilePaths);
      const availableSpace = await checkDiskSpace(this.tempDir);

      if (availableSpace !== null && availableSpace < estimatedSize) {
        await logger?.warn(`Insufficient disk space - organizing files individually`);
      } else {
        // Analyze and order (metadata-first)
        const chapters = await analyzeChapterFiles(sourceFilePaths, logger);

        // Merge chapters
        const mergeResult = await mergeChapters(chapters, {
          title: audiobook.title,
          author: audiobook.author,
          narrator: audiobook.narrator,
          year: audiobook.year,
          asin: audiobook.asin,
          outputPath: path.join(this.tempDir, `${audiobook.title}.m4b`)
        }, logger);

        if (mergeResult.success) {
          // Replace array with single merged file
          audioFiles.length = 0;
          audioFiles.push(mergeResult.outputPath);
          await logger?.info(`Chapter merge complete - organizing single M4B file`);
        } else {
          await logger?.warn(`Chapter merge failed - organizing files individually`);
        }
      }
    }
  }
}
```

**Key Changes:**
- Simplified detection (3+ files, same format)
- Comprehensive logging at every decision point
- Metadata-first ordering in `analyzeChapterFiles`
- Graceful fallback with clear user messaging

### Database Schema

**No changes required** - uses existing `Configuration` table

### Dependencies

**Already available:**
- ffmpeg (installed in Docker images)
- ffprobe (for duration detection)

## Timeout & Validation (v2)

**Status:** ✅ Implemented

### Dynamic Timeout Calculation

**Problem:** Fixed 20-minute timeout was insufficient for long audiobooks (16h+ books need 90-120 minutes to encode).

**Solution:**
```typescript
// For re-encoding (MP3 → AAC)
timeout = max(
  90 minutes,  // minimum
  (duration_minutes / 5) + 60 minutes  // 5x realtime (worst case) + 60min safety
)

// Examples:
// 16h book: (960 / 5) + 60 = 252 minutes
// 8h book:  (480 / 5) + 60 = 156 minutes
// 30min book: 90 minutes (minimum)

// For codec copy (M4A → M4B)
timeout = 5 minutes + (chapter_count * 30 seconds)
// Much faster, no encoding needed
```

### Output Validation

**Status:** ✅ Implemented

All merged files are validated before marked successful:

1. **Duration Check:** Expected vs actual duration (within 2% tolerance)
2. **Decode Test:** FFmpeg attempts to decode first 10 seconds (catches corruption)
3. **Size Check:** File size reasonable for duration (~0.5MB/min minimum)

**If validation fails:**
- Corrupt file is deleted
- Error logged with specific failure reason
- Falls back to organizing individual files
- Request marked "available" (not failed)

**Example validation failure:**
```
[FileOrganizer] Duration check: expected 16h 10m 54s, got 6h 13m
[FileOrganizer] ✗ Output validation failed: Duration mismatch (61.6% off). File may be truncated.
[FileOrganizer] Deleted corrupt output file
[FileOrganizer] Chapter merge failed - organizing 30 files individually
```

## Edge Cases & Error Handling

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Mixed formats (MP3 + M4A) | Skip merge, copy individually |
| Non-sequential numbering (1, 3, 5) | Attempt merge, log warning |
| Duplicate chapter numbers | Sort by filename, log warning |
| Very large file count (100+ chapters) | Continue merge, increase timeout |
| Missing chapters (1, 2, 4) | Merge available, log warning |
| Single chapter file | Skip merge (not a multi-file book) |
| No chapter indicators | Skip merge, copy individually |

### Error Handling

**Disk space checks:**
- Estimate merged file size (sum of source files + 10% overhead)
- Check available space before merge
- Fail gracefully if insufficient space

**Timeouts:**
- Set timeout based on file count and size
- Default: 5 minutes + (1 minute per chapter)
- Log progress every 10 chapters

**Cleanup:**
- Always remove temp concat lists
- Remove temp merged file on failure
- Keep original files if merge fails

## Performance Considerations

### Processing Time Estimates

**M4A/M4B merge (no re-encode):**
- 10 chapters: ~30 seconds
- 25 chapters: ~1 minute
- 50 chapters: ~2 minutes

**MP3 → M4B conversion:**
- 10 hours audiobook: ~5-10 minutes (depends on CPU)
- Real-time encoding speed varies by hardware

### Resource Usage

- **CPU:** High during MP3 conversion, low for M4A copy
- **Disk:** Requires space for temp merged file (= sum of source files)
- **Memory:** Low (streaming processing)

### Optimization

- Process in background job (already async)
- Don't block other downloads
- Limit concurrent merges (1 at a time recommended)

## Testing Strategy

### Test Cases

1. **M4A chapter files (20 files)**
   - Verify merge succeeds
   - Verify chapter count matches file count
   - Verify metadata preserved
   - Verify chapter navigation works in Plex

2. **MP3 chapter files (15 files)**
   - Verify conversion to M4B
   - Verify audio quality (bitrate ~128kbps)
   - Verify no audio glitches at chapter boundaries

3. **Mixed formats**
   - Verify merge skipped
   - Verify fallback to individual files

4. **Failed merge**
   - Verify fallback behavior
   - Verify original files preserved
   - Verify request marked available (not failed)

5. **Chapter naming**
   - "Ch1.mp3" → "Chapter 1"
   - "001 - Introduction.mp3" → "Introduction"
   - "Part 1.mp3" → "Part 1"

6. **Edge cases**
   - Single file: no merge
   - 100+ chapters: successful merge
   - Missing chapters (gaps): successful merge with warning

## Success Metrics

### Functional (v2 - Enhanced)
- ✅ Successful merge rate > 95% (for valid chapter downloads)
- ✅ **Validation catches 100% of corrupt files** (new)
- ✅ Chapter navigation works in Plex/Audiobookshelf
- ✅ Zero audio quality degradation (M4A copy mode, source-matched bitrate for MP3)
- ✅ Fallback works 100% of time on merge failure
- ✅ **No timeout failures for long audiobooks** (new - 16h+ books complete successfully)

### Performance (v2 - Enhanced)
- ✅ M4A merge: < 2 minutes for 25 chapters (codec copy, no re-encode)
- ✅ MP3 conversion: ~10x realtime (16h book = 90-120 minutes)
- ✅ **Instant playback start** (new - faststart flag moves index to beginning)
- ✅ No impact on concurrent downloads
- ✅ **Proper timeout allocation** (new - 126 min for 16h books vs old 20 min)

### User Experience (v2 - Enhanced)
- ✅ Feature opt-in (default disabled)
- ✅ **Comprehensive logging** (new - detection, analysis, merge, validation)
- ✅ Single file in Plex instead of dozens
- ✅ Proper chapter markers in audiobook players
- ✅ **Transparent validation** (new - users know if file is good or corrupt)
- ✅ **Quality preservation** (new - matches source bitrate, libfdk_aac if available)

## Implementation Phases

### Phase 1: Core Functionality (MVP) ✅ COMPLETED
- [x] Implement `chapter-merger.ts` utility
- [x] Detection logic (simplified: 3+ files, same format)
- [x] Natural sorting algorithm
- [x] Duration extraction (ffprobe)
- [x] Chapter metadata generation (FFMETADATA1)
- [x] M4A/M4B merge (codec copy mode)
- [x] Integration with file-organizer.ts
- [x] Configuration keys in database

### Phase 2: MP3 Support ✅ COMPLETED
- [x] MP3 → M4B conversion logic
- [x] Quality preservation settings (dynamic bitrate)
- [x] Bitrate configuration (automatic, based on source)

### Phase 3: Logging & Transparency ✅ COMPLETED (v2)
- [x] Comprehensive logging at all decision points
- [x] Detection phase logging (file count, format, settings)
- [x] Analysis phase logging (metadata vs filename, samples)
- [x] Merge phase logging (strategy, progress, results)
- [x] Error logging with clear fallback messaging
- [x] User transparency for all decisions

### Phase 4: UI Integration ✅ COMPLETED
- [x] Setup wizard integration
- [x] Admin settings UI (Paths tab)
- [x] Configuration persistence

### Phase 5: Corruption Fixes & Validation ✅ COMPLETED (v2)
- [x] Dynamic timeout calculation (fixes 16h+ book timeouts)
- [x] Add `-movflags +faststart` (fixes 1-min playback delay)
- [x] Add `-fflags +genpts` (fixes timestamp/seeking issues)
- [x] Add `-avoid_negative_ts make_zero` (handles edge cases)
- [x] Add `-max_muxing_queue_size` (prevents buffer overflow)
- [x] Output validation (duration, decode test, size check)
- [x] Source bitrate matching (preserves quality)
- [x] libfdk_aac support (higher quality when available)
- [x] Corrupt file detection and cleanup

### Phase 6: Advanced Features (Future)
- [ ] Real-time progress logging with FFmpeg output parsing
- [ ] Custom chapter naming from file metadata (partially done)
- [ ] Chapter art extraction (if embedded in files)
- [ ] Preview merged file before finalizing
- [ ] Manual chapter editing UI
- [ ] Parallel chapter processing (analyze while downloading)

## Related Documentation

- [File Organization](../phase3/file-organization.md) - File copying and tagging
- [Metadata Tagging](../phase3/file-organization.md#metadata-tagging) - Current tagging system
- [Background Jobs](../backend/services/jobs.md) - Job processing system
- [Configuration](../backend/services/config.md) - Settings management

## Open Questions

1. **Chapter naming strategy:** Should we try to extract from embedded metadata first, or always use filename?
2. **MP3 default behavior:** Should MP3 merging be opt-in separately (slower, lossy)?
3. **Parallel processing:** Merge multiple books at once, or serialize?
4. **Preview mode:** Let users review chapter detection before merge?
5. **Retry logic:** Auto-retry failed merges with different settings?

## References

- FFmpeg concat demuxer: https://trac.ffmpeg.org/wiki/Concatenate
- FFmpeg metadata: https://ffmpeg.org/ffmpeg-formats.html#Metadata-1
- M4B format spec: ISO/IEC 14496-12 (MPEG-4 Part 12)
- Natural sorting: https://en.wikipedia.org/wiki/Natural_sort_order
