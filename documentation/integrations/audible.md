# Audible Integration

**Status:** ✅ Implemented (Web Scraping)

Audiobook metadata scraping from Audible.com for discovery, search, and request features.

## Scraping Strategy

- Parse Audible HTML with Cheerio
- Multi-page scraping (20 items/page)
- Rate limit: max 10 req/min, 1.5s delay between pages
- Cache results in database (24hr TTL)
- Extract JSON-LD structured data when available

## Data Sources

1. **Best Sellers:** `https://www.audible.com/adblbestsellers`
2. **New Releases:** `https://www.audible.com/newreleases`
3. **Search:** `https://www.audible.com/search?keywords={query}`
4. **Detail Page:** `https://www.audible.com/pd/{asin}`

## Metadata Extracted

- ASIN (Audible ID)
- Title, author, narrator
- Duration (minutes), release date, rating
- Description, cover art URL
- Genres/categories

## Unified Matching (`audiobook-matcher.ts`)

**Status:** ✅ Production Ready

Single matching algorithm used everywhere (search, popular, new-releases, jobs).

**Process:**
1. Query DB candidates: `audibleId` exact match OR partial title+author match
2. If exact ASIN match → return immediately
3. Fuzzy match: title 70% + author 30% weights, 70% threshold
4. Return best match or null

**Benefits:**
- Real-time matching at query time (not pre-matched)
- Works regardless of job execution order
- Prevents duplicate `plexGuid` assignments
- Used by all APIs for consistency

## Database-First Approach

**Status:** ✅ Implemented

Discovery APIs serve cached data from DB with real-time matching.

**Flow:**
1. `audible_refresh` job runs daily → fetches 200 popular + 200 new releases
2. Stores in DB with flags (`isPopular`, `isNewRelease`) and rankings
3. API routes query DB → apply real-time matching → return enriched results
4. Homepage loads instantly (no Audible API hits)

**API Endpoints:**

**GET /api/audiobooks/popular?page=1&limit=20**
**GET /api/audiobooks/new-releases?page=1&limit=20**

Response:
```typescript
{
  success: boolean;
  audiobooks: EnrichedAudibleAudiobook[];
  count: number;
  totalCount: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  lastSync: string | null; // ISO timestamp
  message?: string; // if no data
}
```

## Data Models

```typescript
interface AudibleAudiobook {
  asin: string;
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

interface EnrichedAudibleAudiobook extends AudibleAudiobook {
  availabilityStatus: 'available' | 'requested' | 'unknown';
  isAvailable: boolean;
  plexGuid: string | null;
  dbId: string;
}
```

## Tech Stack

- axios (HTTP)
- cheerio (HTML parsing)
- Redis (caching, optional)
- Database (PostgreSQL)
- string-similarity (matching)
