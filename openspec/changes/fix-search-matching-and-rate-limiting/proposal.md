# Proposal: Multi-Pass Search Engine, Title Normalizer, and Indexer Rate-Limiter

## Why
Currently, `search-indexers.processor.ts` uses single-pass exact matching with strict `requireAuthor: true` and a hardcoded minimum score floor of `50`. This causes widespread search failures:
1. **Multi-Author Rejection:** Books with multiple listed authors (e.g., *"Larry Correia, Jonathan Maberry, Faith Hunter, Jim Butcher"*) fail indexer lookups because indexers release files under the primary author alone.
2. **Subtitle & Parenthetical Pollution:** Titles containing edition tags like `"(Dramatized Adaptation)"`, `"(Unabridged)"`, or `"[Full-Cast Edition]"` fail exact keyword queries on indexers.
3. **Prowlarr 60s Timeout Crashes:** Rapid unthrottled concurrent search jobs flood Prowlarr/NZBHydra2 HTTP sockets, triggering `Failed to search Prowlarr: timeout of 60000ms exceeded`. ReadMeABook currently misclassifies 60s timeouts as "0 results found", returning requests to `awaiting_search` without exponential backoff.

## What Changes
1. **Title Normalization Engine:** Automatically strip parenthetical and bracketed edition tags (`(Dramatized Adaptation)`, `[Unabridged]`, etc.) from indexer search queries while preserving original metadata in PostgreSQL.
2. **Primary Author Isolator:** Automatically extract the primary author (before commas, "and", "&") for indexer queries while maintaining multi-author records for display.
3. **Multi-Pass Search Pipeline:** Implement a 3-tier fallback search strategy:
   - *Pass 1:* Cleaned Title + Primary Author (`requireAuthor: true`, score floor: 40)
   - *Pass 2:* Cleaned Title + Primary Author (`requireAuthor: false`, score floor: 35)
   - *Pass 3:* Cleaned Core Title Only (`requireAuthor: false`, Levenshtein distance check)
4. **Prowlarr Queue Rate-Limiter & Concurrency Ceiling:** Configure Bull queue worker rate-limiting (max 10 active concurrent Prowlarr searches, 500ms delay between requests) and apply exponential backoff on HTTP 504/timeout errors.

## Capabilities

### User Capabilities
- Administrators can configure minimum match score floors and search fallback strategies via the Web UI Admin Settings.
- Administrators can view detailed search attempt diagnostics and match scores for each indexer result.

### System Capabilities
- The search engine automatically matches multi-author books, dramatized adaptations, and edition suffixes without manual query intervention.
- The Prowlarr integration operates safely within indexer rate limits and automatically retries failed socket timeouts using exponential backoff.

## Impact & Non-Goals
- **Impact:** Increases backlog search match success rate from ~20% to >85% while eliminating indexer HTTP 60s timeout crashes.
- **Non-Goals:** Does not alter external Prowlarr indexer configurations; operates purely within ReadMeABook's search processor pipeline.
