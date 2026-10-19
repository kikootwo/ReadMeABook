# SABnzbd Integration

**Status:** ✅ Implemented

Free, open-source Usenet/NZB download client with comprehensive Web API. Industry standard for automation workflows.

## Key Features

- **Protocol:** Usenet/NZB downloads (not torrents)
- **Post-Processing:** Automatic par2 repair, rar/zip extraction, cleanup
- **Category Support:** Per-category download paths
- **API:** RESTful JSON API with API key authentication
- **Status:** No hash extraction needed (NZB ID returned immediately)

## API Endpoints

**Base:** `http://sabnzbd:8080/api`
**Auth:** API key parameter (`apikey={key}`)
**Format:** All requests use `output=json` for JSON responses

**GET /api?mode=version&output=json&apikey={key}** - Get SABnzbd version
**POST /api (multipart: mode=addfile, nzbfile={binary})** - Add NZB by file upload (RMAB downloads NZB from Prowlarr, uploads to SABnzbd)
**GET /api?mode=queue&output=json&apikey={key}** - Get active downloads
**GET /api?mode=history&limit=100&output=json&apikey={key}** - Get completed/failed downloads
**GET /api?mode=pause&value={nzbId}&output=json&apikey={key}** - Pause download
**GET /api?mode=resume&value={nzbId}&output=json&apikey={key}** - Resume download
**GET /api?mode=queue&name=delete&value={nzbId}&del_files={0|1}&output=json&apikey={key}** - Delete download from queue
**GET /api?mode=history&name=delete&value={nzbId}&del_files={0|1}&archive={0|1}&output=json&apikey={key}** - Delete/archive download from history
  - `archive=1` (default): Move to hidden archive (preserves for troubleshooting)
  - `archive=0`: Permanently delete from history
**GET /api?mode=get_config&output=json&apikey={key}** - Get configuration (categories)
**GET /api?mode=set_config&section=categories&keyword={cat}&value={path}&output=json&apikey={key}** - Create/update category

## Config

**Required (database only, no env fallbacks):**
- `download_client_type` - Must be 'sabnzbd'
- `download_client_url` - SABnzbd Web UI URL (supports HTTP and HTTPS)
- `download_client_password` - API key (reuses password field)
- `download_dir` - Base download save path (joined with per-client `customPath` if configured)

**Optional (SSL/TLS):**
- `download_client_disable_ssl_verify` - Disable SSL certificate verification (boolean as string "true"/"false", default: "false")
  - Use when connecting to SABnzbd with self-signed certificates
  - ⚠️ Security warning: Only use on trusted private networks

**Optional (Remote Path Mapping):**
- `download_client_remote_path_mapping_enabled` - Enable path mapping (boolean)
- `download_client_remote_path` - Remote path prefix from SABnzbd
- `download_client_local_path` - Local path prefix for ReadMeABook

**Optional (SABnzbd-specific):**
- `sabnzbd_category` - Category name (default: 'readmeabook')

Validation: All required fields checked before service initialization. Path mapping fields validated when enabled.

**Singleton Invalidation:**
Service uses singleton pattern. When settings change, singleton invalidated to force reload:
- `invalidateSABnzbdService()` called after updating settings
- Forces service to re-read database config
- Ensures category, credentials, and `customPath` resolution are always current
- Singleton getter resolves `customPath` from client config (consistent with manager's `createService()`)

## Category Management

**Category:** `readmeabook` (auto-created for all downloads)

**Save Path Synchronization:**
- Category created/updated on every download (matches qBittorrent behavior)
- Fetches SABnzbd's `complete_dir` setting via API to understand download location
- Applies remote path mapping to translate RMAB's resolved download path to SABnzbd's perspective
- Calculates optimal category path (relative, absolute, or root)
- Resolved path includes per-client `customPath` if configured (e.g., `/downloads/usenet`)

**Smart Path Calculation:**
1. Get SABnzbd's `complete_dir` from `misc.complete_dir` config
2. Apply `PathMapper.reverseTransform()` to RMAB's resolved download path (`download_dir` + `customPath`)
3. Compare transformed path to `complete_dir`:
   - **Match:** Use empty string (downloads go to complete_dir root)
   - **Subdirectory:** Use relative path (e.g., `usenet`)
   - **Different:** Use absolute path (e.g., `/mnt/media/usenet`)

**Per-Client Custom Path:**
- If `customPath` is set (e.g., `usenet`), category path calculated from `/downloads/usenet`
- See [download-clients.md](./download-clients.md#per-client-custom-download-path) for details

## Post-Processing

**Automatic (Built-in SABnzbd Features):**
- **Par2 Repair:** Verifies and repairs damaged downloads
- **Archive Extraction:** Extracts .rar, .zip, .7z archives automatically
- **Cleanup:** Deletes .par2, .nfo, .nzb files after extraction
- **Result:** `downloadPath` points to extracted directory (ready for file organizer)

**Configuration:** Post-processing level set to `pp=3` (Repair + Unpack + Delete) on all downloads

## Data Models

```typescript
interface NZBInfo {
  nzbId: string; // SABnzbd NZB ID
  name: string;
  size: number; // bytes
  progress: number; // 0.0-1.0
  status: NZBStatus;
  downloadSpeed: number; // bytes/s
  timeLeft: number; // seconds
  category: string;
  downloadPath?: string; // Available after completion
  completedAt?: Date;
  errorMessage?: string;
}

type NZBStatus = 'downloading' | 'queued' | 'paused' | 'extracting' | 'completed' | 'failed' | 'repairing';

interface QueueItem {
  nzbId: string;
  name: string;
  size: number; // MB
  sizeLeft: number; // MB
  percentage: number; // 0-100
  status: string; // "Downloading", "Paused", "Queued"
  timeLeft: string; // "0:15:30" format
  category: string;
  priority: string;
}

interface HistoryItem {
  nzbId: string;
  name: string;
  category: string;
  status: string; // "Completed", "Failed"
  bytes: string; // Size in bytes (as string)
  failMessage: string;
  storage: string; // Download path
  completedTimestamp: string; // Unix timestamp
  downloadTime: string; // Seconds
}

interface SABnzbdConfig {
  version: string;
  completeDir: string; // SABnzbd's configured complete download folder
  categories: Array<{ name: string; dir: string }>;
}
```

## NZB ID vs Torrent Hash

**Key Difference:** SABnzbd returns NZB ID immediately (no extraction needed)

**qBittorrent:**
- Returns "Ok." without hash
- Requires parsing magnet link or .torrent file
- Hash extraction needed for tracking

**SABnzbd:**
- Returns `nzo_ids` array immediately
- NZB ID format: `SABnzbd_nzo_abc123xyz`
- No extraction needed, can track immediately

**Database Storage:**
- qBittorrent: `torrent_hash` field
- SABnzbd: `nzb_id` field (new)
- Both nullable, exactly one must be set

## Status Tracking

**Queue vs History:**
- **Queue:** Active downloads (downloading, queued, paused)
- **History:** Completed or failed downloads

**Monitoring Flow:**
1. Check queue for NZB ID
2. If found: Parse progress, status, speed
3. If not in queue: Check history
4. If in history: Parse completion status or error

**States:**
- `Downloading` → Active download
- `Queued` → Waiting in queue
- `Paused` → Manually paused
- `Extracting/Unpacking` → Post-processing extraction
- `Repairing/Verifying` → Post-processing par2 repair
- `Completed` → Successfully downloaded and extracted
- `Failed` → Download or post-processing failed

## Remote Path Mapping

**Use Case:** SABnzbd runs on different machine/container with different filesystem perspective.

**Example Scenario:**
- SABnzbd sees: `/mnt/usenet/complete`
- ReadMeABook sees: `/downloads`
- Mapping: Remote `/mnt/usenet/complete` ↔ Local `/downloads`

**Bidirectional Path Mapping:**

**1. Outgoing (RMAB → SABnzbd):** When setting category path
- RMAB's download path: `/downloads`
- Translated to SABnzbd's path: `/mnt/usenet/complete`
- Applied in `sabnzbd.service.ts` via `PathMapper.reverseTransform()`
- Combined with `complete_dir` detection for optimal category configuration

**2. Incoming (SABnzbd → RMAB):** When processing completed downloads
- SABnzbd reports: `/mnt/usenet/complete/Audiobook.Name`
- Translated to RMAB's path: `/downloads/Audiobook.Name`
- Applied in `monitor-download.processor.ts` via `PathMapper.transform()`
- Ensures RMAB can find and organize files

**Path Transformation Examples:**
```typescript
// Outgoing: RMAB → SABnzbd (when setting category)
localPath = "/downloads"
config = { remotePath: "/mnt/usenet/complete", localPath: "/downloads" }
remotePath = PathMapper.reverseTransform(localPath, config)
// Result: "/mnt/usenet/complete"

// Incoming: SABnzbd → RMAB (when processing completion)
sabPath = "/mnt/usenet/complete/Audiobook.Name"
config = { remotePath: "/mnt/usenet/complete", localPath: "/downloads" }
organizePath = PathMapper.transform(sabPath, config)
// Result: "/downloads/Audiobook.Name"
```

**Implementation:** Uses `PathMapper` utility (same as qBittorrent)

## Fixed Issues ✅

**1. API Key Authentication** - Uses `apikey` parameter (not username/password)
**2. Immediate NZB ID** - No hash extraction needed (returned by API)
**3. Post-Processing Tracking** - Monitors extracting/repairing states
**4. Queue vs History Logic** - Checks queue first, falls back to history
**5. SSL Certificate Errors** - Optional SSL verification disable for self-signed certs
**6. Category path not synced with complete_dir** - SABnzbd downloads to its own `complete_dir`, not RMAB's path. Fixed by:
   - Fetching SABnzbd's `complete_dir` from config API (`misc.complete_dir`)
   - Calculating relative or absolute category path based on path comparison
   - Applying remote path mapping before comparison
   - Syncing category path on every download (same as qBittorrent)
**7. Remote path mapping not applied** - Paths weren't translated between RMAB and SABnzbd perspectives. Fixed by:
   - Adding `PathMappingConfig` to SABnzbd service constructor
   - Applying `reverseTransform()` when setting category path (outgoing)
   - Applying `transform()` when processing completed downloads (incoming)
   - Using same `PathMapper` utility as qBittorrent for consistency

## Automatic Cleanup

**Per-Indexer Configuration:**
- Usenet indexers have "Remove After Processing" option (default: enabled)
- When enabled, NZB downloads are automatically cleaned up after files are organized
- Saves disk space by removing completed download files

**Three-Stage Cleanup Process:**
1. **Download Cleanup:** Deletes download directory/files using `fs.rm()`
   - Removes extracted files from category download directory
   - Handles both single files and directories recursively
   - Gracefully handles already-deleted files (ENOENT)

2. **Parent Directory Cleanup:** Removes empty parent directories up to `download_dir`
   - Uses `removeEmptyParentDirectories()` utility from `cleanup-helpers.ts`
   - Walks up directory tree removing empty folders (e.g., empty category folder)
   - Never deletes `download_dir` itself (protected boundary)
   - Stops at first non-empty directory
   - Gracefully handles permission errors and race conditions

3. **SABnzbd Archive:** Archives NZB from history (hides from UI)
   - Uses SABnzbd's archive feature (default: `archive=1`)
   - Preserves job in hidden archive for troubleshooting/auditing
   - Does NOT permanently delete from history
   - Does NOT attempt queue deletion (if still in queue, something went wrong)

**Implementation:**
- Location: `organize-files.processor.ts`
- After file organization completes, checks if indexer has `removeAfterProcessing` enabled
- Filesystem cleanup performed first (critical for disk space)
- SABnzbd archive performed second (UI cleanup)
- Non-blocking: logs warnings but doesn't fail the job if cleanup fails

**Why Archive Instead of Delete:**
- Preserves download history for troubleshooting
- Maintains records for duplicate detection
- Allows reviewing past downloads if issues arise
- Can be viewed in SABnzbd by toggling "Show Archive" in history

## Comparison: SABnzbd vs qBittorrent

| Feature | SABnzbd | qBittorrent |
|---------|---------|-------------|
| Protocol | Usenet/NZB | BitTorrent |
| Auth | API key only | Username + Password |
| ID Format | NZB ID (immediate) | Torrent hash (extracted) |
| Post-Processing | Automatic (par2, extraction) | None (manual) |
| Seeding | N/A (Usenet is not P2P) | Required (tracker) |
| Categories | Path-based (relative to complete_dir) | Path + tag-based |
| File Handling | Auto-extracts archives | Downloads as-is |
| Cleanup | Automatic (optional, per-indexer) | Seeding time based |
| Path Mapping | ✅ Bidirectional (same as qBit) | ✅ Bidirectional |
| Category Sync | ✅ Every download | ✅ Every download |

## NZB Download Proxy

**RMAB proxies NZB files** — SABnzbd does not need network access to Prowlarr.

Prowlarr returns download URLs that point back to itself (proxy URLs like `http://prowlarr:9696/3/download?apikey=...&link=...`).
RMAB downloads the NZB file content from that URL, then uploads it to SABnzbd via `mode=addfile` (multipart POST).
This matches qBittorrent's pattern where RMAB downloads `.torrent` files and uploads the binary content.
Fetch goes through the shared `fetchDownloadSource()` (redirects hop by hop, 30s hard deadline for the whole fetch, Prowlarr key only on Prowlarr download hops) — see [download-clients.md](./download-clients.md#source-fetch--prowlarr-key-scoping).

**Result:** Download clients only need network access to RMAB. No direct Prowlarr connectivity required.

## Tech Stack

- axios (HTTP client, NZB file download)
- form-data (multipart file upload to SABnzbd)
- Node.js https (SSL/TLS agent)
- JSON API responses

## Related

- See [File Organization](./file-organization.md) for post-download processing
- See [qBittorrent Integration](./qbittorrent.md) for torrent alternative
