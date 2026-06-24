# Series Bundle Decomposition

**Status:** ✅ Implemented | Detect multi-book series bundles at request time and fan out into per-book requests

## Overview
When a requested "audiobook" is actually a whole-series bundle (e.g. "Mistborn Trilogy", "The Complete Dune Saga", "Stormlight Archive, Books 1-3"), it is split into individual per-book audiobook requests instead of being downloaded as one item (which previously tended to fail organization). Detection happens **at request creation time**; the fan-out itself runs in a **background job** (`decompose_bundle`) so the originating request returns immediately. The bundle request itself is never created.

## Key Details
- **Detect:** `createRequestForUser()` in `src/lib/services/request-creator.service.ts`, right after Audnexus enrichment (so `seriesAsin` / `seriesPart` / `durationMinutes` are available). On a positive detection it enqueues a `decompose_bundle` job and returns a `decomposed` result immediately (no inline fan-out).
- **Fan out:** `decompose_bundle` job → `processDecomposeBundle` → `decomposeBundle()` enumerates the series and creates the per-book requests off the request thread. Offloaded because creating up to `MAX_BUNDLE_BOOKS` requests (each an Audnexus lookup + notification + search enqueue) inline would block the HTTP request and risk a client timeout for large box sets.
- **Split type:** Each book is a normal `audiobook` request (standard pipeline; ebook sidecar auto-grabs each if enabled).
- **Notify:** Auto — each split-out book fires its own `request_approved` / `request_pending_approval` notification (existing backends already subscribe). The bundle itself is not requested.
- **Recursion guard:** Split-out books are created with `bundleDecomposed: true`, which disables re-detection.

## Detection (`detectBundle`, `src/lib/services/series-bundle.service.ts`)
Pure heuristic. **Requires a `seriesAsin`** (without it there is nothing to enumerate → not a bundle).

| Signal | Result |
|--------|--------|
| `seriesPart` is a range (`"1-3"`) | Bundle; `range = [1,3]` |
| Title matches STRONG regex (`box set`, `omnibus`, `trilogy`, `the complete`, `complete series`, `books 1-3`, `volumes 1-3`, …) | Bundle; range from any title-embedded `Books X-Y` |
| Title matches WEAK regex (`collection`, `anthology`, `bundle`, `compendium`, `complete saga`) **AND** `durationMinutes ≥ 1800` (~30h) | Bundle |
| otherwise | Not a bundle |

## Enumeration (`enumerateSeriesBooks`)
- Scrapes the Audible series page(s) via `scrapeSeriesPage(seriesAsin, page)` (up to 5 pages).
- Maps each book to `{ asin, title, author, narrator, coverArtUrl }`.
- **Range narrowing:** when a range is known, keeps only books whose position (`seriesPart`, parsed from the "Book N" label on the series page) falls within it; books with an unknown position are excluded (avoid over-requesting).
- Excludes the bundle's own ASIN and nested bundle-looking items.
- De-dupes by ASIN; caps at `MAX_BUNDLE_BOOKS = 30`.

## Result Variant
`createRequestForUser` returns a new success variant (`DecomposedResult`) when a bundle is detected:
```ts
{ success: true; decomposed: true; count: number; books: { asin; title }[]; message: string }
```
- Returned **synchronously on detection**, before the fan-out runs, so `count = 0` / `books = []` and `message` says the split is happening in the background.
- `POST /api/requests` surfaces this as `{ success, decomposed: true, count, books, message }` (HTTP 201). The per-book requests appear in the list shortly after as the job completes.
- The fan-out itself (in `decomposeBundle`) returns a populated `DecomposedResult` with real `count` / `books`, logged by the job processor.
- Existing per-book dedup / library / ignore checks inside `createRequestForUser` make fan-out safe.

## Fallback
- If the `decompose_bundle` job can't be enqueued (e.g. Redis down), `createRequestForUser` logs an error and falls through to creating the bundle as a single normal request.
- If detection fires but enumeration yields no books (series page unscrapeable), the job logs a warning and creates the bundle as a single normal request (`bundleDecomposed: true`), matching the pre-async behaviour.

## Limitations
- Requires a resolvable `seriesAsin` (from Audnexus). No `seriesAsin` ⇒ no decomposition.
- Range narrowing depends on parsing per-book positions off the series page; unparseable positions are skipped.

## Technical Files
- `src/lib/services/series-bundle.service.ts` — `detectBundle`, `enumerateSeriesBooks`
- `src/lib/services/request-creator.service.ts` — detection + enqueue, `decomposeBundle` orchestration, `DecomposedResult` variant
- `src/lib/processors/decompose-bundle.processor.ts` — `decompose_bundle` job processor (background fan-out)
- `src/lib/services/job-queue.service.ts` — `addDecomposeBundleJob`, `DecomposeBundlePayload`
- `src/lib/integrations/audible-series.ts` — `parseSeriesBooks` captures `seriesPart` position
- `src/app/api/requests/route.ts` — decomposed response
- `tests/services/series-bundle.test.ts`

## Related
- [Audible Integration](../integrations/audible.md) — series scraping
- [E-book Support](../integrations/ebook-sidecar.md) — per-book ebook auto-grab
