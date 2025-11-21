# Chapter Merging Feature

**Status:** ❌ Not Started | Product Requirements Document

## Overview

Automatically merge multi-file audiobook downloads (separate MP3/M4A files per chapter) into a single M4B file with proper chapter markers during file organization.

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

**Chapter File Patterns (auto-detect):**
- Numeric: `01.mp3`, `001.mp3`, `1.mp3`
- Named: `Chapter 1.mp3`, `Chapter 01.mp3`, `Ch1.mp3`, `Ch 01.mp3`
- Part-based: `Part 1.mp3`, `Part01.mp3`
- Combined: `Harry Potter - 01 - Chapter 1.mp3`

**Trigger Conditions:**
- 2+ audio files in download
- Files match chapter naming pattern
- All files same format (m4a, m4b, mp3)
- Feature enabled in config

**Exclusions (do NOT merge):**
- Mixed formats (some MP3, some M4A)
- Non-sequential numbering
- Files without clear chapter indicators
- Single file downloads

### Chapter Metadata Generation

**Chapter Naming Strategy:**
1. **From filename:** Extract "Chapter 1", "01", "Part 1"
2. **Fallback numbering:** "Chapter 1", "Chapter 2" if no name found
3. **Preserve order:** Sort files naturally (ch1, ch2, ch10)

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

# 3. Merge with chapters
ffmpeg -f concat -safe 0 -i filelist.txt \
  -i chapters.txt \
  -map_metadata 1 \
  -codec copy \
  -metadata title="Book Title" \
  -metadata album="Book Title" \
  -metadata album_artist="Author" \
  -metadata artist="Author" \
  -metadata composer="Narrator" \
  -metadata date="2024" \
  -f mp4 \
  output.m4b
```

**For MP3 files (requires conversion):**
```bash
# Must re-encode to M4B (AAC)
ffmpeg -f concat -safe 0 -i filelist.txt \
  -i chapters.txt \
  -map_metadata 1 \
  -codec:a aac -b:a 128k \  # Quality preservation
  -metadata title="Book Title" \
  # ... (same metadata)
  -f mp4 \
  output.m4b
```

**Quality Settings (MP3 → M4B):**
- Bitrate: 128kbps AAC (transparent for audiobooks, 64kbps minimum)
- Sampling rate: Match source (44.1kHz or 48kHz)
- Channels: Preserve mono/stereo

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

## User Experience

### Success Flow

1. Download completes: 25 chapter MP3 files
2. File organization starts
3. System detects chapter pattern
4. Merges files with progress logging:
   - "Detected 25 chapter files, merging into single M4B..."
   - "Processing chapter 1/25..."
   - "Merge complete: BookTitle.m4b (15.2 GB, 25 chapters)"
5. Copies merged M4B to target directory
6. Deletes temp files and originals (if configured)
7. Plex scans single M4B with full chapter navigation

### Fallback Flow

**If merge fails:**
1. Log error: "Chapter merge failed: [reason]"
2. Fall back to current behavior: copy individual files
3. Mark request as "available" (not failed)
4. User can manually merge later

**Failure scenarios:**
- FFmpeg crash/timeout
- Insufficient disk space for temp file
- Corrupted source files
- Unsupported audio codec

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
async function detectChapterFiles(files: string[]): Promise<boolean>;
async function sortChapterFiles(files: string[]): Promise<ChapterFile[]>;
async function getAudioDuration(filePath: string): Promise<number>;
async function generateChapterMetadata(chapters: ChapterFile[]): Promise<string>;
async function mergeChapters(chapters: ChapterFile[], options: MergeOptions): Promise<MergeResult>;
```

### Integration Points

**File: `src/lib/utils/file-organizer.ts`**

**Modify `organize()` method:**
```typescript
// After finding audiobook files (line ~73)
if (audioFiles.length > 1) {
  const config = await prisma.configuration.findUnique({
    where: { key: 'chapter_merging_enabled' }
  });

  const mergingEnabled = config?.value === 'true';
  const isChapterDownload = await detectChapterFiles(audioFiles);

  if (mergingEnabled && isChapterDownload) {
    // Merge chapters instead of copying individually
    const mergeResult = await mergeChapters(audioFiles, {
      title: audiobook.title,
      author: audiobook.author,
      narrator: audiobook.narrator,
      year: audiobook.year,
      outputPath: path.join(targetPath, `${audiobook.title}.m4b`)
    });

    if (mergeResult.success) {
      result.audioFiles = [mergeResult.outputPath];
      result.filesMovedCount = 1;
      // Skip individual file copying
    } else {
      // Fallback to individual file copying
      await logger?.warn(`Chapter merge failed, copying files individually`);
      // Continue with existing logic
    }
  }
}
```

### Database Schema

**No changes required** - uses existing `Configuration` table

### Dependencies

**Already available:**
- ffmpeg (installed in Docker images)
- ffprobe (for duration detection)

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

### Functional
- ✅ Successful merge rate > 95% (for valid chapter downloads)
- ✅ Chapter navigation works in Plex
- ✅ Zero audio quality degradation (M4A copy mode)
- ✅ Fallback works 100% of time on merge failure

### Performance
- ✅ M4A merge: < 2 minutes for 25 chapters
- ✅ MP3 conversion: < 15 minutes for 10-hour audiobook
- ✅ No impact on concurrent downloads

### User Experience
- ✅ Feature opt-in (default disabled)
- ✅ Clear logging of merge progress
- ✅ Single file in Plex instead of dozens
- ✅ Proper chapter markers in audiobook players

## Implementation Phases

### Phase 1: Core Functionality (MVP)
- [ ] Implement `chapter-merger.ts` utility
- [ ] Detection logic (chapter file patterns)
- [ ] Natural sorting algorithm
- [ ] Duration extraction (ffprobe)
- [ ] Chapter metadata generation (FFMETADATA1)
- [ ] M4A/M4B merge (codec copy mode)
- [ ] Integration with file-organizer.ts
- [ ] Configuration keys in database

### Phase 2: MP3 Support
- [ ] MP3 → M4B conversion logic
- [ ] Quality preservation settings
- [ ] Bitrate configuration UI

### Phase 3: UI & Polish
- [ ] Setup wizard integration
- [ ] Admin settings UI (Paths tab)
- [ ] Progress logging improvements
- [ ] Error messaging UX

### Phase 4: Advanced Features (Future)
- [ ] Custom chapter naming from file metadata
- [ ] Chapter art extraction (if embedded in files)
- [ ] Preview merged file before finalizing
- [ ] Manual chapter editing UI

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
