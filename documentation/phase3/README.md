# Phase 3: Automation Engine

## Current State

**Status:** In Development

This phase implements the complete automation pipeline that transforms audiobook requests into downloaded, organized media files available in Plex Media Server.

## Design Architecture

### Automation Flow

The automation engine follows a multi-stage pipeline:

```
1. Request Created
   └─> Job: search_indexers

2. Search Indexers (Prowlarr/Jackett)
   └─> Find available torrents/downloads
   └─> Job: rank_results

3. Rank Results
   └─> Apply intelligent ranking algorithm
   └─> Select best torrent
   └─> Job: download_torrent

4. Download Torrent (qBittorrent/Transmission)
   └─> Add torrent to download client
   └─> Job: monitor_download (recurring)

5. Monitor Download
   └─> Update progress in database
   └─> When complete: Job: process_audiobook

6. Process Audiobook
   └─> Organize files into Author/Title structure
   └─> Job: update_plex

7. Update Plex
   └─> Trigger library scan
   └─> Fuzzy match to find item
   └─> Mark request as completed
```

### Job Queue System

Each stage is implemented as a Bull job with:
- **Retry logic**: Up to 3 attempts with exponential backoff
- **Priority levels**: High (10), Medium (5), Low (1)
- **Concurrency**: 3 concurrent jobs per type
- **Persistence**: Jobs survive application restarts (Redis)

### Integration Architecture

**Indexers** (Search for torrents):
- Primary: Prowlarr (aggregates multiple indexers)
- Fallback: Jackett (alternative aggregator)
- Both use REST APIs

**Download Clients** (Manage downloads):
- Primary: qBittorrent (Web API)
- Fallback: Transmission (RPC API)
- Both support monitoring and webhooks

**Media Server** (Final destination):
- Plex Media Server (XML/JSON API)
- Library scanning and fuzzy matching
- Real-time status updates

## Implementation Details

### Directory Structure

```
src/lib/
├── integrations/
│   ├── prowlarr.service.ts       # Prowlarr API client
│   ├── jackett.service.ts        # Jackett API client
│   ├── qbittorrent.service.ts    # qBittorrent API client
│   ├── transmission.service.ts   # Transmission API client
│   └── plex.service.ts           # (Already exists)
├── processors/
│   ├── search-indexers.processor.ts     # Stage 2
│   ├── rank-results.processor.ts        # Stage 3
│   ├── download-torrent.processor.ts    # Stage 4
│   ├── monitor-download.processor.ts    # Stage 5
│   ├── process-audiobook.processor.ts   # Stage 6
│   └── update-plex.processor.ts         # Stage 7
└── utils/
    ├── ranking-algorithm.ts      # Torrent ranking logic
    ├── file-organizer.ts         # File system operations
    └── fuzzy-matcher.ts          # Plex library matching
```

### Data Flow

**Request Object** (passed through pipeline):
```typescript
interface RequestJobData {
  requestId: string;
  audiobook: {
    id: string;
    title: string;
    author: string;
  };
  // Additional fields added at each stage
  searchResults?: TorrentResult[];
  selectedTorrent?: TorrentResult;
  downloadId?: string;
  downloadPath?: string;
  plexItemId?: string;
}
```

## Tech Stack

**Indexer Integration:**
- Prowlarr API (REST)
- Jackett API (REST)
- axios for HTTP requests

**Download Client Integration:**
- qBittorrent Web API (REST)
- Transmission RPC (JSON-RPC 2.0)
- axios and custom RPC client

**File Operations:**
- Node.js fs/promises
- Path manipulation
- File moving and renaming

**Media Server Integration:**
- Plex Media Server API (XML/JSON)
- xml2js for XML parsing
- Fuzzy matching with string-similarity

## Dependencies

**External Services:**
- Prowlarr or Jackett instance (user-configured)
- qBittorrent or Transmission instance (user-configured)
- Plex Media Server instance (user-configured)

**NPM Packages:**
- axios (HTTP requests)
- xml2js (Plex XML parsing)
- string-similarity (fuzzy matching)
- bull (job queue - already installed)

## Configuration

All integrations are configured via the Configuration service:

**Prowlarr:**
```
indexer.type = "prowlarr"
indexer.prowlarr_url = "http://prowlarr:9696"
indexer.prowlarr_api_key = "encrypted_api_key"
```

**Jackett:**
```
indexer.type = "jackett"
indexer.jackett_url = "http://jackett:9117"
indexer.jackett_api_key = "encrypted_api_key"
```

**qBittorrent:**
```
download_client.type = "qbittorrent"
download_client.qbittorrent_url = "http://qbittorrent:8080"
download_client.qbittorrent_username = "admin"
download_client.qbittorrent_password = "encrypted_password"
```

**Transmission:**
```
download_client.type = "transmission"
download_client.transmission_url = "http://transmission:9091"
download_client.transmission_username = "admin"
download_client.transmission_password = "encrypted_password"
```

**Paths:**
```
paths.download_dir = "/downloads"
paths.media_dir = "/media/audiobooks"
paths.temp_dir = "/tmp/readmeabook"
```

## Usage Examples

See individual integration documentation:
- [Prowlarr Integration](./prowlarr.md)
- [Jackett Integration](./jackett.md)
- [qBittorrent Integration](./qbittorrent.md)
- [Transmission Integration](./transmission.md)
- [Ranking Algorithm](./ranking-algorithm.md)
- [File Organization](./file-organization.md)
- [Plex Integration](../integrations/plex.md)

## Known Issues

*This section will be updated during implementation.*

## Future Enhancements

- **Parallel downloads**: Support multiple simultaneous downloads
- **Bandwidth management**: Throttle downloads during peak hours
- **Smart retry**: Automatically try different torrents if download fails
- **Quality preferences**: User-configurable quality preferences
- **Notification system**: Alert users when downloads complete
- **Download history**: Track all attempted downloads for debugging
