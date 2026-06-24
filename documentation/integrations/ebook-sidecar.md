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
| `ebook_sidecar_base_url` | `https://annas-archive.gl` | Base URL for mirror |
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

#### Section 4: Ebook Destination
| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `ebook_destination_mode` | `same` | `same, library, custom` | Where the sidecar saves ebooks |
| `ebook_destination_library_id` | `` | ABS library id | Target ABS library (mode=`library`) |
| `ebook_destination_path` | `` | path | Custom base path (mode=`custom`) |

- *`same`* → audiobook folder (`media_dir`, current behavior). *`library`* → an existing ABS book library's folder (second dropdown, ABS mode only). *`custom`* → an explicit path.
- Resolved in `processEbookOrganization` via `resolveEbookDestinationDir()`; falls back to `same` on any misconfiguration. Organizer base dir set via `getFileOrganizer(mediaDirOverride?)`.
- **Custom path reachability check:** `POST /api/admin/settings/ebook/check-path {path}` → `{reachable, message}`. Server-side `fs.stat` + `fs.access(W_OK)` confirms the path exists, is a directory, and is writable **inside the RMAB container**. UI runs it on blur of the custom-path field and on save (non-blocking — save still proceeds); an amber warning renders under the field when `reachable=false`, noting fallback to the default media dir.

#### Section 5: E-Reader Delivery (ABS only)
| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `ebook_ereader_auto_send_enabled` | `false` | `true, false` | Auto-email organized ebooks to requesters' e-reader devices |

Auto-sends a downloaded ebook to the e-reader device(s) of **every user who requested that book** (audiobook and/or ebook), via Audiobookshelf's send-to-device API. Per-user devices are enrolled in **Admin → Users** (multi-select, stored on `User.ereaderDeviceNames`). Requires email + e-reader devices configured in Audiobookshelf. See "E-Reader Delivery" below.

### E-Reader Delivery

**Flow:**
- **Trigger 1 (ebook organized):** `organize-files.processor.ts` queues a `send_to_ereader` job (30s delay, 5 attempts, exp. backoff base 30s) after the ebook is organized + scan triggered. No target users → all requesters.
- **Trigger 2 (late requester):** When a *different* user requests a book whose ebook is already `downloaded`, the fetch-ebook routes queue a `send_to_ereader` job scoped to that user (`targetUserIds=[userId]`, no delay).

**Processor** (`src/lib/processors/send-to-ereader.processor.ts`):
1. Re-checks `ebook_ereader_auto_send_enabled` + ABS backend mode.
2. Resolves recipients: explicit `targetUserIds`, else all non-deleted `Request`s for the `audiobookId` (status ∉ failed/cancelled/denied). Audiobooks dedup by ASIN, so this captures everyone who requested the book.
3. Collects recipients' `User.ereaderDeviceNames`, minus device names already in `Request.ereaderSentDevices` (idempotency / late delivery).
4. Resolves the ABS `libraryItemId`: lookup library by destination mode (`library` → `ebook_destination_library_id`, else `audiobookshelf.library_id`); `same` mode prefers the matched `Audiobook.absItemId`, else title (+author) search. **Not found → throws to retry** (ABS scan still running; happens before any send, so no duplicates).
5. Sends to each remaining device (`POST /api/emails/send-ebook-to-device`). Per-device failures are logged, not thrown (avoids duplicate sends on retry).
6. Appends successfully-sent device names to `Request.ereaderSentDevices`.

**ABS API client** (`src/lib/services/audiobookshelf/api.ts`): `getEreaderDevices()` (reads `GET /api/emails/settings` → `ereaderDevices`), `sendEbookToDevice(libraryItemId, deviceName)`.

**Endpoints:** `GET /api/admin/settings/ebook/ereader-devices` (admin; lists ABS devices for the per-user enrollment UI).

**Known limits:** sent-tracking dedupes by device name (ABS device names are globally unique); item lookup falls back to title/author search (no file-hash equivalent for ebooks).

### Safety-Net: Find Missing Ebooks Job

A scheduled `find_missing_ebooks` job (daily midnight, enabled by default) backstops the auto-grab path for cases where it silently misses books (race conditions, transient indexer failures, requests created before sources were configured, books from Goodreads/Hardcover sync). Per run it scans up to 50 audiobook requests in `downloaded`/`available` status and triggers the existing ebook fetch flow for any audiobook missing a successful ebook companion. **Lifetime auto-retry cap: 5 per audiobook** — after 5 failed auto-attempts the job stops retrying that audiobook (admin Manual "Fetch Ebook" remains available). Counter is tracked in `Request.ebookAutoRetryCount` and is **processor-private**: manual Fetch Ebook routes never read, write, or reset it. Gated by `ebook_auto_grab_enabled` AND at least one source enabled; logs no-op runs honestly. See `documentation/backend/services/scheduler.md` for full details.

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
ereaderSentDevices Json?   @map("ereader_sent_devices") // device names already sent (idempotency)
```

**Indexes:** `type`, `parentRequestId`

**User model addition:** `ereaderDeviceNames Json? @map("ereader_device_names")` — JSON array of enrolled ABS e-reader device names.

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
Search: https://annas-archive.gl/search?ext=epub&lang=en&q="asin:B09TWSRMCB"
  ↓
MD5 Page: https://annas-archive.gl/md5/[md5]
  ↓
Slow Download: https://annas-archive.gl/slow_download/[md5]/0/5
  ↓
File Server: http://[server]/path/to/file.epub
```

### Method 2: Title + Author (fallback)
```
Search: https://annas-archive.gl/search?q=Title+Author&ext=epub&lang=en
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
- `src/lib/processors/organize-files.processor.ts` (ebook branch; Trigger 1 + `resolveEbookDestinationDir()`)
- `src/lib/processors/send-to-ereader.processor.ts` - E-reader delivery

**Services:**
- `src/lib/services/ebook-scraper.ts` - Anna's Archive scraping
- `src/lib/services/job-queue.service.ts` (ebook job types; `send_to_ereader` + `addSendToEreaderJob()`)
- `src/lib/services/audiobookshelf/api.ts` (`getEreaderDevices()`, `sendEbookToDevice()`)

**Utils:**
- `src/lib/utils/file-organizer.ts` (`organizeEbook` method; `getFileOrganizer(mediaDirOverride?)`)
- `src/lib/utils/ranking-algorithm.ts` (`rankEbookTorrents` function)
- `src/lib/utils/indexer-grouping.ts` (supports `'ebook'` type)
- `src/lib/utils/epub-fixer.ts` (Kindle EPUB compatibility fixes)

**API routes:**
- `src/app/api/admin/settings/ebook/ereader-devices/route.ts` - List ABS e-reader devices
- `src/app/api/audiobooks/[asin]/fetch-ebook/route.ts`, `src/app/api/requests/[id]/fetch-ebook/route.ts` (Trigger 2)

**UI:**
- `src/components/requests/RequestCard.tsx` (ebook badge)
- `src/app/admin/settings/tabs/EbookTab/EbookTab.tsx` (Destination + E-Reader Delivery sections)
- `src/app/admin/users/page.tsx` (per-user device enrollment)

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
