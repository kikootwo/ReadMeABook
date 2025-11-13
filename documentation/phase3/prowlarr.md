# Prowlarr Integration

**Status:** ❌ Not Implemented

Indexer aggregator for searching multiple torrent/usenet indexers simultaneously.

## API

**Base:** `http://prowlarr:9696/api/v1`
**Auth:** `X-Api-Key` header

**GET /search?query={q}&categories=3030** - Search all indexers (3030 = audiobooks)
**GET /indexer** - List configured indexers
**GET /indexerstats** - Indexer statistics

## Search

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

## Tech Stack

- axios
- bottleneck (rate limiting)
