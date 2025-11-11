# qBittorrent Integration

## Current State

**Status:** Not Implemented

qBittorrent is a free, open-source BitTorrent client with a comprehensive Web API. It's the primary download client for ReadMeABook.

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

  const form = new URLSearchParams({
    urls: url, // Magnet link or .torrent URL
    savepath: options?.savePath || this.defaultSavePath,
    category: options?.category || 'readmeabook',
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

  // qBittorrent doesn't return hash, calculate from magnet/URL
  const hash = extractHashFromUrl(url);
  return hash;
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

```typescript
const config = {
  url: process.env.QBITTORRENT_URL || 'http://qbittorrent:8080',
  username: process.env.QBITTORRENT_USERNAME || 'admin',
  password: process.env.QBITTORRENT_PASSWORD,
  defaultSavePath: process.env.QBITTORRENT_SAVE_PATH || '/downloads',
  category: 'readmeabook',
};
```

**Required Configuration Keys:**
- `download_client.qbittorrent_url`
- `download_client.qbittorrent_username`
- `download_client.qbittorrent_password`
- `paths.download_dir`

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

*This section will be updated during implementation.*

## Future Enhancements

- **Bandwidth management**: Limit download speed during peak hours
- **Ratio management**: Auto-seed to maintain good ratio
- **Smart cleanup**: Auto-delete old completed torrents
- **Priority system**: Prioritize certain requests over others
- **Disk space monitoring**: Pause downloads if disk space low
