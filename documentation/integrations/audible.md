# Audible Integration

**Status:** Implemented | Unauthenticated Audible JSON catalog API (primary) + Audnexus API (per-ASIN details)

## Overview

Audiobook metadata for discovery, search, and detail pages. All catalog operations (search, popular, new releases, categories, category books, author books, single-product details) now call Audible's unauthenticated public JSON catalog API (`api.audible.<tld>/1.0/catalog/*`). Per-ASIN detail lookups prefer Audnexus; the catalog API is used as fallback.

## Architecture

- **Primary data source:** Audible JSON catalog API, same endpoint used by the official Audible mobile apps. No authentication, no API key, no user credentials, no special headers.
- **Per-ASIN details:** Audnexus (`api.audnex.us/books/{asin}`) remains primary; catalog API (`/1.0/catalog/products/{asin}`) is the fallback when Audnexus returns 404.
- **HTML scraping:** Removed from `audible.service.ts`. The only remaining HTML path is `audible-series.ts` (series-page scraping, out of scope).
- **`www.audible.<tld>`:** Still used by `audible-series.ts` and by `getBaseUrl()` for "View on Audible" link generation. Not used for any catalog operation.

## Data Sources

All catalog operations are HTTP GET against `{apiBaseUrl}` (region-dependent, e.g. `https://api.audible.com`):

| Operation | Endpoint | Key params |
|---|---|---|
| Search | `/1.0/catalog/products` | `keywords=<q>` |
| Author books | `/1.0/catalog/products` | `author=<name>` (name, NOT ASIN) |
| Popular | `/1.0/catalog/products` | `products_sort_by=BestSellers` |
| New releases | `/1.0/catalog/products` | `products_sort_by=-ReleaseDate` |
| Category books | `/1.0/catalog/products` | `category_id=<id>&products_sort_by=BestSellers` |
| Categories listing | `/1.0/catalog/categories` | (none) |
| Single product | `/1.0/catalog/products/{asin}` | — |
| Audnexus (per-ASIN) | `https://api.audnex.us/books/{asin}` | `region={audnexusParam}` |

All `products` endpoints share:
- `num_results` — max **50** (service constant `AUDIBLE_PAGE_SIZE = 50`)
- `page` — **0-indexed at the API** (service public interface is 1-indexed; the service subtracts 1 at the call site). See Gotchas.
- `response_groups=<CATALOG_RESPONSE_GROUPS>`

## `response_groups` Constant

`CATALOG_RESPONSE_GROUPS = 'contributors,product_desc,product_attrs,product_extended_attrs,media,rating,series,category_ladders,product_details'`

Populates every `AudibleAudiobook` field. Covered:
- `contributors` → authors (with ASINs), narrators
- `product_desc` → `publisher_summary`, `merchandising_summary`
- `product_attrs` / `product_extended_attrs` / `product_details` → title, release_date, language, runtime_length_min
- `media` → `product_images` (cover URLs, uses `500` variant)
- `rating` → `overall_distribution.display_stars`
- `series` → array of `{asin, title, sequence}`
- `category_ladders` → genre names (deduped, capped at 5)

## Gotchas

- **`author=` takes a name, not an ASIN.** The catalog API has no ASIN-based author param. `searchByAuthorAsin()` queries by name, then filters client-side: keeps only products where `products[].authors[].asin === authorAsin`. Preserves ASIN-authoritative author identity. Also filters by `product.language` via `isAcceptedLanguage()` for the configured region.
- **Invalid ASIN returns HTTP 200 with stub body.** `/1.0/catalog/products/{asin}` responds 200 with `{product: {asin: INPUT}}` and no other fields. `fetchAudibleDetailsFromApi()` detects this via missing `product.title` and returns `null`.
- **`publisher_summary` is HTML.** Service strips tags via inline `stripHtml()` helper (regex-based, no cheerio) before populating `description`. Falls back to `merchandising_summary` (plain text) if `publisher_summary` missing.
- **Series is an array.** `products[].series[]` — a book may belong to multiple series. Service picks the first entry with non-empty `sequence`, else the first entry. `sequence` is cleaned by extracting first `/\d+(?:\.\d+)?/` match for numeric ordering.
- **Stub `product_images`:** cover URL reads from `product_images['500']`; missing keys fall back to `undefined`.
- **`page` is 0-indexed.** Despite the default value appearing to be 1, the API returns items `(page * num_results)` through `((page + 1) * num_results - 1)`. So `page=1` fetches items 51–100, not 1–50. All service methods accept a 1-indexed `page` and subtract 1 at the axios call. The symptom of getting this wrong is silent: queries whose `total_results ≤ num_results` return an empty `products` array while `total_results` is populated (e.g. author searches for small catalogues).

## Rate Limiting & Resilience

- 503s still possible but dramatically less frequent than the HTML surface.
- `fetchWithRetry()` — jittered exponential backoff, 5 retries, retries on 503/429/5xx.
- `AdaptivePacer` circuit-breaker preserved.
- Inter-page base delay on API paths: **500–1500ms** (down from 2000–4000ms for HTML).
- API responses include `Cache-Control: private, max-age=1800`.

## Region Configuration

**Status:** Implemented

Configurable Audible region for accurate metadata matching across international stores.

**Supported Regions:**

| Code | Name | HTML baseUrl | apiBaseUrl | isEnglish |
|---|---|---|---|---|
| `us` | United States | `https://www.audible.com` | `https://api.audible.com` | true (default) |
| `ca` | Canada | `https://www.audible.ca` | `https://api.audible.ca` | true |
| `uk` | United Kingdom | `https://www.audible.co.uk` | `https://api.audible.co.uk` | true |
| `au` | Australia | `https://www.audible.com.au` | `https://api.audible.com.au` | true |
| `in` | India | `https://www.audible.in` | `https://api.audible.in` | true |
| `de` | Germany | `https://www.audible.de` | `https://api.audible.de` | false |
| `es` | Spain | `https://www.audible.es` | `https://api.audible.es` | false |
| `fr` | France | `https://www.audible.fr` | `https://api.audible.fr` | false |

**`AudibleRegionConfig` fields:** `code`, `name`, `baseUrl`, `apiBaseUrl`, `audnexusParam`, `language`.

**`isEnglish` flag:**
- Non-English regions show amber warning in region dropdowns (setup wizard + admin settings): "Many features such as search, discovery, and metadata matching are not yet fully supported for non-English regions."
- Dropdown options for non-English regions show `*` suffix.

**Why regions matter:**
- Each Audible region uses different ASINs for the same audiobook.
- Metadata engines (Audnexus / Audible Agent) in Plex / Audiobookshelf must match RMAB's region.

**Configuration:**
- Key: `audible.region` (stored in database)
- Default: `us`
- Set during: Setup wizard (Backend Selection step) or Admin Settings (Library tab)
- Auto-detection: Service checks config before each request and re-initializes if region changed.
- Cache clearing: Region change clears ConfigService cache and AudibleService state.
- Automatic refresh: Region change triggers `audible_refresh` job.

**Per-region HTTP clients (on init):**
- `apiClient` — `baseURL=apiBaseUrl`, `Accept: application/json`, `User-Agent: ReadMeABook/1.0`, no language/ipRedirect params.
- `htmlClient` — `baseURL=baseUrl`, browser headers, default params `ipRedirectOverride=true` + `language=<audibleLocaleParam>`. Used only by `audible-series.ts` and `getBaseUrl()`-based link generation.
- Audnexus calls include `region=<audnexusParam>`.

**Files:**
- Types: `src/lib/types/audible.ts`
- Service: `src/lib/integrations/audible.service.ts`
- Series (HTML): `src/lib/integrations/audible-series.ts`
- Config: `src/lib/services/config.service.ts`
- API: `src/app/api/admin/settings/audible/route.ts`

## Unified Matching (`audiobook-matcher.ts`)

**Status:** Production Ready (ASIN-Only Matching)

Single matching algorithm used everywhere (search, popular, new-releases, jobs).

**Process (Library Availability Checks):**
1. Query DB directly by ASIN (indexed O(1) lookup)
2. Check ASIN in dedicated field (100% confidence)
3. Check ASIN in plexGuid (backward compatibility)
4. Return match or null (no fuzzy fallback)

**Match Priority:**
- `findPlexMatch()`: ASIN (field) → ASIN (GUID) → null
- `matchAudiobook()`: ASIN → ISBN → null

**Note:** Fuzzy matching (70% threshold) is preserved in `ranking-algorithm.ts` for Prowlarr torrent ranking. Library availability checks require exact ASIN matches only.

## Database-First Approach

**Status:** Implemented

Discovery APIs serve cached data from DB with real-time matching.

**Flow:**
1. `audible_refresh` cron runs daily → fetches 200 popular + 200 new releases + user-configured categories via catalog API.
2. Downloads and caches cover thumbnails locally.
3. Stores metadata in `audible_cache`, ranked entries in `audible_cache_categories` with reserved IDs (`__popular__`, `__new_releases__`) and user category IDs.
4. Cleans up unused thumbnails after sync.
5. API routes query `AudibleCacheCategory` by categoryId → join with `AudibleCache` metadata → apply real-time matching → return enriched results.
6. Homepage loads instantly (no Audible API hits).

## Thumbnail Caching

**Status:** Implemented

Cover images cached locally to reduce external requests.

- Downloads covers during `audible_refresh` job.
- Stores in `/app/cache/thumbnails` (Docker volume).
- Serves via `/api/cache/thumbnails/[filename]`.
- Auto-cleanup of unused thumbnails.
- Falls back to original URL if cache fails.
- 24-hour browser cache headers.
- Filename: `{asin}.{ext}` (e.g. `B08G9PRS1K.jpg`).

**Files:**
- Service: `src/lib/services/thumbnail-cache.service.ts`
- API Route: `src/app/api/cache/thumbnails/[filename]/route.ts`
- Storage: Docker volume `cache` mounted at `/app/cache`

## App-Level API Endpoints

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
  authorAsin?: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  genres?: string[];
  series?: string;
  seriesPart?: string;
  seriesAsin?: string;
}

interface EnrichedAudibleAudiobook extends AudibleAudiobook {
  availabilityStatus: 'available' | 'requested' | 'unknown';
  isAvailable: boolean;
  plexGuid: string | null;
  dbId: string;
}

interface AudibleSearchResult {
  query: string;
  results: AudibleAudiobook[];
  totalResults: number;
  page: number;
  hasMore: boolean;
}

interface AuthorBooksResult {
  books: AudibleAudiobook[];
  hasMore: boolean;
  page: number;
  totalResults: number;
}
```

## Tech Stack

- `axios` (HTTP, two clients: `apiClient` for JSON catalog, `htmlClient` for series-page scraping only)
- Audnexus API (per-ASIN details, primary)
- PostgreSQL (`audible_cache`, `audible_cache_categories`)

## Fixed Issues

**Audiobookshelf metadata matching not respecting configured region (2026-01-28)**
- **Problem:** `triggerABSItemMatch()` hardcoded `'audible'` provider (audible.com) instead of respecting user's configured Audible region.
- **Impact:** Users with non-US regions (CA, UK, AU, IN) had incorrect metadata matching in Audiobookshelf, causing wrong ASINs.
- **Fix:** Added `mapRegionToABSProvider()` to convert RMAB region codes to Audiobookshelf provider values. US → `'audible'`, others → `'audible.{region}'` (e.g. `'audible.ca'`, `'audible.uk'`).
- **Location:** `src/lib/services/audiobookshelf/api.ts:14, 147`

**Non-English locale pages served to users outside US (2026-02-05)**
- **Problem:** Audible uses IP geolocation to serve locale-specific pages. `ipRedirectOverride=true` only prevents region redirects, NOT language/locale changes.
- **Impact:** Users self-hosting from non-English-speaking countries got non-English content on HTML-scraped surfaces.
- **Fix:** Added `language=<audibleLocaleParam>` default param on `htmlClient` (axios default params). Still in effect for the remaining HTML path (`audible-series.ts`). **Not applied to `apiClient`** — the catalog JSON API is region-bound via `apiBaseUrl` and does not require the language param.
- **Location:** `src/lib/integrations/audible.service.ts` — `initialize()` (htmlClient params)

## Related

- [Audiobookshelf Integration](./audiobookshelf.md)
- [Plex Integration](./plex.md)
- [Ranking Algorithm](../phase3/ranking-algorithm.md)
