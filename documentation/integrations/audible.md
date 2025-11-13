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

**Cheerio for HTML Parsing with Pagination:**
```typescript
import axios from 'axios';
import * as cheerio from 'cheerio';

// Multi-page scraping to get 200 items
const audiobooks: AudibleAudiobook[] = [];
let page = 1;
const maxPages = Math.ceil(limit / 20); // ~20 items per page

while (audiobooks.length < limit && page <= maxPages) {
  const response = await axios.get(url, {
    params: page > 1 ? { page } : {},
  });
  const $ = cheerio.load(response.data);

  // Extract data from specific selectors
  $('.productListItem').each((index, element) => {
    const title = $(element).find('h1.bc-heading').text();
    const author = $(element).find('a.authorLabel').text();
    audiobooks.push({ title, author, ... });
  });

  // Add delay between pages (1.5s) to respect rate limits
  await delay(1500);
  page++;
}
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

### Unified Matching Architecture

**Status:** Implemented ✅

**Location:** `src/lib/utils/audiobook-matcher.ts`

**Purpose:** Provides a single, consistent matching algorithm used across the entire application to match Audible audiobooks with database records.

**Used By:**
- ✅ Search API (`/api/audiobooks/search`)
- ✅ Audible Refresh Job (scheduler service)
- ✅ Any future feature needing audiobook matching

**Matching Algorithm:**
1. **Query database for candidates:**
   ```typescript
   where: {
     OR: [
       { audibleId: audiobook.asin },  // Exact ASIN match
       {
         AND: [
           { title: { contains: audiobook.title.substring(0, 20) } },
           { author: { contains: audiobook.author.substring(0, 20) } }
         ]
       }
     ]
   }
   ```
2. **Check exact ASIN match first** - If found, return immediately
3. **Perform fuzzy matching** using `string-similarity`:
   - Title score: 70% weight
   - Author score: 30% weight
   - Overall score threshold: 70%
4. **Return best match** or null

**Key Benefits:**
- 🎯 **Single source of truth** - No duplicate logic
- 🔄 **Consistent behavior** - Same matching everywhere
- ⚡ **Query-time matching** - Checks at query time (no pre-loading)
- 📊 **Status-agnostic** - Matches ANY database record, not just `availabilityStatus='available'`
- 🛡️ **Duplicate protection** - Prevents multiple Audible books claiming same `plexGuid`

### API Route Implementation: Database-First Approach

**Status:** Implemented ✅

**Implementation:** Discovery API routes (`/api/audiobooks/popular`, `/api/audiobooks/new-releases`) now serve cached data from the database instead of hitting Audible directly.

**How It Works:**
1. **Data Refresh Job:** The `audible_refresh` scheduled job runs periodically (default: daily at midnight):
   - Fetches 200 popular audiobooks and 200 new releases from Audible via multi-page scraping
   - For EACH audiobook, uses **shared matcher** to find database match
   - If match found with `plexGuid`, assigns it (with duplicate checking)
   - Sets `availabilityStatus` based on match
2. **Database Storage:** Audiobooks are cached in the database with:
   - Category flags (`isPopular`, `isNewRelease`)
   - Ranking information (`popularRank`, `newReleaseRank`)
   - Sync timestamp (`lastAudibleSync`)
   - Full metadata (title, author, narrator, cover art, etc.)
   - Availability status and `plexGuid` from matching
3. **API Routes:** Discovery routes query the database for cached data with pagination support
4. **Availability Display:** Books with `plexGuid` automatically show "In Your Library" badge

**API Endpoints:**

**GET /api/audiobooks/popular?page=1&limit=20**
- Returns popular audiobooks from database cache
- Supports pagination with `page` and `limit` parameters
- Returns helpful message if no data exists (prompts user to run refresh job)

**GET /api/audiobooks/new-releases?page=1&limit=20**
- Returns new releases from database cache
- Supports pagination with `page` and `limit` parameters
- Returns helpful message if no data exists

**Response Format:**
```typescript
interface AudiobooksResponse {
  success: boolean;
  audiobooks: EnrichedAudibleAudiobook[];
  count: number;          // Number of items in current page
  totalCount: number;     // Total items across all pages
  page: number;           // Current page number
  totalPages: number;     // Total number of pages
  hasMore: boolean;       // Whether more pages exist
  lastSync: string | null; // ISO timestamp of last Audible sync
  message?: string;       // Optional message (e.g., if no data)
}

interface EnrichedAudibleAudiobook {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  genres: string[];
  availabilityStatus: 'available' | 'requested' | 'unknown';
  isAvailable: boolean;
  plexGuid: string | null;
  dbId: string;
}
```

**Benefits:**
- **Performance:** No web scraping on every page load - instant responses from database
- **Reliability:** No dependency on Audible.com availability for homepage
- **Scalability:** Can serve many concurrent users without rate limiting
- **Freshness:** Data refreshed automatically via scheduled job
- **Pagination:** Supports large datasets (200 items per category) with efficient pagination
- **Availability:** Database already includes Plex availability status from refresh job matching

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
