# Audible Integration

**Status:** Implemented | Hybrid — curated HTML for discovery refresh + Audible JSON catalog API for user-facing real-time + Audnexus for per-ASIN details

## Overview

Audiobook metadata for discovery, search, and detail pages. Split by access pattern:

- **Nightly discovery refresh** (popular / new releases / category lists) — scraped from Audible's **curated HTML storefronts** (`www.audible.<tld>/adblbestsellers`, `/newreleases`, `/search?node=<id>`). The HTML pages reflect Audible's own editorial picks.
- **User-facing real-time** (search, author books, categories listing, per-ASIN details) — Audible's unauthenticated public **JSON catalog API** (`api.audible.<tld>/1.0/catalog/*`).
- **Per-ASIN detail lookups** — Audnexus (`api.audnex.us/books/{asin}`) primary; catalog API used as fallback when Audnexus returns 404.

## Architecture

- **Curated HTML (refresh job only):** the three methods called solely by `audible-refresh.processor.ts` (`getPopularAudiobooks`, `getNewReleases`, `getCategoryBooks`) scrape Audible's storefront HTML to inherit editorial curation. Beefed-up retry/backoff knobs (12 retries, 3-min jittered cap) handle 503 storms patiently on the nightly job without slowing healthy users.
- **JSON catalog API (real-time):** `search`, `searchByAuthorAsin`, `getCategories` (categories listing), and `fetchAudibleDetailsFromApi` (per-ASIN fallback). Same endpoint used by the official Audible mobile apps. No authentication, no API key, no user credentials, no special headers.
- **Audnexus (per-ASIN):** `getAudiobookDetails` and `getRuntime` prefer Audnexus, with catalog API fallback for `getAudiobookDetails`.
- **`www.audible.<tld>`:** Used by HTML refresh scraping, by `audible-series.ts`, and by `getBaseUrl()` for "View on Audible" link generation.

## Data Sources

### Nightly refresh (HTML — `htmlClient`, baseURL `www.audible.<tld>`)

| Operation | Endpoint | Key params |
|---|---|---|
| Popular | `/adblbestsellers` | `pageSize=50`, `page=<n>` (omitted on first page) |
| New releases | `/newreleases` | `pageSize=50`, `page=<n>` (omitted on first page) |
| Category books | `/search` | `node=<categoryId>&pageSize=50&sort=popularity-rank&page=<n>` |

Parsed via cheerio. Selectors: `.productListItem` (popular/new releases), `.s-result-item, .productListItem` (categories).

### Real-time (JSON catalog API — `apiClient`, baseURL `api.audible.<tld>`)

| Operation | Endpoint | Key params |
|---|---|---|
| Search | `/1.0/catalog/products` | `keywords=<q>` |
| Author books | `/1.0/catalog/products` | `author=<name>` (name, NOT ASIN) |
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

- **Catalog API cannot filter preorders or surface curated bestsellers.** The API's `BestSellers` sort is a right-now velocity rank that spikes on launch-day promos and preorder windows; the `-ReleaseDate` sort returns 100% future preorders. There is no server-side `release_time`, `released-only`, `customer_rights`, or alternate sort (`Reviewed`, `MostListened`, etc.) — every plausible variant was tested and silently ignored. This is why the nightly refresh job uses the curated HTML storefront pages instead.
- **`author=` takes a name, not an ASIN.** The catalog API has no ASIN-based author param. `searchByAuthorAsin()` queries by name, then filters client-side: keeps only products where `products[].authors[].asin === authorAsin`. Preserves ASIN-authoritative author identity. Also filters by `product.language` via `isAcceptedLanguage()` for the configured region.
- **Invalid ASIN returns HTTP 200 with stub body.** `/1.0/catalog/products/{asin}` responds 200 with `{product: {asin: INPUT}}` and no other fields. `fetchAudibleDetailsFromApi()` detects this via missing `product.title` and returns `null`.
- **`publisher_summary` is HTML.** Service strips tags via inline `stripHtml()` helper (regex-based, no cheerio) before populating `description`. Falls back to `merchandising_summary` (plain text) if `publisher_summary` missing.
- **Series is an array.** `products[].series[]` — a book may belong to multiple series. Service picks the first entry with non-empty `sequence`, else the first entry. `sequence` is cleaned by extracting first `/\d+(?:\.\d+)?/` match for numeric ordering.
- **Stub `product_images`:** cover URL reads from `product_images['500']`; missing keys fall back to `undefined`.
- **`page` is 0-indexed (catalog API only).** Despite the default value appearing to be 1, the API returns items `(page * num_results)` through `((page + 1) * num_results - 1)`. So `page=1` fetches items 51–100, not 1–50. All catalog-API service methods accept a 1-indexed `page` and subtract 1 at the axios call. The symptom of getting this wrong is silent: queries whose `total_results ≤ num_results` return an empty `products` array while `total_results` is populated (e.g. author searches for small catalogues). HTML paths use Audible's native 1-indexed `page` query param and omit it on the first page.

## Rate Limiting & Resilience

- **Real-time JSON API paths:** 503s are uncommon. `fetchWithRetry()` uses jittered exponential backoff, 5 retries, retries on 503/429/5xx. API responses include `Cache-Control: private, max-age=1800`.
- **Nightly HTML refresh paths:** 503s are more likely (HTML storefront is more rate-sensitive). Same `fetchWithRetry()`, but with `HTML_MAX_RETRIES=12` and `HTML_MAX_BACKOFF_MS=180_000` (3-minute cap on jittered backoff). Healthy refreshes still complete fast (per-page success on attempt 0); users hit by sustained 503 storms grind through patiently rather than abandoning the refresh.
- **`AdaptivePacer`** — inter-page delay 2–4 s baseline, scales up multiplicatively under retry pressure, with a 45–60 s circuit-breaker cooldown after 3 consecutive retry-pages.
- **Per-batch cooldowns** in `audible-refresh.processor.ts` — 15–30 s between popular/new-releases, 10–20 s between categories.

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
- `apiClient` — `baseURL=apiBaseUrl`, `Accept: application/json`, `User-Agent: ReadMeABook/1.0`, no language/ipRedirect params. Used for the real-time JSON catalog operations (search, author books, categories listing, per-ASIN details fallback).
- `htmlClient` — `baseURL=baseUrl`, rotating browser headers (`pickUserAgent` + `getBrowserHeaders`), default params `ipRedirectOverride=true` + `language=<audibleLocaleParam>`. Used by the nightly discovery refresh (`/adblbestsellers`, `/newreleases`, `/search?node=...`), by `audible-series.ts`, and by `getBaseUrl()`-based link generation.
- Audnexus calls include `region=<audnexusParam>`.

**Files:**
- Types: `src/lib/types/audible.ts`
- Service: `src/lib/integrations/audible.service.ts`
- Series (HTML): `src/lib/integrations/audible-series.ts` (fetch/orchestration), `src/lib/integrations/audible-series-parsers.ts` (Cheerio parsing)
- Config: `src/lib/services/config.service.ts`
- API: `src/app/api/admin/settings/audible/route.ts`

## Series Page Dual Layout

**Status:** ✅ Handled | Audible A/B-serves two different `/series/{asin}` layouts per request

Roughly 40% of requests return the **modern** layout, the rest **legacy**. The same URL flips between them request-to-request. All parsers in `audible-series-parsers.ts` try modern first, then fall back to legacy. The layouts are disjoint — a modern page contains zero legacy markers and vice versa.

| Field | Modern | Legacy |
|-------|--------|--------|
| Books | `<adbl-product-row>` inside `#series-titles` | `<li class="productListItem">` / `.bc-list-item` |
| Book metadata | `<script type="application/json">` per row: `{authors[{name,url}], narrators[{name}], duration, language, releaseDate, rating{value,count}}` | scraped from `.authorLabel` / `searchNarrator=` anchors / `.runtimeLabel` / `.ratingsLabel` |
| Book count | `<span slot="child">4 books in series</span>` | `"4 books"` span text |
| Series rating | `<adbl-star-rating slot="rating" value count>` | `div.bc-review-stars[aria-label]` + `span.series-rating` |
| Description | `#series-about adbl-text-block` (read `<p>` only — `[slot="title"]` is a heading) | `.bc-expander-content` |
| Cover | first row's `adbl-product-image img` | `.productListItem img` |
| Tags, similar series | `adbl-chip.related-tag`, `adbl-product-carousel#SeriestoSeries` (identical in both) | same |

**Critical:** carousel content describes *other* series. `outsideCarousel()` excludes `adbl-product-carousel` descendants from book-count, rating, cover and row selection — the "Listeners also enjoyed" carousel carries its own `slot="child-count"` values.

Modern rows yield strictly richer data (`releaseDate`, `language`, real narrator arrays, author ASIN). `parseSeriesBooks()` returns legacy results only when zero modern rows parse.

`scrapeSeriesPage()` logs a warning when the header reports books but zero rows parse — that signals Audible changed its markup again.

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

## Dedup & Works Table

**Status:** ✅ Implemented | Two-pass dedup on every discovery view + cross-batch identity via works table

Discovery views (search, author books, series detail) collapse duplicate Audible listings for the same recording (publisher re-listings, regional re-issues, full-cast vs single-narrator productions) into a single card. Two passes run in sequence:

1. **Local pass — `deduplicateAndCollectGroups()`** (`src/lib/utils/deduplicate-audiobooks.ts`)
   - Stateless, in-memory. Keys books by normalized title + sorted narrator set + duration (±max(5%, 10 min) tolerance), with subtitle compatibility to keep distinct series entries separate.
   - Picks a canonical representative per group by `metadataScore()` (cover + rating + duration + description + narrator + release date + genres).
   - Emits `DedupGroup[]` describing every multi-ASIN collapse → handed to `persistDedupGroups()` for the works table.

2. **Works pass — `collapseByExistingWorks()`** (`src/lib/services/works.service.ts`)
   - Async DB lookup. Reads `work_asins` for every ASIN in the local-passed list and collapses any books sharing a `workId` to one representative (same `metadataScore()` ranking).
   - Catches duplicates the local pass misses: source-metadata divergence (e.g. HTML scraper captured different narrators), cross-page splits (paginated series), or non-matching field shapes.
   - Degrades gracefully — returns the input unchanged on DB failure (view still renders).

### Works Table Schema
- `Work { id, title, author }` — one row per logical book
- `WorkAsin { id, workId, asin, narrator?, durationMinutes?, isCanonical, source, createdAt }` — many ASINs per Work

### Population Layers
- **Layer 1 (auto):** `persistDedupGroups()` writes whenever the local pass finds a duplicate. Merges across pre-existing works when a new group spans them.
- **Layer 2 (seed):** `seedAsin()` writes a single-ASIN work at request creation time, ensuring every requested ASIN has an entry to grow from.

### Read Paths
- **`collapseByExistingWorks()`** — view-level collapse (this section).
- **`getSiblingAsins()`** — library availability matching (`audiobook-matcher.ts`), request-creation duplicate prevention (`request-creator.service.ts`), ignored-audiobook expansion. Returns sibling ASINs grouped by input ASIN.

### Narrator Capture in HTML Scrapers
- HTML scrapers (`audible-series.ts`, the two `parse*Items` parsers in `audible.service.ts`) capture **all** narrator anchors via `extractAllNarrators()` (`src/lib/utils/extract-narrator.ts`). Multi-narrator productions render each name as its own `<a href="?searchNarrator=...">` link; capturing only the first (prior bug) made co-narrated audiobooks fail to dedup. Order is not significant — `normalizeNarrator()` sorts before comparison.

### Wired Routes
- `src/app/api/audiobooks/search/route.ts`
- `src/app/api/authors/[asin]/books/route.ts`
- `src/app/api/series/[asin]/route.ts`

Watched-list background jobs (`watched-lists.service.ts`) run the local pass only — they don't render a view, and the downstream `request-creator.service.ts` already does sibling-aware dedup at request creation time.

## Database-First Approach

**Status:** Implemented

Discovery APIs serve cached data from DB with real-time matching.

**Flow:**
1. `audible_refresh` cron runs daily → fetches 200 popular + 200 new releases + user-configured categories by scraping Audible's curated HTML storefronts (`/adblbestsellers`, `/newreleases`, `/search?node=<id>&sort=popularity-rank`).
2. Downloads and caches cover thumbnails locally.
3. Stores metadata in `audible_cache`, ranked entries in `audible_cache_categories` with reserved IDs (`__popular__`, `__new_releases__`) and user category IDs.
4. Cleans up unused thumbnails after sync.
5. API routes query `AudibleCacheCategory` by categoryId → join with `AudibleCache` metadata → apply real-time matching → return enriched results.
6. Homepage loads instantly (no Audible HTTP hits at request time).

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
  language?: string;
  formatType?: string;
  publisherName?: string;
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

- `axios` (HTTP, two clients: `apiClient` for JSON catalog API, `htmlClient` for HTML refresh + series scraping)
- `cheerio` (HTML parsing for refresh job and `audible-series.ts`)
- Audnexus API (per-ASIN details, primary)
- PostgreSQL (`audible_cache`, `audible_cache_categories`)

## Fixed Issues

**Series pages intermittently empty — blank cover, correct count, no books (2026-08-11)**
- **Problem:** Loading a series showed a blank cover and the right book count in the card, but an empty "Books in Series" table. Refreshing a few times fixed it. Logs showed `Series detail complete: "..." (0 books)` alternating with `(4 books)` for the same ASIN seconds apart.
- **Root cause:** Audible A/B-serves two different `/series/{asin}` layouts. `parseSeriesBooks` only matched the legacy `.productListItem` / `.bc-list-item` markup; the modern layout renders books as `<adbl-product-row>` web components and contains **zero** legacy classes. Probing one URL 12× returned the modern layout 5 times. The header (`h1`, book-count span) parses identically in both, which is why the count stayed correct while the list emptied. Same cause silently dropped `coverArtUrl`, `rating`, `ratingCount` and `description`.
- **Scope:** series pages only — `/search`, `/author/` and `/adblbestsellers` returned legacy markup on 6/6 probes each.
- **Fix:** Extracted all Cheerio parsing into `audible-series-parsers.ts` and made every parser modern-first with legacy fallback. Modern rows read their embedded JSON blob (structured narrators, author ASIN, duration, rating, releaseDate), so they carry more data than the legacy path. Added `outsideCarousel()` so similar-series carousel values can't be mistaken for this series', and a layout-drift warning when the header reports books but no rows parse.
- **Location:** `src/lib/integrations/audible-series-parsers.ts` (new); `src/lib/integrations/audible-series.ts` (now fetch/orchestration only); `tests/integrations/audible-series-parsers.test.ts` (new, dual-layout parity tests).

**Series-page duplicates not collapsing across user views (2026-05-14)**
- **Problem:** Two re-listings of the same audiobook (same title, same narrator set, same duration, different ASINs) showed as two cards on series detail pages, even after the works table had already linked them via search-page dedup.
- **Root cause (two-part):** (1) HTML scrapers used `$el.find('a[href*="searchNarrator="]').first()` for multi-narrator productions, capturing only the first co-narrator. So two listings of the same recording landed in `deduplicateAndCollectGroups` with mismatched single-narrator strings and never merged. (2) `deduplicateAndCollectGroups` was stateless — it wrote to the works table but never read it back, so even when one path (e.g. search) successfully merged two ASINs and persisted the Work, every other path (series, author books) re-derived the dedup decision from scratch and split them again.
- **Fix:** (1) New `extractAllNarrators()` helper (`src/lib/utils/extract-narrator.ts`) captures every `searchNarrator=` anchor and joins them; all three HTML scrapers route through it. (2) New `collapseByExistingWorks()` consults the works table after the local pass and collapses any remaining books sharing a `workId`. Wired into the three user-facing discovery routes (search / author books / series detail). Skipped for watched-list background jobs — those feed `request-creator.service.ts` which already does sibling-aware dedup.
- **Location:** `src/lib/utils/extract-narrator.ts` (new); `src/lib/integrations/audible-series.ts` (parseSeriesBooks); `src/lib/integrations/audible.service.ts` (parseProductListItems + parseSearchResultItems); `src/lib/utils/deduplicate-audiobooks.ts` (`metadataScore` exported); `src/lib/services/works.service.ts` (`collapseByExistingWorks` added); three API routes updated.

**Discovery refresh reverted to curated HTML scraping (2026-05-14)**
- **Problem:** After switching all catalog ops to the JSON catalog API in `f564d0a`, the nightly discovery refresh (Popular / New Releases / user-configured Categories) started serving junk: New Releases became 100% preorders out to 2027, and Popular was dominated by launch-day no-name shovelware.
- **Root cause:** `products_sort_by=BestSellers` is a right-now sales velocity rank that spikes on launch promos and preorder windows; `-ReleaseDate` returns all catalog items in date order with no released-only filter. The catalog API exposes no server-side filter to exclude preorders or sort by established popularity (verified by exhaustively testing `release_time`, `availability_status`, `customer_rights`, `Reviewed`/`MostListened`/`SalesRank` sorts — all silently ignored or rejected). Doing the curation client-side would have made RMAB the editorial curator, which Audible's storefront pages already do well.
- **Fix:** Hybrid architecture — the three refresh-only methods (`getPopularAudiobooks`, `getNewReleases`, `getCategoryBooks`) went back to scraping Audible's curated HTML storefronts (`/adblbestsellers`, `/newreleases`, `/search?node=<id>&sort=popularity-rank`). All user-facing real-time paths (search, author books, categories listing, per-ASIN details) stayed on the JSON catalog API. To keep the higher-503-risk HTML traffic resilient on the unattended nightly job, `fetchWithRetry()` accepts an optional `maxBackoffMs` cap and HTML callers use `HTML_MAX_RETRIES=12` + `HTML_MAX_BACKOFF_MS=180_000` (3-min cap). Healthy users finish quickly; 503-blocked users grind through patiently.
- **Location:** `src/lib/integrations/audible.service.ts` (three methods + two private parsers `parseProductListItems` / `parseSearchResultItems`); `src/lib/utils/scrape-resilience.ts` (`jitteredBackoff` cap parameter).

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
