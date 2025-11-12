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

### API Overview

**Base URL:** `http://qbittorrent:8080/api/v2`
**Authentication:** Cookie-based (login required)

**Endpoints Used:**
- `POST /auth/login` - Authenticate and get cookie
- `POST /torrents/add` - Add new torrent
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

### Add Torrent

```typescript
async addTorrent(
  url: string,
  options?: AddTorrentOptions
): Promise<string> {
  // Ensure we're authenticated
  if (!this.cookie) await this.login();

  const category = options?.category || 'readmeabook';

  // Ensure category exists
  await this.ensureCategory(category);

  // Try to extract hash from URL (works for magnet links)
  const extractedHash = this.extractHash(url);

  // Get snapshot of existing torrents BEFORE adding
  const beforeTorrents = await this.getTorrents();
  const beforeHashes = new Set(beforeTorrents.map(t => t.hash));

  // Check for duplicates
  if (extractedHash !== 'pending' && beforeHashes.has(extractedHash)) {
    console.warn('Torrent already exists (duplicate)');
    return extractedHash;
  }

  // Add the torrent
  const form = new URLSearchParams({
    urls: url, // Magnet link or .torrent URL
    savepath: options?.savePath || this.defaultSavePath,
    category,
    paused: options?.paused ? 'true' : 'false',
    sequentialDownload: 'true', // Download in order for streaming
  });

  if (options?.tags) {
    form.append('tags', options.tags.join(','));
  }

  await axios.post(`${this.baseUrl}/torrents/add`, form, {
    headers: {
      Cookie: this.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  // Wait for qBittorrent to process
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Get torrents AFTER adding
  const afterTorrents = await this.getTorrents();

  // Find NEW torrent by comparing before/after
  const newTorrents = afterTorrents.filter(
    t => !beforeHashes.has(t.hash)
  );

  if (newTorrents.length === 0) {
    throw new Error('Failed to add torrent - check URL and qBittorrent logs');
  }

  const newTorrent = newTorrents[0];

  // Ensure correct category
  if (newTorrent.category !== category) {
    await this.setCategory(newTorrent.hash, category);
  }

  return newTorrent.hash;
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
**URL Parsing:** Node.js URL API
**Hash Extraction:** magnet-uri package

## Dependencies

**NPM Packages:**
- axios (HTTP requests)
- magnet-uri (parse magnet links)

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
- ✅ Torrent hash returning "pending" for .torrent URLs (Fixed: now queries qBittorrent after adding to get actual hash)
- ✅ **Critical: Torrent hash detection fails when torrent isn't actually added** (Fixed: now captures snapshot of existing torrents before adding, compares after adding to detect new torrent, throws detailed error if no new torrent detected instead of hijacking unrelated torrents)
- ✅ Duplicate torrent detection (Fixed: now checks if torrent already exists before attempting to add, returns existing hash for duplicates)

**Current Issues:**
*None currently.*

## Future Enhancements

- **Bandwidth management**: Limit download speed during peak hours
- **Ratio management**: Auto-seed to maintain good ratio
- **Smart cleanup**: Auto-delete old completed torrents
- **Priority system**: Prioritize certain requests over others
- **Disk space monitoring**: Pause downloads if disk space low
