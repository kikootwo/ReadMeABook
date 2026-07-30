# Design: Multi-Pass Search Engine, Title Normalizer, and Indexer Rate-Limiter

## Architecture & Search Pipeline

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Search Indexers Processor                       │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 1. Metadata Normalizer                                           │  │
│  │    - Title Cleaner: strip (Dramatized Adaptation), [Unabridged]  │  │
│  │    - Primary Author Isolator: "Author A, Author B" -> "Author A" │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  ┌──────────────────────────────────▼───────────────────────────────┐  │
│  │ 2. Multi-Pass Fallback Search Strategy                           │  │
│  │    Pass 1: Cleaned Title + Primary Author (requireAuthor: true)  │  │
│  │    Pass 2: Cleaned Title + Primary Author (requireAuthor: false) │  │
│  │    Pass 3: Cleaned Core Title Only + Levenshtein Distance Check  │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  ┌──────────────────────────────────▼───────────────────────────────┐  │
│  │ 3. Prowlarr Rate-Limiter & Backoff Engine                        │  │
│  │    - Bull Worker Concurrency Ceiling (Max: 10)                   │  │
│  │    - Request Pacing Interval (Delay: 500ms)                      │  │
│  │    - Exponential Backoff on HTTP 504/Timeout                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Title Normalizer & Author Isolator (`src/lib/utils/search-cleaner.ts`)
```typescript
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*\([^)]*(?:dramatized|unabridged|abridged|edition|full-cast|graphic|audiobook)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:dramatized|unabridged|abridged|edition|full-cast|graphic|audiobook)[^\]]*\]/gi, '')
    .trim();
}

export function extractPrimaryAuthor(author: string): string {
  if (!author) return '';
  const first = author.split(/,| and | & /i)[0];
  return first ? first.trim() : author.trim();
}
```

### 2. Multi-Pass Processor (`src/lib/processors/search-indexers.processor.ts`)
- If Pass 1 returns 0 results or scores below floor (40), Pass 2 executes with `requireAuthor: false`.
- If Pass 2 returns candidates, candidate titles are verified against original title using Levenshtein distance $\le 3$.
- Results are saved to `download_history` table with matching confidence score and pass identifier.

### 3. Prowlarr Rate Limiter (`src/lib/integrations/prowlarr.service.ts`)
- Bull queue worker options configured with:
  ```typescript
  limiter: {
    max: 10,
    duration: 1000
  }
  ```
- Axios HTTP client configured with retry interrupter: HTTP 504 / 60s timeout raises `TransientNetworkError` triggering Bull job exponential retry (`attempts: 3, backoff: { type: 'exponential', delay: 2000 }`).

## Test & Validation Plan
1. **Title Normalizer Unit Tests:** Test title cleaning on 20 common Audiobook title strings (`"Mistborn (Dramatized Adaptation)"` $\rightarrow$ `"Mistborn"`).
2. **Multi-Author Test:** Search for multi-author request. Verify primary author is isolated and indexer query succeeds.
3. **Prowlarr Concurrency Test:** Enqueue 50 concurrent search jobs. Verify Prowlarr active connections do not exceed 10 and 0 socket timeout exceptions occur.
