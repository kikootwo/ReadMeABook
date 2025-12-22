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
- `download_client_url` - qBittorrent Web UI URL
- `download_client_username` - qBittorrent username
- `download_client_password` - qBittorrent password
- `download_dir` - Download save path (passed to qBittorrent for all torrents)

Validation: All fields checked before service initialization.

## Category Management

**Category:** `readmeabook` (auto-created for all torrents)

**Save Path Synchronization:**
- Category created/updated on every torrent addition
- Category save path always synced with `download_dir` config
- Handles config changes: if user changes `download_dir`, category updates automatically
- Uses both `createCategory` and `editCategory` APIs for reliability

**Why Both Create and Edit:**
1. Create: Ensures category exists (idempotent, won't fail if exists)
2. Edit: Updates save path to match current config (handles user changing settings)

This prevents issues where category retains old save path after user changes `download_dir` setting.

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

type TorrentState = 'downloading' | 'uploading' | 'stalledDL' |
  'pausedDL' | 'queuedDL' | 'checkingDL' | 'error' | 'missingFiles';
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
**9. Category save path not updating** - When user changes `download_dir` setting, category keeps old path. Fixed by calling both `createCategory` and `editCategory` on every torrent addition to ensure category path matches current config

## Tech Stack

- axios (HTTP + cookie mgmt)
- parse-torrent (bencode + hash extraction)
- form-data (multipart uploads)

## Related

- See [File Organization](./file-organization.md) for seeding support
