# Design: Enhance English Language Filtering and Subtitle Search

## Architecture Overview

```mermaid
sequenceDiagram
    participant Worker as Search Indexers Processor
    participant Prowlarr as Prowlarr Integration Service
    participant Ranker as Ranking Algorithm

    Worker->>Prowlarr: searchWithVariations(title, author)
    Prowlarr->>Prowlarr: Pass 1: "${title} ${author}"
    Prowlarr->>Prowlarr: Pass 2: "${title}"
    Prowlarr->>Prowlarr: Pass 3: Subtitle-cleaned main title (before :)
    Prowlarr-->>Worker: Merged & Deduplicated Results
    Worker->>Ranker: rankTorrents(results, { requireAuthor: true, targetLanguage: 'en' })
    Ranker->>Ranker: Apply Non-English & Language Course Penalties (-100)
    Ranker-->>Worker: Ranked English Releases Only
```

## Component Specification

### 1. `src/lib/integrations/prowlarr.service.ts`
- `searchWithVariations(title, author)` executes 3 query passes:
  1. `${title} ${author}`
  2. `${title}`
  3. `${mainTitle}` (subtitle removed before `:` or ` - `)

### 2. `src/lib/utils/ranking-algorithm.ts`
- Detects non-English tags (`[German]`, `Hörbuch`, `[French]`, `Livre Audio`, `[Spanish]`, `Audiolibro`).
- Detects language course tags (`Pimsleur`, `Learn Spanish`, `Berlitz`).
- Applies -100 penalty when `targetLanguage === 'en'`.
