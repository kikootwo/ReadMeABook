# Audible Language Filter

**Status:** ✅ Implemented (#259) | Admin setting, off by default; hides other-language editions

## Overview
One setting (Library tab, Plex and Audiobookshelf) that keeps Audible results in the configured region's language. Off: every list and pick, and every search, series and home-row response, is the same as before the setting existed (`GET /api/admin/settings` adds `audibleLanguageFilter: false`).

## Setting
- **Key:** `audible.language_filter` (`'true'` / `'false'`; absent = off). Category `system`.
- **Read:** `ConfigurationService.getAudibleLanguageFilter()` through the 60 s config cache; `isLanguageFilterOn()` (`src/lib/integrations/audible-language-filter.ts`) treats a failed read as off.
- **Write:** `PUT /api/admin/settings/audible` `{ region, languageFilter? }`. `languageFilter` must be a boolean (else 400 `languageFilter must be true or false`, nothing written); omitted keeps the stored value. Clears the cache for both keys. Jobs run in the same `node server.js` process, so they see the change at once.
- **GET** `/api/admin/settings` → `audibleLanguageFilter: boolean`.
- **UI:** `AudibleLanguageFilterOption.tsx`, label `Only show books in {Language}` from `AUDIBLE_REGIONS[region].language` → `LANGUAGE_DISPLAY_NAMES`.

## Rule
- `partitionByLanguage(items, languageOf, config)` (`language-config.ts`) → `{kept, hidden}` via `keepsLanguage`: accepted language, or no language / blank, is kept.
- Accepted values per language: `acceptedLanguageValues` in `LANGUAGE_CONFIGS` (case-insensitive; catalog values like `english`, storefront labels like `Deutsch`). A variant Audible spells differently is hidden until added there.
- Language = the region's language (`REGION_LANGUAGE_MAP`), not the user's locale.

## Callers (filter on)
| Caller | Effect | Result field |
|---|---|---|
| `audibleService.search()` | products partitioned; `hasMore` from the raw page | `languageFilter {language, hiddenCount, firstResultHidden}` |
| `GET /api/audiobooks/search` | flattens the field | `hiddenCount`, `filterLanguage` (display name) |
| `scrapeSeriesPage()` (`audible-series.ts`) | counts, `hasMore` and the drift warning from raw rows, then filters | `rawCount`, `languageFilter` |
| `GET /api/series/[asin]` | strips `rawCount`; flattens | `hiddenCount`, `filterLanguage` |
| `searchSeries()` (`audible-series-search.ts`) | other-language products dropped before aggregation | `languageFilter.hiddenCount` = distinct series all of whose products were hidden |
| `GET /api/series/search` | flattens | `hiddenCount`, `filterLanguage` |
| Watched series scan (`watched-lists.service.ts`) | loop stops on `rawCount === 0`; `MAX_BOOKS_PER_SERIES` counts raw rows; every row hidden → `lastCheckedAt` updated, logged as hidden, nothing requested | none |
| Home rows (`audible-refresh.processor.ts`) | popular, new releases and category rows filtered before save | none |
| BookDate (`bookdate/helpers.ts`), shelf sync (`shelf-sync-core.service.ts`) | `pickSearchMatch()` single pick (below) | none |

- Off: none of the fields above is present (`hiddenCount` absent, not 0).
- `searchForSeries(query, { languageFilter })` reads the setting itself when the option is undefined; ranking (`aggregateSeries`) keeps its own seam. Off: every series kept, accepted-language series ranked first (unchanged).
- **Opt-out:** `search(query, page, { ignoreLanguageFilter: true })`. Bulk import scan uses it. Requests made from a book page (ASIN known) are never filtered; no request is blocked by ASIN.

## Single pick (BookDate, shelf sync)
- `pickSearchMatch(search, requestedTitle)`. Off: `results[0]` (unchanged).
- On, raw first product in an accepted language or with none listed (`firstResultHidden` false): `results[0]`, no title check (as off).
- On, raw first product in another language: first later result whose language is **explicitly** accepted (no-language results do not count) AND `matchShare(title + subtitle, requested title without its last trailing parenthetical group) >= SINGLE_PICK_TITLE_SHARE` (0.8, bulk import's bar).
- None → BookDate returns null for that recommendation; shelf sync records `noMatch`.
- Shelf sync's retry without `(Series, #n)` runs only when the search found nothing (no results, none hidden), as off.
- Translated-title editions (e.g. `Das Lied der Krähen` for `Six of Crows` on audible.de, first result English) become no-match.

## Paging UI
- `useSearch` (`useAudiobooks.ts`): a page with 0 visible, `hasMore`, and `hiddenCount` present loads the next page by itself, at most `MAX_AUTO_PAGE_LOADS` (4) in a row; the counter resets on a new query and on a Load more click; a query change ends the chain.
- Search, series detail: 0 visible with `hasMore` → `LanguageHiddenNote` ("N in other languages hidden") + `LoadMoreBar` with `emptyText` (`No results in {Language} so far` / `No books in {Language} so far`).
- Empty and done: `No results in {Language} for "q"`, `No books in {Language} found for {title}`, `/series`: `No series in {Language} for "q"`.
- `hiddenCount` on search and series detail is summed over loaded pages.
- "Nothing in the language yet" (bar, language empty messages) reads the list before hide-available; when hide-available empties it, the usual `No results found` / `No books found` shows.
- Series detail, on: header and bar count the books shown (`2 titles`, `2 books loaded`); Audible's `bookCount` (all languages) is not shown there.

## Limits
- **Shared `BookMapping`:** shelf sync matches are per provider and book, not per user. A match made before the filter was turned on stays and serves every user's shelf.
- **BookDate cache-first match:** reads `AudibleCache` (home-row cache, no language column, never pruned). A cached hit from before the filter was turned on is used as is.
- **Home rows:** language from the row's `.languageLabel` (`Sprache: Deutsch` → `Deutsch`, text after the colon). Seen on audible.de `/adblbestsellers` (50/50 rows, 2026-10-27). A row without the label is kept.
- **Home rows below 200:** the filter runs after the 200-row scrape, so a row loses its hidden books and is not topped up (no extra requests).
- **Turning it off:** a `noMatch` recorded while on is retried after `NO_MATCH_RETRY_DAYS` (7).
- No schema change; release ranking and import are untouched.

## Related
[audible.md](audible.md#region-configuration), [audible-series-search.md](audible-series-search.md), [../settings-pages.md](../settings-pages.md), [../features/bookdate.md](../features/bookdate.md), [../backend/services/goodreads-sync.md](../backend/services/goodreads-sync.md), [../features/watched-lists.md](../features/watched-lists.md), [../features/home-sections.md](../features/home-sections.md), [../features/bulk-import.md](../features/bulk-import.md)
