# Prowlarr Integration

## Current State

**Status:** Not Implemented

Prowlarr is an indexer aggregator that searches multiple torrent and usenet indexers simultaneously. It's the primary indexer solution for ReadMeABook.

## Design Architecture

### Why Prowlarr?

**Advantages:**
- Single API for multiple indexers
- Built-in rate limiting and caching
- Category-based search (audiobooks)
- Standardized result format
- Active development and community support
- Integration with Radarr/Sonarr ecosystem

### API Overview

**Base URL:** `http://prowlarr:9696/api/v1`
**Authentication:** API Key in `X-Api-Key` header

**Endpoints Used:**
- `GET /search` - Search all configured indexers
- `GET /indexer` - List configured indexers
- `GET /indexerstats` - Get indexer statistics

## Implementation Details

### Service Interface

```typescript
interface ProwlarrService {
  // Search for audiobooks across all indexers
  search(query: string, filters?: SearchFilters): Promise<TorrentResult[]>;

  // Get list of configured indexers
  getIndexers(): Promise<Indexer[]>;

  // Test connection to Prowlarr
  testConnection(): Promise<boolean>;

  // Get indexer statistics
  getStats(): Promise<IndexerStats>;
}

interface SearchFilters {
  category?: number;  // 3030 for audiobooks
  minSeeders?: number;
  maxResults?: number;
}

interface TorrentResult {
  indexer: string;        // Name of indexer
  title: string;          // Torrent title
  size: number;           // Size in bytes
  seeders: number;        // Number of seeders
  leechers: number;       // Number of leechers
  publishDate: Date;      // When torrent was published
  downloadUrl: string;    // Magnet link or .torrent URL
  infoHash?: string;      // Torrent info hash
  guid: string;           // Unique identifier

  // Metadata (extracted from title)
  format?: 'M4B' | 'M4A' | 'MP3';
  bitrate?: string;
  hasChapters?: boolean;
}
```

### Search Implementation

```typescript
async search(query: string, filters?: SearchFilters): Promise<TorrentResult[]> {
  const params = new URLSearchParams({
    query,
    categories: filters?.category?.toString() || '3030', // Audiobooks
    type: 'search',
  });

  const response = await this.client.get(`/api/v1/search?${params}`, {
    headers: { 'X-Api-Key': this.apiKey },
  });

  // Transform Prowlarr results to our format
  return response.data.map(transformResult);
}
```

### Result Parsing

Prowlarr returns Newznab/Torznab format results. Extract audiobook metadata from title:

**Example title:** `"Foundation by Isaac Asimov (Narrated by Scott Brick) M4B 64kbps"`

**Parsing logic:**
1. Extract format: Look for M4B, M4A, MP3
2. Extract bitrate: Look for number + "kbps"
3. Check for chapters: M4B typically has chapters
4. Extract narrator: Look for "Narrated by" pattern
5. Validate match: Ensure title/author roughly matches request

## Tech Stack

**HTTP Client:** axios
**Rate Limiting:** bottleneck (429 handling)
**Parsing:** Regular expressions for title parsing

## Dependencies

**External:**
- Prowlarr instance (v1.0+)
- Configured indexers in Prowlarr

**Internal:**
- Configuration service (API URL and key)
- Logging service

## Configuration

```typescript
const config = {
  url: process.env.PROWLARR_URL || 'http://prowlarr:9696',
  apiKey: process.env.PROWLARR_API_KEY,
  timeout: 30000, // 30 seconds
  maxResults: 100,
  defaultCategory: 3030, // Audiobooks
};
```

**Required Configuration Keys:**
- `indexer.prowlarr_url`
- `indexer.prowlarr_api_key`

## Usage Examples

### Basic Search

```typescript
const prowlarr = new ProwlarrService();

const results = await prowlarr.search('Foundation Isaac Asimov', {
  category: 3030,
  minSeeders: 1,
  maxResults: 50,
});

console.log(`Found ${results.length} torrents`);
results.forEach(r => {
  console.log(`${r.title} - ${r.seeders} seeders - ${formatBytes(r.size)}`);
});
```

### Test Connection

```typescript
try {
  const isConnected = await prowlarr.testConnection();
  if (isConnected) {
    console.log('Prowlarr connection successful');
    const indexers = await prowlarr.getIndexers();
    console.log(`${indexers.length} indexers configured`);
  }
} catch (error) {
  console.error('Prowlarr connection failed:', error);
}
```

### Get Indexer Statistics

```typescript
const stats = await prowlarr.getStats();
stats.indexers.forEach(i => {
  console.log(`${i.name}: ${i.numberOfQueries} queries, ${i.averageResponseTime}ms avg`);
});
```

## Error Handling

**Common Errors:**
- `401 Unauthorized`: Invalid API key
- `429 Too Many Requests`: Rate limit exceeded (exponential backoff)
- `503 Service Unavailable`: Prowlarr is down or restarting
- `Timeout`: Search took too long (some indexers are slow)

**Retry Strategy:**
- Retry on 429, 503, and network errors
- Exponential backoff: 2s, 4s, 8s
- Max 3 attempts
- Log all failures for admin review

## Performance Considerations

**Caching:**
- Cache search results for 5 minutes
- Cache indexer list for 1 hour
- Use Redis for distributed caching

**Rate Limiting:**
- Respect Prowlarr's rate limits
- Throttle to max 10 requests/second
- Queue requests if limit exceeded

**Timeout:**
- Set 30 second timeout per search
- Some indexers are slow to respond
- Prowlarr aggregates results as they come in

## Testing Strategy

### Unit Tests
- Mock Prowlarr API responses
- Test result parsing and transformation
- Test error handling

### Integration Tests
- Test against real Prowlarr instance (dev environment)
- Verify search results are valid
- Test connection failure scenarios

## Known Issues

*This section will be updated during implementation.*

## Future Enhancements

- **Smart indexer selection**: Only query fast/reliable indexers
- **Result caching**: Cache popular searches
- **Indexer health monitoring**: Disable failing indexers temporarily
- **Custom categories**: Support custom Prowlarr category mappings
