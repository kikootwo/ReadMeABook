# Prowlarr Integration

**Status:** ✅ Implemented | Manual search, interactive search, automatic search

Indexer aggregator for searching multiple torrent/usenet indexers simultaneously. Supports manual search, interactive torrent selection, and automatic RSS feed monitoring.

## API

**Base:** `http://prowlarr:9696/api/v1`
**Auth:** `X-Api-Key` header

**GET /search?query={q}&categories=3030** - Search all indexers (3030 = audiobooks)
**GET /indexer** - List configured indexers
**GET /indexerstats** - Indexer statistics
**GET /feed/{indexerId}/api?t=search&cat=3030&limit=100** - RSS feed for specific indexer

## Search

**Extended Search:** Enabled (`extended=1`) - searches title, tags, labels, and metadata fields

```typescript
interface TorrentResult {
  indexer: string;
  title: string;
  size: number; // bytes
  seeders: number;
  leechers: number;
  publishDate: Date;
  downloadUrl: string; // magnet or .torrent
  infoHash?: string;
  guid: string;
  format?: 'M4B' | 'M4A' | 'MP3';
  bitrate?: string;
  hasChapters?: boolean;
}
```

## Config

- `indexer.prowlarr_url`
- `indexer.prowlarr_api_key`

## Error Handling

- 401: Invalid API key
- 429: Rate limit (exponential backoff, max 3 retries)
- 503: Service unavailable
- Timeout: 30s per search

## Manual & Interactive Search

**Manual Search** (`POST /api/requests/{id}/manual-search`)
- Triggers automatic search job for requests with status: pending, failed, awaiting_search
- Uses ranking algorithm to select best torrent
- Updates request status to 'pending'

**Interactive Search** (`POST /api/requests/{id}/interactive-search`)
- Returns ranked torrent results for user selection
- Shows table with: rank, title, size, quality score, seeders, indexer, publish date
- Available for same statuses as manual search
- User clicks "Download" button to select specific torrent

**Select Torrent** (`POST /api/requests/{id}/select-torrent`)
- Downloads user-selected torrent from interactive search
- Triggers download_torrent job
- Updates request status to 'downloading'

**UI Integration:**
- Manual Search button: Triggers automatic search
- Interactive Search button: Opens modal with torrent results
- Both buttons shown for requests with status: pending, failed, awaiting_search

## RSS Monitoring

**Automatic Feed Monitoring:** Enabled per-indexer via setup wizard or settings page
**Schedule:** Every 15 minutes (default, configurable)
**Process:**
1. Fetch RSS feeds from all indexers with RSS enabled
2. Fuzzy match results against requests in 'awaiting_search' status
3. Trigger search jobs for matches
4. Limit: 100 results per feed, 100 missing requests per check

**Matching Logic:**
- Author name must appear in torrent title
- At least 2 title words (>2 chars) must match
- First match triggers search job (no duplicates)

## Tech Stack

- axios
- bottleneck (rate limiting)
