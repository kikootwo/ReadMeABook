# File Organization System

**Status:** ✅ Implemented

Copies completed downloads to standardized directory structure for Plex. Originals kept for seeding, cleaned up by scheduled job after requirements met.

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
5. Copy cover art if found, else download from Audible
6. Originals remain until seeding requirements met

## Seeding Support

**Config:** `seeding_time_minutes` (0 = unlimited, never cleanup)

**Cleanup Job:** `cleanup_seeded_torrents` (every 30 mins)
1. Check completed requests with download history
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
