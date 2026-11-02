# Audible Series Search

**Status:** ✅ Implemented | Series search on the Audible JSON catalog API (one keyword call + one batch call), with a real error state

## Overview
`/series` page search. `GET /api/series/search?q=` → `searchForSeries()` finds series through the catalog API (`api.audible.<tld>`), never the `www` storefront. The series detail page (`/series/{asin}`) still scrapes HTML ([audible.md](./audible.md)).

## Flow
- Page `src/app/series/page.tsx` (500 ms debounce, trimmed query) → `useSeriesSearch` (`src/lib/hooks/useSeries.ts`) → route `src/app/api/series/search/route.ts` → `searchForSeries(query, { languageFilter })` (`src/lib/integrations/audible-series-search.ts`, re-exported by `audible-series.ts`) → ranking in `audible-series-rank.ts`.
- Calls go through `AudibleService.fetch(url, config, { catalog: true })`: one attempt on `apiClient`, error rethrown; the caller owns retries.

## Catalog calls
| Call | Params | Budget | On failure |
|---|---|---|---|
| Keyword | `/1.0/catalog/products` `keywords=<q>`, `num_results=50`, `response_groups=series,media,product_attrs,category_ladders` | `SERIES_SEARCH_KEYWORD_PROFILE`: 5 s for the whole call, ≤1 retry | `SeriesSearchUnavailableError` → route **502** |
| Batch (book counts) | same path, `asins=<ranked series ASINs, ≤15>`, `num_results=<n>`, `response_groups=relationships,product_attrs` | `SERIES_SEARCH_BATCH_PROFILE`: 3 s, no retry | warn log, every `bookCount` 0 (badge hidden), results still returned |

- **Budget:** `catalogBudget(ms)` (`audible-series-fill.ts`, beside `catalogDeadline`): one `AbortController` + `setTimeout` per call shared by its attempts; each attempt's axios `timeout` = time left. Differs from `catalogDeadline` (fresh `AbortSignal.timeout` per config) because it spans retries and fake timers can drive it.
- **Retry rule (keyword only):** 429, 5xx, or a network error that is not an abort/timeout (`isAbort`: `ERR_CANCELED`, `ECONNABORTED`, `ETIMEDOUT`, `CanceledError`/`TimeoutError`/`AbortError`); signal not fired; ≥1.5 s left after a 250-500 ms pause. Never after a timeout, abort, 401/403/404 or other 4xx.
- **Worst case:** ~8 s for the route (5 s + 3 s), was 15-46 s of `/search` retries.
- A 200 without a `products` array → `SeriesSearchUnavailableError('unexpected response')`.
- Region and base URL are read **after** the keyword call (it initializes the service).

## Aggregation & ranking (`audible-series-rank.ts`)
- Every `products[].series[]` entry counts (not `pickCatalogSeries`); entries without `asin` or `title` skipped; a product counts once per series.
- **Match share:** query words via `normalizeForMatching(text, characterReplacements)`, region `stopWords` dropped unless nothing else is left; share = words found as whole title words (`isWordInTitle`, CJK substring rule); the last word may also be a prefix ("expeditionary fo").
- **Sort:** match share desc → language tier (series with ≥1 product passing `keepsLanguage`) → product count desc → first-seen index asc. Cap `MAX_SERIES_RESULTS = 15`. Share-0 series stay, below every match (author/book-title queries).
- **Language filter seam (#352):** `languageFilter: true` drops products failing `keepsLanguage` before aggregation. The route passes nothing today (no setting yet); the admin language filter wires in here: `{ languageFilter: await getConfigService().getAudibleLanguageFilter() }`.

## Card fields (`SeriesSummary`)
| Field | Source |
|---|---|
| `asin`, `title` | keyword `series[]` entry |
| `coverArtUrl` | `product_images['500']` of the accepted-language product with the lowest `sequence`, then first seen, then any product |
| `bookCount` | batch `relationships` where `relationship_to_product='child'` and `relationship_type='series'` (unique ASINs); 0 if the batch fails, lacks relationships or omits the series. Never a keyword-page hit count |
| `tags` | leaf node of each member product's `category_ladders`, most frequent first, max 5 (differs from the detail page's HTML chips) |
| `rating`, `ratingCount` | never set: the catalog's series rating is unreliable (one 5-star rating reads 5.0) and book ratings are not averaged |
| `audibleUrl` | `${baseUrl}/series/${asin}` |

## Route
- `200 {success, series, query}`; `400` empty/whitespace query; `401` no user; `502 {error:'AudibleUnavailable', message:"Audible didn't return series results. Try again in a moment."}` on `SeriesSearchUnavailableError`; `500 {error:'SearchError'}` otherwise.

## Client
- `useSeriesSearch`: trims the query, no request for whitespace-only input, `shouldRetryOnError: false`, returns `error` (`FetchJSONError`, `status` from `fetchJSON`), `hasData`, `retry` (`mutate()`).
- Page shows `SeriesSearchError` when `error && !isLoading && !hasData`: 502 → "Couldn't get results from Audible" + "Audible didn't return series results. Try again in a moment."; any other status → "Series search failed". Try again (≥44 px) reruns once; after a failed user retry focus returns to the button.

## Tests
- `tests/integrations/audible-series-search.test.ts`, `audible-series-search-ranking.test.ts`, `audible-service-catalog-fetch.test.ts`; `tests/api/series-search.route.test.ts`; `tests/app/series.page.test.tsx`; fake service `tests/helpers/fake-audible-catalog.ts`.
- Fixtures `tests/fixtures/audible-catalog/` (trimmed recordings, 2026-10-26): US keywords "expeditionary force" (50 products, 18 series), UK keywords "cosmere" (29 English, 19 Spanish, 2 none; 14 series), US batch of 3 series (EF 22, DCC 8, Mavericks 2 children).
- e2e: `e2e/specs/regressions/450-series-search-error.spec.ts` ([e2e-harness.md](../testing/e2e-harness.md)).

## Fixed Issues
**Series search waits ~40 s, then shows "No series found" (#450, 2026-10-26)**
- **Problem:** Series search answered "No series found" after a ~40 s spinner for users whose `www.audible.<tld>/search` requests got 503.
- **Root cause:** `searchForSeries` scraped the `/search` HTML page (+ up to 15 `/series/{asin}` pages) with 5 retries each; the failure was swallowed into `200 []` and the page never read `error`.
- **Fix:** catalog keyword + batch calls on a short budget, 502 on failure, an error panel with Try again, no automatic client retries. `seriesLabels` removed from the language config (no reader left).
- **Changes visible on cards:** no series rating; tags are catalog genres; the book count badge only when the catalog lists the series' books.

## Related: [audible.md](./audible.md), [frontend/components.md](../frontend/components.md)
