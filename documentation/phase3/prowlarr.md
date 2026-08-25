# Prowlarr Integration

**Status:** ✅ Implemented | Manual search, interactive search, automatic search

Indexer aggregator for searching multiple torrent/usenet indexers simultaneously. Supports manual search, interactive torrent selection, and automatic RSS feed monitoring.

## API

**Base:** `http://prowlarr:9696/api/v1`
**Auth:** `X-Api-Key` header

**GET /search?query={q}&categories=3030&indexerIds={ids}** - Search indexers (3030 = audiobooks, ids = comma-separated indexer IDs)
**GET /indexer** - List configured indexers
**GET /indexerstats** - Indexer statistics
**GET /feed/{indexerId}/api?t=search&cat=3030&limit=100** - RSS feed for specific indexer

## Search Strategy

**Search Query:** Title only (not title + author)
- Broader search yields more results (e.g., 20 vs 1)
- Ranking algorithm filters out mismatches using author/narrator
- Works around indexer limitations with complex queries

**Extended Search:** Enabled (`extended=1`) - searches title, tags, labels, and metadata fields

**Result Filtering:**
- Minimum score threshold: 50/100
- Filters applied after ranking to remove poor matches
- Ensures at least basic title/author match quality
- Audiobook searches rank the full deduplicated result set, then retain the best 100
- Interactive responses expose `truncated` and the pre-ranking `rawCount`

**Example:** "Season of Storms" → finds all "Season of Storms" torrents → ranks by author match → filters score < 50

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

**Indexer Filtering:** All searches (manual and interactive) only query indexers enabled in settings (`prowlarr_indexers` config). If no indexers are enabled, search will fail with error.

**Manual Search** (`POST /api/requests/{id}/manual-search`)
- Triggers automatic search job for requests with status: pending, failed, awaiting_search
- Searches only enabled indexers (title only)
- Ranks all results, filters scores < 50
- Retains the best 100 qualifying results after ranking
- Selects best torrent from filtered results
- Updates request status to 'pending'

**Interactive Search** (`POST /api/requests/{id}/interactive-search`)
- Returns ranked torrent results for user selection
- Searches only enabled indexers (title only or custom)
- Accepts optional custom search title in request body
- Ranks all results, then returns the best 100 with truncation metadata
- Shows table with: rank, title, size, quality score, seeders, indexer, publish date
- Editable title field allows search refinement
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
