# Audible Integration

**Status:** ✅ Implemented (Audnexus API + Web Scraping)

Audiobook metadata from Audnexus API (primary) and Audible.com scraping (fallback) for discovery, search, and detail pages.

## Detail Page Strategy

**Primary: Audnexus API**
- Endpoint: `https://api.audnex.us/books/{asin}`
- Structured JSON response (no parsing needed)
- Provides: title, authors, narrators, description, duration, rating, genres, cover art
- Free, no API key required
- ~95% success rate for popular audiobooks

**Fallback: Audible Scraping**
- Used when Audnexus returns 404
- Parse Audible HTML with Cheerio
- Multiple selector strategies with promotional text filtering
- Extract JSON-LD structured data when available

## Region Configuration

**Status:** ✅ Implemented

Configurable Audible region for accurate metadata matching across different international Audible stores.

**Supported Regions:**
- United States (`us`) - `audible.com` (default, English)
- Canada (`ca`) - `audible.ca` (English)
- United Kingdom (`uk`) - `audible.co.uk` (English)
- Australia (`au`) - `audible.com.au` (English)
- India (`in`) - `audible.in` (English)
- Germany (`de`) - `audible.de` (non-English)
- Spain (`es`) - `audible.es` (non-English)
- French (`fr`) - `audible.fr` (non-English)

**`isEnglish` Flag:**
- Each region has `isEnglish: boolean` in `AudibleRegionConfig`
- Non-English regions (`isEnglish: false`) display an amber warning in all region dropdowns (setup wizard + admin settings)
- Warning text: "Many features such as search, discovery, and metadata matching are not yet fully supported for non-English regions."
- Dropdown options for non-English regions show `*` suffix (e.g., "Germany *")

**Why Regions Matter:**
- Each Audible region uses different ASINs for the same audiobook
- Metadata engines (Audnexus/Audible Agent) in Plex/Audiobookshelf must match RMAB's region
- Mismatched regions cause poor search results and failed metadata matching

**Configuration:**
- Key: `audible.region` (stored in database)
- Default: `us`
- Set during: Setup wizard (Backend Selection step) or Admin Settings (Library tab)
- Help text instructs users to match their metadata engine region

**Implementation:**
- `AudibleService` loads region from config on initialization
- Dynamically builds base URL: `AUDIBLE_REGIONS[region].baseUrl`
- Audnexus API calls include region parameter: `?region={code}`
- IP redirect prevention: `?ipRedirectOverride=true` on all Audible requests (region only)
- **Locale enforcement:** `?language=english` query parameter on all Audible requests (forces English content regardless of server IP geolocation)
- Configuration service helper: `getAudibleRegion()` returns configured region
- **Auto-detection of region changes**: Service checks config before each request and re-initializes if region changed
- **Cache clearing**: When region changes, ConfigService cache and AudibleService initialization are cleared
- **Automatic refresh**: Changing region automatically triggers `audible_refresh` job to fetch new data

**Files:**
- Types: `src/lib/types/audible.ts`
- Service: `src/lib/integrations/audible.service.ts`
- Config: `src/lib/services/config.service.ts`
- API: `src/app/api/admin/settings/audible/route.ts`

## Discovery Strategy (Popular/New/Search)

- Parse Audible HTML with Cheerio
- Multi-page scraping (20 items/page)
- Rate limit: max 10 req/min, 1.5s delay between pages
- Cache results in database (24hr TTL)

## Data Sources

URLs dynamically built based on configured region:

1. **Best Sellers:** `{baseUrl}/adblbestsellers`
2. **New Releases:** `{baseUrl}/newreleases`
3. **Search:** `{baseUrl}/search?keywords={query}&ipRedirectOverride=true`
4. **Detail Page:** `{baseUrl}/pd/{asin}?ipRedirectOverride=true`
5. **Audnexus API:** `https://api.audnex.us/books/{asin}?region={code}`

Where `{baseUrl}` is determined by configured region (e.g., `https://www.audible.co.uk` for UK).

## Metadata Extracted

- ASIN (Audible ID)
- Title, author, narrator
- Duration (minutes), release date, rating
- Description, cover art URL
- Genres/categories

## Unified Matching (`audiobook-matcher.ts`)

**Status:** ✅ Production Ready (ASIN-Only Matching)

Single matching algorithm used everywhere (search, popular, new-releases, jobs).

**Process (Library Availability Checks):**
1. Query DB directly by ASIN (indexed O(1) lookup)
2. Check ASIN in dedicated field (100% confidence)
3. Check ASIN in plexGuid (backward compatibility)
4. Return match or null (no fuzzy fallback)

**Match Priority:**
- `findPlexMatch()`: ASIN (field) → ASIN (GUID) → null
- `matchAudiobook()`: ASIN → ISBN → null

**Benefits:**
- Real-time matching at query time (not pre-matched)
- 100% confidence matches only (eliminates false positives)
- O(1) indexed lookups (faster than fuzzy matching)
- Solves race condition with Audiobookshelf ASIN population
- Used by all APIs for consistency

**Note:** Fuzzy matching (70% threshold) is preserved in `ranking-algorithm.ts` for Prowlarr torrent ranking, where it's needed to score multiple release candidates. Library availability checks require exact ASIN matches only.

## Database-First Approach

**Status:** ✅ Implemented

Discovery APIs serve cached data from DB with real-time matching.

**Flow:**
1. `audible_refresh` job runs daily → fetches 200 popular + 200 new releases
2. Downloads and caches cover thumbnails locally (reduces Audible load)
3. Stores in DB with flags (`isPopular`, `isNewRelease`) and rankings
4. Cleans up unused thumbnails after sync
5. API routes query DB → apply real-time matching → return enriched results
6. Homepage loads instantly (no Audible API hits)

## Thumbnail Caching

**Status:** ✅ Implemented

Cover images cached locally to reduce external requests and improve performance.

**Features:**
- Downloads covers during `audible_refresh` job
- Stores in `/app/cache/thumbnails` (Docker volume)
- Serves via `/api/cache/thumbnails/[filename]`
- Auto-cleanup of unused thumbnails
- Falls back to original URL if cache fails
- 24-hour browser cache headers

**Implementation:**
- Service: `src/lib/services/thumbnail-cache.service.ts`
- API Route: `src/app/api/cache/thumbnails/[filename]/route.ts`
- Storage: Docker volume `cache` mounted at `/app/cache`
- Filename: `{asin}.{ext}` (e.g., `B08G9PRS1K.jpg`)

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

## Fixed Issues

**Search returning empty results (2026-01-07)**
- **Problem:** Audible changed HTML structure for search results from `.productListItem` to `.s-result-item`
- **Impact:** All search queries returned 0 results
- **Fix:** Updated `search()` method to support both `.s-result-item` (current) and `.productListItem` (legacy)
- **Selectors updated:**
  - Main: `.s-result-item, .productListItem`
  - Title: `h2` (new) or `h3 a` (legacy)
  - Author: `a[href*="/author/"]` (new) or `.authorLabel` (legacy)
  - Narrator: `a[href*="searchNarrator="]` (new) or `.narratorLabel` (legacy)
  - Runtime: `span:contains("Length:")` (new) or `.runtimeLabel` (legacy)
  - Rating: `.a-icon-star span` (new) or `.ratingsLabel` (legacy)
- **Location:** `src/lib/integrations/audible.service.ts:235`

**Some audiobooks missing from search results (2026-01-07)**
- **Problem:** ASIN extraction only matched `/pd/` URLs but some audiobooks use `/ac/` URLs
- **Impact:** Books like "Beatitude" by DJ Krimmer (ASIN: B0DVH7XL36) were skipped
- **Fix:** Updated ASIN regex to match both `/pd/` and `/ac/` URL patterns: `/\/(?:pd|ac)\/[^\/]+\/([A-Z0-9]{10})/`
- **Location:** `src/lib/integrations/audible.service.ts:75, 161, 240`
- **Affects:** `getPopularAudiobooks()`, `getNewReleases()`, `search()` methods

**Audiobookshelf metadata matching not respecting configured region (2026-01-28)**
- **Problem:** `triggerABSItemMatch()` hardcoded `'audible'` provider (audible.com) instead of respecting user's configured Audible region
- **Impact:** Users with non-US regions (CA, UK, AU, IN) had incorrect metadata matching in Audiobookshelf, causing wrong ASINs and poor search results
- **Fix:** Added `mapRegionToABSProvider()` to convert RMAB region codes to AudiobookShelf provider values. US → `'audible'`, others → `'audible.{region}'` (e.g., `'audible.ca'`, `'audible.uk'`)
- **Location:** `src/lib/services/audiobookshelf/api.ts:14, 147`
- **Affects:** All Audiobookshelf metadata matching operations

**Non-English locale pages served to users outside US (2026-02-05)**
- **Problem:** Audible uses IP geolocation to serve locale-specific pages (e.g., Spanish content for Dominican Republic IPs). `ipRedirectOverride=true` only prevents region redirects (audible.com → audible.co.uk), NOT language/locale changes.
- **Impact:** Users self-hosting from non-English-speaking countries got non-English bestsellers/new releases on their homepage.
- **Fix:** Added `language=english` query parameter to all Audible requests via axios default params. Audible respects this parameter and serves English content regardless of IP geolocation. Fails gracefully for regions where English isn't available.
- **Location:** `src/lib/integrations/audible.service.ts` — `initialize()` (axios default params)
- **Affects:** All Audible scraping: popular, new releases, search, detail pages
