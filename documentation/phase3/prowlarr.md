# Prowlarr Integration

**Status:** ✅ Implemented | Manual search, interactive search, automatic search

Indexer aggregator for searching multiple torrent/usenet indexers simultaneously. Supports manual search, interactive torrent selection, and automatic RSS feed monitoring.

## API

**Base:** `http://prowlarr:9696/api/v1`
**Auth:** `X-Api-Key` header
**Connection settings:** `getProwlarrConnection()` (`src/lib/integrations/prowlarr-connection.ts`): `prowlarr_url` → `PROWLARR_URL` → `http://prowlarr:9696`; `prowlarr_api_key` → `PROWLARR_API_KEY`
**Download links:** results carry proxy links `<prowlarr>/{indexerId}/download?apikey=…&link=…`. The key is stripped before results reach the browser and only re-sent to that path shape on the configured origin ([download-clients.md](./download-clients.md#source-fetch--prowlarr-key-scoping))

**GET /search?query={q}&categories=3030&indexerIds={ids}** - Search indexers (3030 = audiobooks, ids = comma-separated indexer IDs)
**GET /indexer** - List configured indexers
**GET /indexerstats** - Indexer statistics
**GET /feed/{indexerId}/api?t=search&cat=3030&limit=100** - RSS feed for specific indexer

## Search Strategy

**Search Query:** `searchWithVariations(title, author, filters, { exactTitle })` (`src/lib/integrations/prowlarr.service.ts`, query helpers in `prowlarr-query-variations.ts`)
- First pass, per indexer group, sequentially: `"title author"` then `"title"`; results merged and deduplicated by guid
- The second query runs even when the first returns results; a failed query is logged and skipped
- Blank author (or both queries identical after trimming, ignoring case) → `"title"` once; a blank query is never sent
- **Fallback pass (#316):** only when the first pass returned nothing that names the title (no result holds 80% of the title's words before its subtitle; close to ranking's Stage 1 coverage, with apostrophes and numbers folded the same way, but always with English stop words, and a number's `. ` also starts a subtitle, where ranking splits at `:` only). Variations, each as `"variation author"` then `"variation"`, skipping any query already sent; stops at the first query whose results name the title:
  1. Stripped: only when a word has punctuation inside it; apostrophes fold (`Anarchist's` → `Anarchists`, `L'intruse` → `L intruse`), other punctuation → space (`Op-Center` → `Op Center`)
  2. Subtitle-free: text before the first `:` or a number's `. ` (`Primal Hunter 1. Une aventure` → `Primal Hunter 1`), stripped too when needed; none when nothing is left (`: Title`) or the base has under 3 letters and digits and no non-Latin letter (`Re:Zero` sends no `Re`; `三体` is sent)
- No fallback when `exactTitle` or when every first-pass query failed. `exactTitle`: the request's `customSearchTerms` (automatic search, interactive search); a title edited in interactive search on a request (`customTitle`), on the ebook routes, and with no request (`POST /api/audiobooks/search-torrents` body `exactTitle: true`, sent by the modal when the title differs from the book's)
- Used by every indexer search: audiobook automatic, manual and interactive search, and ebook automatic and interactive search
- `"title author"` finds the right book when a short or common title fills `maxResults`; `"title"` keeps the broad net for indexers that miss the combined query
- Custom title replaces `title`; the request's author is still sent. Automatic search: the request's custom search terms. Interactive: `customTitle` from the body (audiobook interactive search also falls back to custom search terms; ebook interactive routes do not)
- Ranking algorithm filters out mismatches using author/narrator
- **Cost:** 2 Prowlarr searches per indexer group per search, 1 with a blank author (matters for indexers with daily API caps). Fallback pass: up to 4 more, only after a first pass that found nothing usable

**Extended Search:** Enabled (`extended=1`) - searches title, tags, labels, and metadata fields

**Result Filtering:**
- Minimum score threshold: 50/100
- Filters applied after ranking to remove poor matches
- Ensures at least basic title/author match quality
- Audiobook searches rank the full deduplicated result set, then retain the best 100
- Audiobook interactive responses expose `truncated` and the pre-ranking `rawCount`
- Ebook interactive routes (`audiobooks/[asin]/interactive-search-ebook`, `requests/[id]/interactive-search-ebook`) return every ranked result: no cap, no `truncated`/`rawCount`

**Example:** "Season of Storms" by "Andrzej Sapkowski" → queries "Season of Storms Andrzej Sapkowski" + "Season of Storms" → ranks by author match → filters score < 50

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
- Searches only enabled indexers (title + author, then title)
- Ranks all results, filters scores < 50
- Retains the best 100 qualifying results after ranking
- Selects best torrent from filtered results
- Updates request status to 'pending'

**Interactive Search** (`POST /api/requests/{id}/interactive-search`)
- Returns ranked torrent results for user selection
- Searches only enabled indexers (title + author, then title; custom title replaces the title)
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
**XML parsing:** fast-xml-parser with `htmlEntities: true` (also Goodreads RSS) so numeric references (`&#39;`, `&#x27;`, `&#233;`) and a short list of named entities (`&nbsp;`, dashes, curly quotes, `&hellip;`, currency, `&copy;`/`&reg;`/`&trade;`) decode in titles/authors; other named entities (`&eacute;`) stay as-is. A decoded `&nbsp;` (U+00A0) counts as a space in title matching (regex `\s`). Pinned in `tests/integrations/xml-entity-decoding.test.ts`
**Process:**
1. Fetch RSS feeds from all indexers with RSS enabled
2. Fuzzy match results against requests in 'awaiting_search' status
3. Trigger search jobs for matches
4. Limit: 100 results per feed, 100 missing requests per check

**Matching Logic:**
- Author name must appear in torrent title
- At least 2 title words (>2 chars) must match
- First match triggers search job (no duplicates)

## Fixed Issues
- **#316:** titles with an apostrophe ("The Dungeon Anarchist's Cookbook") found nothing on indexers whose names drop it. Fallback pass sends the stripped title; ranking folds apostrophes (#466). Includes PR #304's subtitle-free query (colon split, guarded against an empty base, custom terms left intact)

## Tech Stack

- axios
- bottleneck (rate limiting)
