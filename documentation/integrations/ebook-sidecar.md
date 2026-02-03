# E-book Support

**Status:** ✅ Implemented | First-class ebook requests with multi-source support (Anna's Archive + Indexer Search)

## Overview
Ebooks are first-class citizens in RMAB, with their own request type, tracking, and UI representation. When an audiobook request completes, an ebook request is automatically created (if a source is enabled). Supports multiple sources: Anna's Archive (direct HTTP) and Indexer Search (via Prowlarr with ebook categories).

## Key Details

### First-Class Ebook Requests
- **Request Type:** `type: 'ebook'` (vs `'audiobook'`)
- **Parent Relationship:** Ebook requests are children of audiobook requests (`parentRequestId`)
- **Terminal State:** `downloaded` (ebooks don't have "available" state like audiobooks)
- **UI Badge:** Orange (#f16f19) ebook badge to distinguish from audiobooks
- **Separate Tracking:** Own progress, status, and error handling

### Source Priority
1. **Anna's Archive** (if enabled) - Direct HTTP downloads
   - Searched first via ASIN, then title + author
   - Uses FlareSolverr if configured (Cloudflare bypass)
2. **Indexer Search** (if enabled, and no Anna's Archive result)
   - Searches Prowlarr with ebook categories (default: 7020)
   - Ranks using unified ranking algorithm with ebook-specific scoring
   - Downloads via qBittorrent (torrents) or SABnzbd (Usenet)
3. **Both disabled** → Ebook downloads disabled entirely

### Flow (Anna's Archive)
1. Audiobook organization completes
2. Ebook request created automatically (if source enabled)
3. `search_ebook` job searches Anna's Archive
4. `start_direct_download` downloads via HTTP
5. `organize_files` copies to audiobook folder
6. Request marked as `downloaded` (terminal)
7. "Available" notification sent

### Flow (Indexer Search)
1. Audiobook organization completes
2. Ebook request created automatically (if source enabled)
3. `search_ebook` job searches indexers (if Anna's Archive failed/disabled)
4. `download_torrent` job adds to qBittorrent/SABnzbd (reuses audiobook processor)
5. `monitor_download` tracks progress
6. `organize_files` copies to audiobook folder
7. Request marked as `downloaded` (terminal)
8. Torrent left to seed (respects seeding limits)

### Configuration

**Admin Settings → E-book Sidecar tab** (3 sections)

#### Section 1: Anna's Archive
| Key | Default | Description |
|-----|---------|-------------|
| `ebook_annas_archive_enabled` | `false` | Enable Anna's Archive downloads |
| `ebook_sidecar_base_url` | `https://annas-archive.li` | Base URL for mirror |
| `ebook_sidecar_flaresolverr_url` | `` (empty) | FlareSolverr proxy URL (optional) |

#### Section 2: Indexer Search
| Key | Default | Description |
|-----|---------|-------------|
| `ebook_indexer_search_enabled` | `false` | Enable Indexer Search via Prowlarr |

*Note: Ebook categories are configured per-indexer in Settings → Indexers → Edit Indexer → EBook tab*

#### Section 3: General Settings
| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `ebook_sidecar_preferred_format` | `epub` | `epub, pdf, mobi, azw3, any` | Preferred format |
| `ebook_auto_grab_enabled` | `true` | `true, false` | Auto-create ebook requests after audiobook downloads |
| `ebook_kindle_fix_enabled` | `false` | `true, false` | Apply Kindle compatibility fixes to EPUB files |

*Notes:*
- *Auto-grab is automatically disabled if no ebook sources are enabled. Manual fetch via admin buttons still works.*
- *Kindle fix toggle only visible when preferred format is EPUB.*

### Kindle EPUB Fix

**Purpose:** Apply compatibility fixes to EPUB files before organizing, ensuring successful Kindle import.

**Fixes Applied:**
1. **Encoding declaration** - Adds UTF-8 XML declaration to files missing it
2. **Body ID link fix** - Removes `#body`/`#bodymatter` fragments from hyperlinks that break on Kindle
3. **Language validation** - Ensures `dc:language` uses Amazon KDP-approved codes (defaults to `en` if invalid)
4. **Stray IMG removal** - Removes `<img>` tags without `src` attributes

**How It Works:**
- Enabled via toggle in E-book Sidecar settings (only visible when EPUB format selected)
- Applied during `organize_files` job, before copying to final location
- Creates temp fixed file → organizes temp file → cleans up temp file
- Original download file stays intact (important for seeding torrents)
- Non-blocking: if fix fails, continues with original file

**Source:** Based on [kindle-epub-fix](https://github.com/innocenat/kindle-epub-fix)

## Database Schema

**Request model additions:**
```prisma
type             String    @default("audiobook") // 'audiobook' | 'ebook'
parentRequestId  String?   @map("parent_request_id")
parentRequest    Request?  @relation("EbookParent", fields: [parentRequestId], references: [id])
childRequests    Request[] @relation("EbookParent")
```

**Indexes:** `type`, `parentRequestId`

## Job Processors

### search_ebook
- Searches Anna's Archive first (if enabled), then indexers (if enabled)
- Anna's Archive: Creates download history with `downloadClient: 'direct'`, triggers `start_direct_download`
- Indexer: Triggers `download_torrent` job (reuses audiobook processor)

### start_direct_download
- Downloads file via HTTP with progress tracking
- Tries multiple slow download links on failure
- Triggers `organize_files` on success

### download_torrent (shared with audiobooks)
- Routes to qBittorrent (torrents) or SABnzbd (Usenet)
- Creates download history with indexer metadata
- Triggers `monitor_download` job

## Ranking Algorithm (Indexer Results)

Ebook torrent ranking uses unified algorithm with ebook-specific scoring:

| Component | Points | Description |
|-----------|--------|-------------|
| **Title/Author Match** | 60 pts | Reuses audiobook matching logic (word coverage, author presence) |
| **Format Match** | 10 pts | 10 pts if matches preferred format, 0 otherwise |
| **Size Quality** | 15 pts | Inverted: < 5MB = 15pts, 5-15MB = 10pts, 15-20MB = 5pts |
| **Seeder Count** | 15 pts | Logarithmic scaling (same as audiobooks) |

**Filtering:**
- Files > 20 MB are filtered out (too large for ebooks)
- Dual threshold: base score >= 50 AND final score >= 50

**Bonus System:** Same as audiobooks (indexer priority, flag bonuses)

## Delete Behavior

**Ebook deletion is different from audiobook deletion:**
- Only deletes ebook files (`.epub`, `.pdf`, `.mobi`, etc.)
- Does NOT delete the title folder (audiobook files remain)
- Does NOT delete from backend library (Plex/ABS)
- Does NOT clear audiobook availability linkage
- Soft-deletes the ebook request record
- Torrents left to seed (respects seeding limits)

## UI Representation

### RequestCard
- Orange ebook badge displayed next to status badge
- Orange book icon for placeholder cover art
- Interactive search disabled (Anna's Archive only)

### Status Flow
```
pending → searching → downloading → processing → downloaded (terminal)
                 ↘ awaiting_search (retry) ↗
```

## FlareSolverr Integration

Anna's Archive uses Cloudflare protection. FlareSolverr bypasses this using a headless browser.

### Setup
```bash
docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
```

Configure URL in Admin Settings → E-book Sidecar: `http://localhost:8191`

### Performance
- First request: ~5-10 seconds
- Subsequent: ~2-5 seconds per page
- Total: ~15-30 seconds per ebook

## Scraping Strategy (Anna's Archive)

### Method 1: ASIN Search (exact match)
```
Search: https://annas-archive.li/search?ext=epub&lang=en&q="asin:B09TWSRMCB"
  ↓
MD5 Page: https://annas-archive.li/md5/[md5]
  ↓
Slow Download: https://annas-archive.li/slow_download/[md5]/0/5
  ↓
File Server: http://[server]/path/to/file.epub
```

### Method 2: Title + Author (fallback)
```
Search: https://annas-archive.li/search?q=Title+Author&ext=epub&lang=en
  ↓ (Same flow from MD5 page)
```

## File Naming

**Pattern:** `[Title] - [Author].[format]`

**Sanitization:**
- Remove: `<>:"/\|?*`
- Collapse spaces, trim, limit to 200 chars

## Error Handling

**Non-blocking errors:**
- No search results → Request goes to `awaiting_search` for retry
- All downloads fail → Same retry behavior
- Audiobook organization never affected

## Technical Files

**Processors:**
- `src/lib/processors/search-ebook.processor.ts` - Multi-source search
- `src/lib/processors/direct-download.processor.ts` - Anna's Archive downloads
- `src/lib/processors/download-torrent.processor.ts` - Indexer downloads (shared)
- `src/lib/processors/organize-files.processor.ts` (ebook branch)

**Services:**
- `src/lib/services/ebook-scraper.ts` - Anna's Archive scraping
- `src/lib/services/job-queue.service.ts` (ebook job types)

**Utils:**
- `src/lib/utils/file-organizer.ts` (`organizeEbook` method)
- `src/lib/utils/ranking-algorithm.ts` (`rankEbookTorrents` function)
- `src/lib/utils/indexer-grouping.ts` (supports `'ebook'` type)
- `src/lib/utils/epub-fixer.ts` (Kindle EPUB compatibility fixes)

**UI:**
- `src/components/requests/RequestCard.tsx` (ebook badge)

**Delete:**
- `src/lib/services/request-delete.service.ts` (ebook-specific logic)

## Format Support

| Format | Extension | Recommended |
|--------|-----------|-------------|
| EPUB | `.epub` | Yes |
| PDF | `.pdf` | Sometimes |
| MOBI | `.mobi` | Legacy |
| AZW3 | `.azw3` | Sometimes |

## Indexer Categories

Indexer configuration supports separate category arrays for audiobooks and ebooks:
- **Audiobook Categories:** Default `[3030]` (Audio/Audiobook)
- **Ebook Categories:** Default `[7020]` (Books/EBook)

Categories are configured per-indexer via the tabbed interface in the Edit Indexer modal.

## Limitations

1. Title search may return wrong book for common titles
2. Download speed depends on file server load (Anna's Archive)
3. English books only (title search filter for Anna's Archive)
4. Format detection from torrent titles may be imprecise

## Related
- [File Organization](../phase3/file-organization.md) - Ebook organization
- [Settings Pages](../settings-pages.md) - Configuration UI
- [Ranking Algorithm](../phase3/ranking-algorithm.md) - Ebook ranking
- [Request Deletion](../admin-features/request-deletion.md) - Delete behavior
- [Prowlarr Integration](../phase3/prowlarr.md) - Indexer search
