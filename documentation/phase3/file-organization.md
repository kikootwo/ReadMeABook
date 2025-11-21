# File Organization System

**Status:** ✅ Implemented

Copies completed downloads to standardized directory structure for Plex. Automatically tags audio files with correct metadata. Originals kept for seeding, cleaned up by scheduled job after requirements met.

## Target Structure

```
/media/audiobooks/
└── Author Name/
    └── Book Title (Year)/
        ├── Book Title.m4b
        └── cover.jpg
```

## Process

1. Download completes in `/downloads/[torrent-name]/` or `/downloads/[filename]` (single file)
2. Identify audiobook files (.m4b, .m4a, .mp3) - supports both directories and single files
3. Create `/media/audiobooks/[Author]/[Title]/`
4. **Copy** files (not move - originals stay for seeding)
5. **Tag metadata** (if enabled) - writes correct title, author, narrator to audio files
6. Copy cover art if found, else download from Audible
7. Originals remain until seeding requirements met

## Metadata Tagging

**Status:** ✅ Implemented

**Purpose:** Automatically writes correct metadata to audio files during file organization to improve Plex matching accuracy.

**Supported Formats:**
- m4b, m4a, mp4 (AAC audiobooks)
- mp3 (ID3v2 tags)

**Metadata Written:**
- `title` - Book title
- `album` - Book title (PRIMARY field for Plex matching)
- `album_artist` - Author (PRIMARY field for Plex matching)
- `artist` - Author (fallback)
- `composer` - Narrator (standard audiobook field)
- `date` - Year

**Configuration:**
- Key: `metadata_tagging_enabled` (Configuration table)
- Default: `true`
- Configurable in: Setup wizard (Paths step), Admin settings (Paths tab)

**Implementation:**
- Uses ffmpeg with `-codec copy` (no re-encoding, metadata only)
- Fast (no audio transcoding)
- Lossless (original audio preserved)
- Runs after file copy, before cover art download
- Non-blocking (errors don't fail file organization)
- Logs success/failure per file

**Benefits:**
- Fixes torrents with missing/incorrect metadata
- Ensures Plex can match audiobooks correctly
- Writes metadata from Audible/Audnexus (known accurate)
- Prevents "[Various Albums]" and other metadata issues

**Tech Stack:**
- ffmpeg (system dependency - included in Docker image)
- `src/lib/utils/metadata-tagger.ts` - Tagging utility
- Integrated into `src/lib/utils/file-organizer.ts`

**Requirements:**
- ffmpeg must be installed in the container
- **Multi-container setup** (`Dockerfile`): Added at line 56 via `apk add ffmpeg`
- **Unified setup** (`dockerfile.unified`): Added at line 16 via `apt-get install ffmpeg`
- **Verify installation:**
  - Multi-container: `docker exec readmeabook ffmpeg -version`
  - Unified: `docker exec readmeabook-unified ffmpeg -version`

## Seeding Support

**Config:** `seeding_time_minutes` (0 = unlimited, never cleanup)

**Cleanup Job:** `cleanup_seeded_torrents` (every 30 mins)
1. Check 'available' and 'downloaded' status requests with download history
2. Query qBittorrent for actual `seeding_time` field
3. Delete torrent + files only after requirement met
4. Respects config (0 = never cleanup)

## Interface

```typescript
interface OrganizationResult {
  success: boolean;
  targetPath: string;
  filesMovedCount: number;
  errors: string[];
  audioFiles: string[];
  coverArtFile?: string;
}

async function organize(
  downloadPath: string,
  audiobook: {title: string, author: string, year?: number, coverArtUrl?: string}
): Promise<OrganizationResult>;
```

## Path Sanitization

- Remove invalid chars: `<>:"/\|?*`
- Trim dots/spaces
- Collapse multiple spaces
- Limit to 200 chars
- Example: `Author: The <Best>! Book?` → `Author The Best! Book`

## Fixed Issues ✅

**1. EPERM errors** - Fixed with `fs.readFile/writeFile` instead of `copyFile`
**2. Immediate deletion** - Changed to copy-only, scheduled cleanup after seeding
**3. Files moved not copied** - Now copies to support seeding
**4. Single file downloads** - Now supports files directly in downloads folder (not just directories)

## Tech Stack

- Node.js `fs/promises`
- `path` module
- axios (cover art download)
