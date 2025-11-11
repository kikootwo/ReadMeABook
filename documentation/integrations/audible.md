# Audible Integration

## Current State

**Status:** Design Phase - Not yet implemented

This integration provides audiobook metadata scraping from Audible.com for discovery, search, and request features. Since Audible doesn't offer a public API, this service uses web scraping.

## Design Architecture

### Integration Method: Web Scraping

**Why Web Scraping:**
- No official Audible API available
- Publicly accessible data on Audible.com
- Alternative: Use third-party APIs (AudiobookBay API, Goodreads)

**Scraping Strategy:**
- Parse Audible HTML pages
- Extract structured data from JSON-LD
- Cache results to minimize requests
- Respect rate limits (max 10 requests/minute)

### Data Sources

**Pages to Scrape:**
1. **Best Sellers** - https://www.audible.com/adblbestsellers
2. **New Releases** - https://www.audible.com/newreleases
3. **Search Results** - https://www.audible.com/search?keywords={query}
4. **Book Detail Page** - https://www.audible.com/pd/{asin}

## Implementation Details

### Metadata Extracted

From audiobook detail pages:
- **ASIN** - Audible Standard Identification Number (unique ID)
- **Title** - Book title
- **Author** - Author name(s)
- **Narrator** - Narrator name(s)
- **Duration** - Length in minutes
- **Release Date** - Publication date
- **Description** - Full book description/summary
- **Cover Art URL** - High-resolution cover image
- **Rating** - Average user rating (out of 5)
- **Genres/Categories** - Book categories

### Scraping Techniques

**Cheerio for HTML Parsing:**
```typescript
import axios from 'axios';
import * as cheerio from 'cheerio';

const response = await axios.get(url);
const $ = cheerio.load(response.data);

// Extract data from specific selectors
const title = $('h1.bc-heading').text();
const author = $('a.authorLabel').text();
```

**JSON-LD Extraction:**
Many pages include structured data in JSON-LD format:
```html
<script type="application/ld+json">
{
  "@type": "Book",
  "name": "Project Hail Mary",
  "author": "Andy Weir",
  ...
}
</script>
```

### Rate Limiting

To avoid being blocked:
- Maximum 10 requests per minute
- Add random delays between requests (1-3 seconds)
- Use request queue to manage rate
- Implement exponential backoff on errors
- Cache results for 24 hours

### Error Handling

**Common Issues:**
- Page structure changes (requires scraper updates)
- Captcha challenges (need user intervention or proxy rotation)
- Rate limiting (429 errors)
- Network timeouts

**Mitigation:**
- Graceful fallback to cached data
- Log scraping errors for manual review
- Admin notifications for persistent failures
- Alternative data sources as backup

## Tech Stack

**HTTP Client:** axios
**HTML Parsing:** cheerio
**Caching:** Redis (24-hour TTL)
**Rate Limiting:** Custom implementation

## Dependencies

- axios for HTTP requests
- cheerio for HTML parsing
- Redis for caching (optional but recommended)
- User-Agent rotation to avoid detection

## API Contracts

### Audible Service API

```typescript
interface AudibleService {
  // Discovery
  getPopularAudiobooks(limit?: number): Promise<AudibleAudiobook[]>;
  getNewReleases(limit?: number): Promise<AudibleAudiobook[]>;

  // Search
  search(query: string, page?: number): Promise<AudibleSearchResult>;

  // Detail
  getAudiobookDetails(asin: string): Promise<AudibleAudiobook>;

  // Caching
  clearCache(): Promise<void>;
}
```

### Data Models

**AudibleAudiobook:**
```typescript
interface AudibleAudiobook {
  asin: string; // Unique Audible ID
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  genres?: string[];
}
```

**AudibleSearchResult:**
```typescript
interface AudibleSearchResult {
  query: string;
  results: AudibleAudiobook[];
  totalResults: number;
  page: number;
  hasMore: boolean;
}
```

## Usage Examples

### Get Popular Audiobooks

```typescript
import { getAudibleService } from './integrations/audible.service';

const audibleService = getAudibleService();

// Get top 20 popular audiobooks
const popular = await audibleService.getPopularAudiobooks(20);

for (const book of popular) {
  console.log(`${book.title} by ${book.author}`);
}
```

### Search for Audiobooks

```typescript
// Search for "Project Hail Mary"
const results = await audibleService.search('Project Hail Mary');

console.log(`Found ${results.totalResults} results`);
console.log('First result:', results.results[0].title);
```

### Get Audiobook Details

```typescript
// Get full details for a specific audiobook
const details = await audibleService.getAudiobookDetails('B08GCLPKH7');

console.log('Title:', details.title);
console.log('Author:', details.author);
console.log('Narrator:', details.narrator);
console.log('Duration:', details.durationMinutes, 'minutes');
console.log('Rating:', details.rating);
```

## Security Considerations

### Legal Compliance

- Only scrape publicly available data
- Respect robots.txt directives
- Don't scrape user-generated content requiring authentication
- Review Audible's Terms of Service

### Anti-Scraping Measures

- Use realistic User-Agent headers
- Implement random delays
- Don't overwhelm servers with requests
- Be prepared to adapt if blocked

### Data Privacy

- Don't store personal user data from Audible
- Only cache public metadata
- Clear cache regularly

## Performance Considerations

### Caching Strategy

- Cache popular audiobooks for 24 hours
- Cache search results for 1 hour
- Cache individual book details for 7 days
- Use Redis for distributed caching

### Request Optimization

- Batch requests when possible
- Prefetch popular content during off-hours
- Use conditional requests (If-Modified-Since)

## Testing Strategy

### Unit Tests

- HTML parsing logic
- JSON-LD extraction
- Rate limiting enforcement
- Error handling

### Integration Tests

- Full scraping flow with mocked responses
- Caching behavior
- Fallback mechanisms

### Manual Tests

- Test with real Audible pages
- Verify data accuracy
- Check rate limiting doesn't block
- Monitor for page structure changes

## Known Issues

*This section will be updated during implementation.*

**Potential Issues:**
- Audible page structure changes frequently
- Captcha challenges may appear
- Geographic restrictions (different content per region)
- Cover art URLs may expire

## Future Enhancements

- **Multiple region support** - Scrape Audible.co.uk, Audible.de, etc.
- **Author/narrator pages** - Get full discographies
- **Series detection** - Identify book series automatically
- **Alternative data sources** - Integrate Goodreads, Google Books APIs
- **Machine learning** - Auto-detect page structure changes
- **Proxy rotation** - Use proxies to avoid IP bans
- **Webhook monitoring** - Alert on scraping failures
