# qBittorrent Integration

**Status:** ✅ Implemented

Free, open-source BitTorrent client with comprehensive Web API.

## Enterprise Torrent Addition

**Challenge:** `/api/v2/torrents/add` returns only "Ok." without torrent hash.

**Solution (Professional):**

**Magnet Links:**
1. Extract `info_hash` from magnet URI (deterministic)
2. Upload via `urls` parameter
3. Return extracted hash immediately

**Torrent Files:**
1. Download .torrent file to memory
2. Parse with `parse-torrent` (bencode decoder)
3. Extract `info_hash` (SHA-1 of info dict)
4. Upload file content via `torrents` parameter (multipart/form-data)
5. Return extracted hash immediately

**Benefits:** Deterministic, no race conditions, works with Docker networking, handles expired URLs

## API Endpoints

**Base:** `http://qbittorrent:8080/api/v2`
**Auth:** Cookie-based (login required)

**POST /auth/login** - Get session cookie
**POST /torrents/add** - Add torrent (supports `urls` and `torrents` params, `savepath` override)
**GET /torrents/info?hashes={hash}** - Get status/progress
**POST /torrents/pause** - Pause torrent
**POST /torrents/resume** - Resume
**POST /torrents/delete** - Delete torrent
**GET /torrents/files** - Get file list
**POST /torrents/createCategory** - Create category with save path
**POST /torrents/editCategory** - Update category save path
**POST /torrents/setCategory** - Set category for torrent

## Config

**Required (database only, no env fallbacks):**
- `download_client_url` - qBittorrent Web UI URL (supports HTTP and HTTPS)
- `download_client_username` - qBittorrent username
- `download_client_password` - qBittorrent password
- `download_dir` - Base download save path (joined with per-client `customPath` if configured)

**Optional (SSL/TLS):**
- `download_client_disable_ssl_verify` - Disable SSL certificate verification for HTTPS (boolean as string "true"/"false", default: "false")
  - Use when connecting to qBittorrent with self-signed certificates
  - ⚠️ Security warning: Only use on trusted private networks
  - Enhanced error messages guide users when SSL issues detected

**Optional (Remote Path Mapping):**
- `download_client_remote_path_mapping_enabled` - Enable path mapping (boolean as string "true"/"false")
- `download_client_remote_path` - Remote path prefix from qBittorrent
- `download_client_local_path` - Local path prefix for ReadMeABook

Validation: All required fields checked before service initialization. Path mapping fields validated when enabled.

**Singleton Invalidation:**
Service uses singleton pattern for performance. When settings change (via admin settings page), singleton is invalidated to force reload:
- `invalidateQBittorrentService()` called after updating paths or download client settings
- Forces service to re-read database config on next torrent addition
- Ensures category save path, credentials, and `customPath` resolution are always current
- Singleton getter resolves `customPath` from client config (consistent with manager's `createService()`)

## Category Management

**Category:** `readmeabook` (auto-created for all torrents)

**Save Path Synchronization:**
- Category created/updated on every torrent addition
- Category save path synced with resolved download path (`download_dir` + per-client `customPath`)
- Handles config changes: if user changes `download_dir` or `customPath`, category updates automatically
- Uses both `createCategory` and `editCategory` APIs for reliability
- Remote path mapping applied after `customPath` resolution (outgoing: local → remote)

**Why Both Create and Edit:**
1. Create: Ensures category exists (idempotent, won't fail if exists)
2. Edit: Updates save path to match current config (handles user changing settings)

This prevents issues where category retains old save path after user changes `download_dir` setting.

**Per-Client Custom Path:**
- If `customPath` is set (e.g., `torrents`), category save path becomes `/downloads/torrents`
- Remote path mapping applies to the resolved path: `reverseTransform(/downloads/torrents)` → remote equivalent
- See [download-clients.md](./download-clients.md#per-client-custom-download-path) for details

## Remote Path Mapping

**Use Case:** qBittorrent runs on different machine/container with different filesystem perspective.

**Example Scenario:**
- qBittorrent on Windows expects: `F:\Docker\downloads\completed\books`
- ReadMeABook inside Docker sees: `/downloads`
- Mapping: Remote `F:\Docker\downloads\completed\books` ↔ Local `/downloads`

**Configuration:**
1. Admin Settings → Download Client → Enable Remote Path Mapping
2. Enter remote path (as qBittorrent sees it, e.g., `F:\Docker\downloads\completed\books`)
3. Enter local path (as RMAB sees it, e.g., `/downloads`)
4. Test connection validates local path exists
5. Save settings

**Bidirectional Path Mapping:**

**1. Outgoing (RMAB → qBittorrent):** When adding torrents
- RMAB's download path: `/downloads`
- Translated to qBit's path: `F:\Docker\downloads\completed\books`
- Applied in `qbittorrent.service.ts` via `PathMapper.reverseTransform()`
- Ensures qBittorrent knows where to save files

**2. Incoming (qBittorrent → RMAB):** When processing completed downloads
- qBit reports: `F:\Docker\downloads\completed\books\Audiobook.Name`
- Translated to RMAB's path: `/downloads/Audiobook.Name`
- Applied in `monitor-download.processor.ts` via `PathMapper.transform()`
- Applied in `retry-failed-imports.processor.ts` for failed imports
- Ensures RMAB can find and organize files

**Implementation:**
- `PathMapper` utility (`src/lib/utils/path-mapper.ts`) handles transformation
- `transform()`: Remote → Local (qBit → RMAB)
- `reverseTransform()`: Local → Remote (RMAB → qBit)
- Uses simple prefix replacement with path normalization
- Preserves Windows backslashes when translating to Windows paths
- Graceful fallback: if path doesn't match prefix, returns unchanged

**Path Transformation Examples:**

```typescript
// Outgoing: RMAB → qBittorrent (when adding torrent)
localPath = "/downloads"
config = { remotePath: "F:\\Docker\\downloads\\completed\\books", localPath: "/downloads" }
remotePath = PathMapper.reverseTransform(localPath, config)
// Result: "F:\Docker\downloads\completed\books"

// Incoming: qBittorrent → RMAB (when processing completion)
qbPath = "F:\\Docker\\downloads\\completed\\books\\Audiobook.Name"
config = { remotePath: "F:\\Docker\\downloads\\completed\\books", localPath: "/downloads" }
organizePath = PathMapper.transform(qbPath, config)
// Result: "/downloads/Audiobook.Name"
```

**Validation:**
- Local path accessibility checked during test connection
- Prevents misconfiguration before save
- Warning shown for existing downloads (mapping only affects new downloads)

**Behavior:**
- Mapping only applies when enabled
- If path doesn't start with expected prefix, returns original (logs warning)
- Path normalization handles trailing slashes, backslashes, redundant separators
- Works with both `content_path` and constructed `save_path + name`
- Preserves native path separators (important for Windows)

## Data Models

```typescript
interface TorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number; // 0.0-1.0
  dlspeed: number; // bytes/s
  upspeed: number;
  eta: number; // seconds
  state: TorrentState;
  category: string;
  savePath: string;
  completionDate: number;
}

type TorrentState =
  // Core states (*DL = download phase, *UP = upload/post-download phase)
  | 'downloading' | 'uploading'
  | 'stalledDL' | 'stalledUP'        // stalledUP → completed (download done)
  | 'pausedDL' | 'pausedUP'          // pausedUP → completed (download done, paused seeding)
  | 'queuedDL' | 'queuedUP'          // queuedUP → completed (download done)
  | 'checkingDL' | 'checkingUP'      // checkingUP → completed (download done, rechecking)
  | 'error' | 'missingFiles' | 'allocating'
  // Forced states (user clicked "Force Resume")
  | 'forcedDL' | 'forcedUP'          // forcedUP → completed (download done)
  // Metadata fetching
  | 'metaDL' | 'forcedMetaDL'
  // qBittorrent v5.0+ (renamed paused → stopped)
  | 'stoppedDL' | 'stoppedUP'        // stoppedUP → completed (download done)
  // Other
  | 'checkingResumeData' | 'moving';
```

## Fixed Issues ✅

**1. Naive torrent identification** - Fixed with deterministic hash extraction
**2. Docker networking issues** - Fixed by downloading .torrent ourselves
**3. Duplicate detection** - Check if hash exists before adding
**4. Config fallbacks to env** - Removed, database only
**5. Unclear error messages** - List missing fields explicitly
**6. Race condition on torrent availability** - Fixed with 3s initial delay + exponential backoff retry (500ms, 1s, 2s)
**7. Error logging during duplicate check** - Removed console.error in getTorrent() during expected "not found" cases (duplicate checking)
**8. Prowlarr magnet link redirects** - Some indexers return HTTP URLs that redirect to magnet: links. Fixed by intercepting 3xx redirects before axios follows them, extracting the Location header, and routing to magnet flow if target is a magnet: link
**9. Category save path not updating** - When user changes `download_dir` setting, category keeps old path. Fixed by:
   - Checking existing categories before create/edit (avoid unnecessary 409 errors)
   - Invalidating service singleton when settings change (forces config reload)
   - Settings API calls `invalidateQBittorrentService()` after updating paths or credentials
**10. Remote seedbox path mismatch** - qBittorrent on remote machine reports different filesystem paths. Fixed by:
   - Remote path mapping feature with toggle in admin settings and setup wizard
   - PathMapper utility for prefix replacement transformation
   - Local path validation during test connection
   - Applied in download completion and import retry processors
**11. HTTPS SSL certificate errors** - Users with seedboxes using self-signed certificates or Let's Encrypt couldn't connect. Fixed by:
   - Optional SSL verification disable toggle in setup wizard and admin settings
   - Custom HTTPS agent with `rejectUnauthorized: false` when enabled
   - Enhanced error messages identifying SSL/TLS certificate issues with actionable guidance
   - Secure by default (SSL verification enabled), with clear security warnings when disabled
   - URL format: `https://qbt.domain.com:443/qbittorrent` fully supported
**12. CSRF protection HTTP 401 errors** - qBittorrent v4.1.0+ has CSRF protection enabled by default, causing authentication failures (HTTP 401) when Referer/Origin headers missing. Browsers work because they auto-send these headers. Fixed by:
   - Adding `Referer` and `Origin` headers to all login requests
   - Headers set to qBittorrent base URL (e.g., `https://seedbox.example.com:443/qbittorrent`)
   - Applied to both `login()` and `testConnectionWithCredentials()` methods
   - Works with all qBittorrent versions and configurations
   - Enhanced debug logging for troubleshooting authentication issues (enable with `LOG_LEVEL=debug`)
**13. Nginx/Apache reverse proxy HTTP Basic Auth** - Many seedboxes use nginx or Apache reverse proxy with HTTP Basic Authentication in front of qBittorrent. This causes HTTP 401 errors with `www-authenticate: Basic` header. Browsers handle this by prompting for credentials and sending `Authorization: Basic` header. Fixed by:
   - Adding HTTP Basic Auth to all axios requests using `auth` parameter
   - Same credentials used for both Basic Auth (nginx/Apache) and qBittorrent Web UI authentication
   - Applied to axios client instance and all standalone requests
   - Works transparently with or without reverse proxy
   - Compatible with popular seedbox providers (seedit4.me, etc.)
**14. Remote path mapping not applied when adding torrents** - When qBittorrent runs locally (e.g., Windows) and RMAB runs in Docker, savepath sent to qBittorrent was not translated. qBittorrent received `/downloads` (RMAB's path) but expected `F:\Docker\downloads\completed\books` (Windows path), causing "Invalid path" errors. Fixed by:
   - Added `PathMapper.reverseTransform()` for bidirectional path mapping (local → remote)
   - Applied in `qbittorrent.service.ts` when setting savepath for torrents
   - Preserves Windows backslashes when translating to Windows paths
   - Path mapping now works in both directions: outgoing (RMAB → qBit) and incoming (qBit → RMAB)
   - Service constructor accepts `PathMappingConfig` parameter
   - Singleton loads path mapping config from database

**15. Missing qBittorrent torrent states** - Monitor never detected completion for force-resumed torrents (`forcedDL`/`forcedUP`), causing infinite polling at 100%. Also missing metadata states (`metaDL`/`forcedMetaDL`), qBittorrent v5.x renamed states (`stoppedDL`/`stoppedUP`), and utility states (`checkingResumeData`/`moving`). Fixed by:
   - Adding all 8 missing states to `TorrentState` type union
   - Adding mappings to both `mapState()` (legacy) and `mapStateToDownloadStatus()` (unified interface)
   - `forcedUP` → `seeding`/`completed` enables monitor to trigger import
   - `stoppedDL` → `paused` ensures qBittorrent v5.x compatibility

**16. pausedUP/stoppedUP mapped as paused instead of completed** - qBittorrent (after ratio limits) transitions directly to `pausedUP`/`stoppedUP` without passing through `uploading`/`stalledUP`. The `*UP` suffix means the download phase is complete and the torrent is on the upload side. Both states were incorrectly mapped to `'paused'`, causing the monitor to re-schedule checks indefinitely instead of triggering file organization. Fixed by:
   - `pausedUP` → `seeding` (unified) / `completed` (legacy) — triggers completion in monitor
   - `stoppedUP` → `seeding` (unified) / `completed` (legacy) — same fix for qBittorrent v5.x
   - `pausedDL`/`stoppedDL` remain `paused` — download phase genuinely paused
- Key insight: any `*UP` state is post-download; any `*DL` state is pre-completion

**17. Prowlarr grab errors blamed on qBittorrent** - Source HTTP errors were collapsed into `Failed to add torrent to qBittorrent`, so a rate-limited indexer permanently failed the request. Fixed by:
- Forwarding Prowlarr source headers when fetching `.torrent` files
- Preserving the upstream HTTP status as a structured source-grab error
- Trying the remaining ranked releases on HTTP `429`/`5xx`
- Reporting the indexer, release, and upstream status instead of blaming a healthy qBittorrent instance

## Tech Stack

- axios (HTTP + cookie mgmt)
- parse-torrent (bencode + hash extraction)
- form-data (multipart uploads)

## Related

- See [File Organization](./file-organization.md) for seeding support
