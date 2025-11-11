# File Organization System

## Current State

**Status:** Not Implemented

The file organization system moves completed downloads into a standardized directory structure that Plex Media Server expects for audiobooks.

## Design Architecture

### Directory Structure

**Target Structure:**
```
/media/audiobooks/
├── Author Name/
│   ├── Book Title (Year)/
│   │   ├── Book Title.m4b
│   │   └── cover.jpg
│   └── Another Book (Year)/
│       └── Another Book.m4b
└── Another Author/
    └── Book/
        └── Book.m4b
```

**Plex Audiobook Requirements:**
- Top level: Author folders
- Second level: Book folders (optionally with year)
- Files: Audiobook file(s) + optional cover art
- Naming: Clean, readable names (no special characters)

### Organization Flow

```
1. Download completes in: /downloads/[torrent-name]/
   └─> Multiple files (M4B, MP3s, NFO, images, etc.)

2. Identify audiobook files:
   └─> Filter by extension (.m4b, .m4a, .mp3)
   └─> Ignore NFO, TXT, JPG (except cover)

3. Determine structure:
   └─> Single M4B: Move directly
   └─> Multiple M4A/MP3: Keep together in subfolder
   └─> Preserve chapters if present

4. Create target directory:
   └─> /media/audiobooks/[Author]/[Title]/

5. Move files:
   └─> Audiobook file(s)
   └─> Cover art (if found)
   └─> Clean up source directory
```

## Implementation Details

### Organizer Interface

```typescript
interface FileOrganizer {
  // Organize completed download
  organize(
    downloadPath: string,
    audiobook: AudiobookMetadata
  ): Promise<OrganizationResult>;

  // Clean up old downloads
  cleanup(path: string): Promise<void>;

  // Validate directory structure
  validate(path: string): Promise<ValidationResult>;
}

interface AudiobookMetadata {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
  coverArtUrl?: string;
}

interface OrganizationResult {
  success: boolean;
  targetPath: string;
  filesMovedCount: number;
  errors: string[];
  audioFiles: string[];
  coverArtFile?: string;
}

interface ValidationResult {
  isValid: boolean;
  issues: string[];
  path: string;
}
```

### File Discovery

```typescript
async findAudiobookFiles(
  downloadPath: string
): Promise<{ audioFiles: string[]; coverFile?: string }> {
  const files = await fs.readdir(downloadPath, { recursive: true });

  // Filter audio files
  const audioExtensions = ['.m4b', '.m4a', '.mp3', '.mp4', '.aa', '.aax'];
  const audioFiles = files.filter(file =>
    audioExtensions.some(ext => file.toLowerCase().endsWith(ext))
  );

  // Find cover art
  const coverPatterns = [
    /cover\.(jpg|jpeg|png)$/i,
    /folder\.(jpg|jpeg|png)$/i,
    /art\.(jpg|jpeg|png)$/i,
  ];

  const coverFile = files.find(file =>
    coverPatterns.some(pattern => pattern.test(file))
  );

  return { audioFiles, coverFile };
}
```

### Path Sanitization

```typescript
function sanitizePath(name: string): string {
  return (
    name
      // Remove invalid filename characters
      .replace(/[<>:"/\\|?*]/g, '')
      // Remove leading/trailing dots and spaces
      .trim()
      .replace(/^\.+/, '')
      .replace(/\.+$/, '')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      // Limit length (255 chars max for most filesystems)
      .slice(0, 200)
  );
}

function buildTargetPath(
  baseDir: string,
  author: string,
  title: string,
  year?: number
): string {
  const authorClean = sanitizePath(author);
  const titleClean = sanitizePath(title);
  const folderName = year ? `${titleClean} (${year})` : titleClean;

  return path.join(baseDir, authorClean, folderName);
}
```

### File Moving Logic

```typescript
async organize(
  downloadPath: string,
  audiobook: AudiobookMetadata
): Promise<OrganizationResult> {
  const result: OrganizationResult = {
    success: false,
    targetPath: '',
    filesMovedCount: 0,
    errors: [],
    audioFiles: [],
  };

  try {
    // Find audiobook files
    const { audioFiles, coverFile } = await this.findAudiobookFiles(downloadPath);

    if (audioFiles.length === 0) {
      throw new Error('No audiobook files found in download');
    }

    // Build target directory
    const targetPath = buildTargetPath(
      this.mediaDir,
      audiobook.author,
      audiobook.title,
      audiobook.year
    );

    // Create target directory
    await fs.mkdir(targetPath, { recursive: true });

    // Move audio files
    for (const audioFile of audioFiles) {
      const sourcePath = path.join(downloadPath, audioFile);
      const filename = path.basename(audioFile);
      const targetFilePath = path.join(targetPath, filename);

      await fs.rename(sourcePath, targetFilePath);
      result.audioFiles.push(targetFilePath);
      result.filesMovedCount++;
    }

    // Move cover art if found
    if (coverFile) {
      const sourcePath = path.join(downloadPath, coverFile);
      const targetCoverPath = path.join(targetPath, 'cover.jpg');
      await fs.rename(sourcePath, targetCoverPath);
      result.coverArtFile = targetCoverPath;
      result.filesMovedCount++;
    } else if (audiobook.coverArtUrl) {
      // Download cover art from Audible if not in torrent
      await this.downloadCoverArt(audiobook.coverArtUrl, targetPath);
      result.coverArtFile = path.join(targetPath, 'cover.jpg');
    }

    result.targetPath = targetPath;
    result.success = true;

    // Clean up download directory
    await this.cleanup(downloadPath);

    return result;
  } catch (error) {
    result.errors.push(error.message);
    return result;
  }
}
```

### Cleanup Logic

```typescript
async cleanup(downloadPath: string): Promise<void> {
  try {
    // Remove download directory and all remaining files
    await fs.rm(downloadPath, { recursive: true, force: true });
    console.log(`Cleaned up: ${downloadPath}`);
  } catch (error) {
    console.error(`Cleanup failed for ${downloadPath}:`, error);
    // Don't throw - cleanup is non-critical
  }
}
```

## Tech Stack

**File Operations:** Node.js fs/promises
**Path Manipulation:** Node.js path module
**Cover Art Download:** axios

## Dependencies

**Node.js Built-ins:**
- fs/promises
- path

**NPM Packages:**
- axios (cover art download)

**Internal:**
- Configuration service (paths)
- Logging service

## Configuration

```typescript
const config = {
  downloadDir: process.env.DOWNLOAD_DIR || '/downloads',
  mediaDir: process.env.MEDIA_DIR || '/media/audiobooks',
  tempDir: process.env.TEMP_DIR || '/tmp/readmeabook',
  cleanupEnabled: true,
  coverArtEnabled: true,
};
```

**Required Configuration Keys:**
- `paths.download_dir`
- `paths.media_dir`
- `paths.temp_dir`

## Usage Examples

### Organize Single M4B File

```typescript
const organizer = new FileOrganizer();

const result = await organizer.organize('/downloads/foundation-torrent/', {
  title: 'Foundation',
  author: 'Isaac Asimov',
  narrator: 'Scott Brick',
  year: 1951,
  coverArtUrl: 'https://audible.com/cover.jpg',
});

if (result.success) {
  console.log(`Organized to: ${result.targetPath}`);
  console.log(`Moved ${result.filesMovedCount} files`);
  console.log('Audio files:', result.audioFiles);
  console.log('Cover art:', result.coverArtFile);
} else {
  console.error('Organization failed:', result.errors);
}
```

### Organize Multi-file Audiobook

```typescript
// For MP3 audiobooks with multiple files
const result = await organizer.organize('/downloads/long-book/', {
  title: 'A Very Long Book',
  author: 'Verbose Author',
});

// Files will be kept together:
// /media/audiobooks/Verbose Author/A Very Long Book/
//   ├── Chapter 01.mp3
//   ├── Chapter 02.mp3
//   ├── ...
//   └── cover.jpg
```

### Validate Organization

```typescript
const validation = await organizer.validate('/media/audiobooks');

if (!validation.isValid) {
  console.error('Directory structure issues:');
  validation.issues.forEach(issue => console.log(`- ${issue}`));
}
```

## Error Handling

**Common Errors:**
- `ENOSPC`: Disk full (can't move files)
- `EACCES`: Permission denied (can't write to media directory)
- `ENOENT`: Source files not found (already moved or deleted?)
- `EEXIST`: Target directory already exists (duplicate audiobook?)

**Recovery Strategy:**
- If move fails: Leave files in download directory, mark request as failed
- If cleanup fails: Log error but don't fail request (files can be manually cleaned)
- If cover art fails: Continue without cover art (not critical)

## Testing Strategy

### Unit Tests
- Test path sanitization with special characters
- Test file discovery with various structures
- Test target path building
- Mock file system operations

### Integration Tests
- Create real test directories and files
- Test complete organization flow
- Verify files are moved correctly
- Test cleanup functionality
- Test error scenarios (permissions, disk space)

### Example Test Cases

```typescript
describe('File Organizer', () => {
  it('should sanitize problematic characters', () => {
    const input = 'Author: The <Best>! Book?';
    const output = sanitizePath(input);
    expect(output).toBe('Author The Best! Book');
  });

  it('should organize single M4B file correctly', async () => {
    const downloadDir = await createTestDownload({
      files: ['Foundation.m4b', 'cover.jpg'],
    });

    const result = await organizer.organize(downloadDir, {
      title: 'Foundation',
      author: 'Isaac Asimov',
    });

    expect(result.success).toBe(true);
    expect(result.audioFiles).toHaveLength(1);
    expect(result.coverArtFile).toBeDefined();

    // Verify target path exists
    const exists = await fs.access(result.targetPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('should preserve multi-file structure', async () => {
    const downloadDir = await createTestDownload({
      files: ['Part1.mp3', 'Part2.mp3', 'Part3.mp3'],
    });

    const result = await organizer.organize(downloadDir, {
      title: 'Multi-Part Book',
      author: 'Test Author',
    });

    expect(result.audioFiles).toHaveLength(3);
    // All files should be in same directory
    const dirs = result.audioFiles.map(f => path.dirname(f));
    expect(new Set(dirs).size).toBe(1);
  });
});
```

## Performance Considerations

**File Operations:**
- Use `fs.rename()` when possible (instant on same filesystem)
- Fall back to `copy + delete` if crossing filesystems
- Process files sequentially to avoid I/O saturation

**Disk Space:**
- Check available space before moving files
- Estimate: audiobook size × 1.5 (for temporary space during move)

**Concurrency:**
- Limit to 1 organization operation at a time
- Queue additional requests if one is in progress

## Known Issues

*This section will be updated during implementation.*

## Future Enhancements

- **Smart deduplication**: Detect if audiobook already exists before moving
- **Metadata tagging**: Update M4B tags with proper title/author/cover
- **Format conversion**: Convert MP3s to M4B automatically
- **Multi-disk handling**: Properly organize audiobooks split across CDs
- **NFO file generation**: Create Plex-compatible NFO files
- **Chapter preservation**: Ensure chapters are maintained when converting
