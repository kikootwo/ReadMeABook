# qBittorrent Integration

## Current State

**Status:** Implemented ✅

qBittorrent is a free, open-source BitTorrent client with a comprehensive Web API. It's the primary download client for ReadMeABook.

**Recent Updates:**
- Removed all environment variable fallbacks - configuration now ONLY from database via admin UI
- Added comprehensive validation with clear error messages listing all missing fields
- Connection test now required to pass before service initialization succeeds
- Improved error messages to guide users to admin settings for configuration

## Design Architecture

### Why qBittorrent?

**Advantages:**
- Comprehensive Web API (REST-like)
- Active development and community support
- Lightweight and performant
- Category and tagging support
- Automatic torrent management
- No licensing costs (open source)

### Torrent Addition Strategy

**The Challenge:**
qBittorrent's `/api/v2/torrents/add` endpoint returns only "Ok." or "Fails." - it doesn't return the torrent hash. This creates a fundamental problem: how do we identify which torrent was just added?

**❌ Naive Approaches (DON'T USE):**
1. **Comparing before/after snapshots** - Race conditions with other services adding torrents simultaneously
2. **Finding "newest" torrent** - Can incorrectly identify torrents from other services
3. **Relying on qBittorrent to download from external URLs** - Fails with Docker networking, VPN issues, or expired URLs

**✅ Enterprise Solution (Professional Approach):**

Our implementation mirrors how professional automation tools (Sonarr, Radarr, Lidarr) handle this:

1. **For magnet links:**
   - Extract info_hash from magnet URI (deterministic)
   - Upload via `urls` parameter
   - Return extracted hash immediately

2. **For .torrent file URLs:**
   - Download .torrent file into our application memory
   - Parse .torrent file using bencode decoder
   - Extract info_hash (SHA-1 of bencoded info dictionary)
   - Upload file content directly via `torrents` parameter (multipart/form-data)
   - Return extracted hash immediately

**Benefits:**
- ✅ **Deterministic** - We KNOW the hash before qBittorrent processes anything
- ✅ **No race conditions** - Not dependent on timing or comparing snapshots
- ✅ **Network isolation** - Works even if qBittorrent can't reach external URLs
- ✅ **Handles expired URLs** - We download and validate before passing to qBittorrent
- ✅ **Professional** - Same approach used by industry-standard automation tools

### API Overview

**Base URL:** `http://qbittorrent:8080/api/v2`
**Authentication:** Cookie-based (login required)

**Endpoints Used:**
- `POST /auth/login` - Authenticate and get cookie
- `POST /torrents/add` - Add new torrent (supports both `urls` and `torrents` parameters)
- `GET /torrents/info` - Get torrent status/progress
- `POST /torrents/pause` - Pause torrent
- `POST /torrents/resume` - Resume torrent
- `POST /torrents/delete` - Delete torrent
- `GET /torrents/files` - Get torrent file list
- `POST /torrents/setCategory` - Set torrent category

## Implementation Details

### Service Interface

```typescript
interface QBittorrentService {
  // Authenticate and establish session
  login(): Promise<void>;

  // Add torrent (magnet link or file URL)
  addTorrent(
    url: string,
    options?: AddTorrentOptions
  ): Promise<string>; // Returns torrent hash

  // Get torrent status and progress
  getTorrent(hash: string): Promise<TorrentInfo>;

  // Get all torrents (optionally filtered by category)
  getTorrents(category?: string): Promise<TorrentInfo[]>;

  // Pause/Resume/Delete operations
  pauseTorrent(hash: string): Promise<void>;
  resumeTorrent(hash: string): Promise<void>;
  deleteTorrent(hash: string, deleteFiles?: boolean): Promise<void>;

  // Get files in torrent
  getFiles(hash: string): Promise<TorrentFile[]>;

  // Set category for organization
  setCategory(hash: string, category: string): Promise<void>;

  // Test connection
  testConnection(): Promise<boolean>;
}

interface AddTorrentOptions {
  savePath?: string;
  category?: string;
  tags?: string[];
  paused?: boolean;
  skipChecking?: boolean;
  sequentialDownload?: boolean;
}

interface TorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number; // 0.0 to 1.0
  dlspeed: number; // Bytes per second
  upspeed: number;
  downloaded: number;
  uploaded: number;
  eta: number; // Seconds remaining
  state: TorrentState;
  category: string;
  tags: string[];
  savePath: string;
  completionDate: number; // Unix timestamp
  addedDate: number;
}

type TorrentState =
  | 'downloading'
  | 'uploading'
  | 'stalledDL'
  | 'stalledUP'
  | 'pausedDL'
  | 'pausedUP'
  | 'queuedDL'
  | 'queuedUP'
  | 'checkingDL'
  | 'checkingUP'
  | 'error'
  | 'missingFiles'
  | 'allocating';

interface TorrentFile {
  name: string;
  size: number;
  progress: number;
  priority: number;
  index: number;
}
```

### Authentication

qBittorrent uses cookie-based authentication:

```typescript
async login(): Promise<void> {
  const response = await axios.post(
    `${this.baseUrl}/auth/login`,
    new URLSearchParams({
      username: this.username,
      password: this.password,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  // Extract cookie from response
  const cookies = response.headers['set-cookie'];
  this.cookie = cookies?.[0]?.split(';')[0];

  if (!this.cookie) {
    throw new Error('Failed to authenticate with qBittorrent');
  }
}
```

### Add Torrent (Enterprise Implementation)

```typescript
async addTorrent(
  url: string,
  options?: AddTorrentOptions
): Promise<string> {
  // Ensure we're authenticated
  if (!this.cookie) await this.login();

  const category = options?.category || 'readmeabook';
  await this.ensureCategory(category);

  // Determine if this is a magnet link or .torrent file URL
  if (url.startsWith('magnet:')) {
    return await this.addMagnetLink(url, category, options);
  } else {
    return await this.addTorrentFile(url, category, options);
  }
}

/**
 * Add magnet link - hash is extractable from URI
 */
private async addMagnetLink(
  magnetUrl: string,
  category: string,
  options?: AddTorrentOptions
): Promise<string> {
  // Extract info_hash from magnet link (deterministic)
  const infoHash = this.extractHashFromMagnet(magnetUrl);

  if (!infoHash) {
    throw new Error('Invalid magnet link - could not extract info_hash');
  }

  console.log(`[qBittorrent] Adding magnet link with hash: ${infoHash}`);

  // Check for duplicates
  const existing = await this.getTorrent(infoHash).catch(() => null);
  if (existing) {
    console.log(`[qBittorrent] Torrent ${infoHash} already exists (duplicate)`);
    return infoHash;
  }

  // Upload via 'urls' parameter
  const form = new URLSearchParams({
    urls: magnetUrl,
    savepath: options?.savePath || this.defaultSavePath,
    category,
    paused: options?.paused ? 'true' : 'false',
    sequentialDownload: 'true',
  });

  if (options?.tags) {
    form.append('tags', options.tags.join(','));
  }

  const response = await this.client.post('/torrents/add', form, {
    headers: {
      Cookie: this.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (response.data !== 'Ok.') {
    throw new Error(`qBittorrent rejected magnet link: ${response.data}`);
  }

  console.log(`[qBittorrent] Successfully added magnet link: ${infoHash}`);
  return infoHash;
}

/**
 * Add .torrent file - download, parse, extract hash, upload content
 */
private async addTorrentFile(
  torrentUrl: string,
  category: string,
  options?: AddTorrentOptions
): Promise<string> {
  console.log(`[qBittorrent] Downloading .torrent file from: ${torrentUrl}`);

  // Download .torrent file into memory
  const torrentResponse = await axios.get(torrentUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  const torrentBuffer = Buffer.from(torrentResponse.data);
  console.log(`[qBittorrent] Downloaded ${torrentBuffer.length} bytes`);

  // Parse .torrent file to extract info_hash (deterministic)
  const parsedTorrent = await parseTorrent(torrentBuffer);
  const infoHash = parsedTorrent.infoHash;

  if (!infoHash) {
    throw new Error('Failed to extract info_hash from .torrent file');
  }

  console.log(`[qBittorrent] Extracted info_hash: ${infoHash}`);
  console.log(`[qBittorrent] Torrent name: ${parsedTorrent.name}`);

  // Check for duplicates
  const existing = await this.getTorrent(infoHash).catch(() => null);
  if (existing) {
    console.log(`[qBittorrent] Torrent ${infoHash} already exists (duplicate)`);
    return infoHash;
  }

  // Upload .torrent file content via multipart/form-data
  const FormData = require('form-data');
  const formData = new FormData();

  formData.append('torrents', torrentBuffer, {
    filename: `${parsedTorrent.name}.torrent`,
    contentType: 'application/x-bittorrent',
  });
  formData.append('savepath', options?.savePath || this.defaultSavePath);
  formData.append('category', category);
  formData.append('paused', options?.paused ? 'true' : 'false');
  formData.append('sequentialDownload', 'true');

  if (options?.tags) {
    formData.append('tags', options.tags.join(','));
  }

  const response = await this.client.post('/torrents/add', formData, {
    headers: {
      Cookie: this.cookie,
      ...formData.getHeaders(),
    },
  });

  if (response.data !== 'Ok.') {
    throw new Error(`qBittorrent rejected .torrent file: ${response.data}`);
  }

  console.log(`[qBittorrent] Successfully added torrent: ${infoHash}`);
  return infoHash;
}
```

### Monitor Download

```typescript
async getTorrent(hash: string): Promise<TorrentInfo> {
  if (!this.cookie) await this.login();

  const response = await axios.get(`${this.baseUrl}/torrents/info`, {
    headers: { Cookie: this.cookie },
    params: { hashes: hash },
  });

  const torrents = response.data;
  if (!torrents || torrents.length === 0) {
    throw new Error(`Torrent ${hash} not found`);
  }

  return torrents[0];
}
```

### Progress Calculation

```typescript
function getDownloadProgress(torrent: TorrentInfo): {
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
  speed: number;
  eta: number;
  state: string;
} {
  return {
    percent: Math.round(torrent.progress * 100),
    bytesDownloaded: torrent.downloaded,
    bytesTotal: torrent.size,
    speed: torrent.dlspeed,
    eta: torrent.eta,
    state: mapQBittorrentState(torrent.state),
  };
}

function mapQBittorrentState(state: TorrentState): string {
  const stateMap = {
    downloading: 'downloading',
    uploading: 'completed',
    stalledDL: 'downloading',
    pausedDL: 'paused',
    queuedDL: 'queued',
    checkingDL: 'checking',
    error: 'failed',
    missingFiles: 'failed',
  };

  return stateMap[state] || 'unknown';
}
```

## Tech Stack

**HTTP Client:** axios with cookie management
**Torrent Parsing:** parse-torrent (bencode decoder + info_hash extraction)
**Multipart Forms:** form-data (for uploading .torrent files)
**URL Parsing:** Node.js URL API

## Dependencies

**NPM Packages:**
- axios (HTTP requests, downloading .torrent files)
- parse-torrent (parse .torrent files and magnet links, extract info_hash)
- form-data (multipart/form-data for file uploads)

**External:**
- qBittorrent instance (v4.1+)

**Internal:**
- Configuration service (URL, username, password)
- Logging service

## Configuration

**IMPORTANT:** All configuration is managed exclusively through the admin UI settings. Environment variables are NOT used as fallbacks.

**Required Configuration Keys (in database):**
- `qbittorrent_url` - qBittorrent web UI URL
- `qbittorrent_username` - qBittorrent username
- `qbittorrent_password` - qBittorrent password (encrypted in database)
- `paths_downloads` - Download directory path

**Configuration Validation:**
The service validates all required fields are present before initialization. If any field is missing, a clear error message is shown listing all missing fields and directing the user to admin settings.

## Usage Examples

### Add and Monitor Torrent

```typescript
const qbt = new QBittorrentService();

// Add torrent
const magnetLink = 'magnet:?xt=urn:btih:...';
const hash = await qbt.addTorrent(magnetLink, {
  category: 'readmeabook',
  tags: ['audiobook', 'request-123'],
  sequentialDownload: true,
});

console.log(`Added torrent: ${hash}`);

// Monitor progress
const interval = setInterval(async () => {
  const torrent = await qbt.getTorrent(hash);
  const progress = getDownloadProgress(torrent);

  console.log(`Progress: ${progress.percent}%`);
  console.log(`Speed: ${formatSpeed(progress.speed)}`);
  console.log(`ETA: ${formatEta(progress.eta)}`);

  if (progress.state === 'completed') {
    console.log('Download complete!');
    clearInterval(interval);

    // Get files
    const files = await qbt.getFiles(hash);
    console.log('Downloaded files:', files.map(f => f.name));
  }
}, 5000); // Check every 5 seconds
```

### Manage Torrents

```typescript
// Get all torrents in category
const torrents = await qbt.getTorrents('readmeabook');
console.log(`${torrents.length} active torrents`);

// Pause slow torrent
const slowTorrent = torrents.find(t => t.dlspeed < 100000);
if (slowTorrent) {
  await qbt.pauseTorrent(slowTorrent.hash);
  console.log('Paused slow torrent');
}

// Delete failed torrents
const failedTorrents = torrents.filter(t => t.state === 'error');
for (const torrent of failedTorrents) {
  await qbt.deleteTorrent(torrent.hash, true); // Delete files too
  console.log(`Deleted failed torrent: ${torrent.name}`);
}
```

## Error Handling

**Common Errors:**
- `403 Forbidden`: Authentication failed (invalid credentials)
- `404 Not Found`: Torrent hash doesn't exist
- `Connection refused`: qBittorrent is not running
- `Timeout`: qBittorrent is overloaded or network issue

**Retry Strategy:**
- Retry authentication on 403 (session may have expired)
- Retry on network errors (max 3 attempts)
- Don't retry on 404 (torrent doesn't exist)

## Performance Considerations

**Cookie Management:**
- Reuse authenticated session
- Re-authenticate if cookie expires (403 response)
- Store cookie in memory (not persistent)

**Polling Frequency:**
- Poll every 5 seconds during active download
- Poll every 30 seconds for paused/queued torrents
- Stop polling when complete or failed

**Concurrent Downloads:**
- qBittorrent supports multiple simultaneous downloads
- Limit to 3 concurrent audiobook downloads
- Use categories to organize and filter

## Testing Strategy

### Unit Tests
- Mock qBittorrent API responses
- Test authentication and session management
- Test torrent state mapping
- Test error handling

### Integration Tests
- Test against real qBittorrent instance
- Add and monitor test torrent
- Test pause/resume/delete operations
- Verify file retrieval

## Known Issues

**Fixed Issues:**
- ✅ Configuration falling back to environment variables (Fixed: removed all env var fallbacks)
- ✅ Unclear error messages about missing configuration (Fixed: specific error messages listing missing fields)
- ✅ Service initializing even with incomplete configuration (Fixed: validation required before initialization)
- ✅ **Naive torrent identification using before/after snapshots** (Fixed: Complete architectural redesign - now downloads and parses .torrent files to extract info_hash deterministically before uploading to qBittorrent. This enterprise-grade approach eliminates race conditions, works regardless of qBittorrent's network access, and matches how professional automation tools work)
- ✅ Docker networking issues with Prowlarr URLs (Fixed: We download .torrent files ourselves instead of having qBittorrent download them)
- ✅ Duplicate torrent detection (Fixed: Checks if torrent exists before adding by querying with known info_hash)

**Current Issues:**
*None currently.*

## Future Enhancements

- **Bandwidth management**: Limit download speed during peak hours
- **Ratio management**: Auto-seed to maintain good ratio
- **Smart cleanup**: Auto-delete old completed torrents
- **Priority system**: Prioritize certain requests over others
- **Disk space monitoring**: Pause downloads if disk space low
