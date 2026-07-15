# Intelligent Ranking Algorithm

**Status:** ✅ Implemented | Comprehensive edge case test coverage
**Tests:** tests/utils/ranking-algorithm.test.ts (80+ test cases)

Evaluates and scores torrents to automatically select best audiobook download.

## Test Coverage

**Comprehensive edge case testing includes:**
- ✅ Parenthetical/bracketed content handling (4 tests)
- ✅ Structured metadata prefix validation (5 tests)
- ✅ Suffix validation (5 tests)
- ✅ Multi-author handling (6 tests)
- ✅ Bonus modifiers (indexer priority + flags, 7 tests)
- ✅ Tiebreaker sorting (2 tests)
- ✅ Word coverage edge cases (4 tests)
- ✅ Format detection (5 tests)
- ✅ **Author presence check (10 tests)**
- ✅ **Context-aware filtering (3 tests)**
- ✅ **API compatibility (2 tests)**
- ✅ **CamelCase and punctuation separator handling (7 tests)**

**Tested edge cases prevent regressions from previous tweaks:**
- "We Are Legion (We Are Bob)" matching with/without subtitle
- "This Inevitable Ruin Dungeon Crawler Carl" NOT matching "Dungeon Crawler Carl"
- "The Housemaid's Secret" NOT matching "The Housemaid"
- Multiple author splitting and role filtering
- Flag bonus stacking and case-insensitive matching
- Tiebreaker sorting by publish date
- **"Project Hail Mary" (no author) NOT matching when Andy Weir required (automatic mode)**
- **All results shown in interactive mode regardless of author**
- **Middle initials, name order, and role filtering for author matching**

## Scoring Criteria (100 points max)

**1. Title/Author Match (60 pts max) - MOST IMPORTANT**

**Pre-Processing: Text Normalization**
- All titles and author names are normalized before matching
- **CamelCase splitting:** `"TheCorrespondent"` → `"the correspondent"`
- **Punctuation to spaces:** `"Twelve.Months-Jim"` → `"twelve months jim"`
- **Preserves apostrophes:** `"O'Brien"` remains `"o'brien"`
- Handles common indexer naming patterns (NZB, torrent scene releases)

**Examples of normalization:**
- `"VirginaEvans TheCorrespondent"` → `"virgina evans the correspondent"`
- `"Twelve.Months-Jim.Butcher"` → `"twelve months jim butcher"`
- `"Author_Name-Book.Title.2024"` → `"author name book title 2024"`

**Multi-Stage Matching:**

**Stage 1: Word Coverage Filter (MANDATORY)**
- Extracts significant words from request (filters stop words: "the", "a", "an", "of", "on", "in", "at", "by", "for")
- **Parenthetical/bracketed content is optional**: Content in () [] {} treated as subtitle (may be omitted from torrents)
  - "We Are Legion (We Are Bob)" → Required: ["we", "are", "legion"], Optional: ["bob"]
  - "Title [Series Name]" → Required: ["title"], Optional: ["series", "name"]
  - "Book Title {Extra Info}" → Required: ["book", "title"], Optional: ["extra", "info"]
- Calculates coverage: % of **required** words found in torrent title
- **Hard requirement: 80%+ coverage of required words or automatic 0 score**

**Stage 1.5: Author Presence Check (CONTEXT-AWARE)**
- **Automatic mode (requireAuthor: true - default):** At least ONE author must be present with high confidence
- **Interactive mode (requireAuthor: false):** Check disabled, all results shown to user
- **High confidence = any of:**
  1. Exact substring match: "dennis e. taylor" in torrent
  2. High fuzzy similarity (≥ 0.85): handles spacing/punctuation
  3. Core components present: First name + Last name within 30 chars
- Handles variations:
  - Middle initials: "Dennis E. Taylor" ↔ "Dennis Taylor"
  - Name order: "Brandon Sanderson" ↔ "Sanderson, Brandon"
  - Multiple authors: Only ONE needs to match (OR logic)
  - Filters roles: "translator", "narrator" ignored
- **If check fails in automatic mode → automatic 0 score**
- **Prevents wrong-author matches**: Stops "Project Hail Mary" (no author) from matching request for Andy Weir

**Edge Cases - Coverage Examples:**
- "The Wild Robot on the Island" → ["wild", "robot", "island"]
  - ✅ "The Wild Robot on the Island" → 3/3 = 100% → **PASSES**
  - ❌ "The Wild Robot" → 2/3 = 67% → **REJECTED**
- "We Are Legion (We Are Bob)" → Required: ["we", "are", "legion"]
  - ✅ "Dennis E. Taylor - Bobiverse - 01 - We Are Legion" → 3/3 = 100% → **PASSES**
  - ✅ "We Are Legion (We Are Bob)" → 3/3 = 100% → **PASSES**
- "Harry Potter and the Philosopher Stone" → ["harry", "potter", "philosopher", "stone"] (stop words filtered)
  - ✅ "Harry Potter Philosopher Stone" → 4/4 = 100% → **PASSES**
  - ❌ "Harry Potter" → 2/4 = 50% → **REJECTED**
- Prevents wrong series books from matching while handling common subtitle patterns

**Stage 2: Title Matching (0-45 pts)**
- Only scored if Stage 1 passes
- **Tries full title first, then required title (without parentheses)** if no match
  - Example: "We Are Legion (We Are Bob)" tries both full title and "We Are Legion"
  - Handles torrents that include subtitle AND those that omit it
- Complete title match requirements (both must be true):
  - **Acceptable prefix** (any of these):
    - No significant words before title (clean match)
    - Title preceded by metadata separator (` - `, `: `, `—`) — handles "Author - Series - 01 - Title"
    - Author name appears in prefix — handles "Author Name - Title"
  - **Acceptable suffix**: Followed by metadata markers: " by", " [", " -", " (", " {", " :", "," or end of string
    - Also accepts author name in suffix (e.g., "Title AuthorName Year")
- Complete match → 45 pts
- Unstructured prefix (words without separators) → fuzzy similarity (partial credit)
- Suffix continues with non-metadata → fuzzy similarity (partial credit)
- No substring match → fuzzy similarity (best score from full or required title)

**Edge Cases - Prefix Validation:**
- ✅ "Brandon Sanderson - Mistborn - 01 - The Final Empire" (structured metadata prefix)
- ✅ "Brandon Sanderson The Way of Kings" (author name in prefix)
- ✅ "Series Name: Book Title" (colon separator)
- ✅ "Author Name — Book Title" (em-dash separator)
- ❌ "This Inevitable Ruin Dungeon Crawler Carl" → REJECTED for "Dungeon Crawler Carl" (unstructured words before title)

**Edge Cases - Suffix Validation:**
- ✅ "The Great Book by Author Name" (metadata marker " by")
- ✅ "Book Title [Unabridged] (2024)" (bracketed metadata)
- ✅ "Book Title John Smith 2024" (author name in suffix)
- ✅ "Author - Book Title" (title at end of string)
- ❌ "The Housemaid's Secret - Freida McFadden" → REJECTED for "The Housemaid" (suffix continues with "'s Secret")

**Stage 3: Author Matching (0-15 pts)**
- Exact substring match → proportional credit
- No exact match → fuzzy similarity (partial credit)
- Splits authors on delimiters (comma, &, "and", " - ")
- Filters out roles ("translator", "narrator")
- Order-independent, no structure assumptions
- Ensures correct book is selected over wrong book with better format

**Edge Cases - Multi-Author Handling:**
- ✅ "Jane Doe, John Smith" → splits on comma
- ✅ "Jane Doe & John Smith" → splits on ampersand
- ✅ "Jane Doe and John Smith" → splits on "and"
- ✅ "Jane Doe, translator" → filters out "translator" role
- ✅ "Jane Doe, narrator" → filters out "narrator" role
- Proportional credit: If 1 of 3 authors matches → 5 pts (1/3 × 15)
- Proportional credit: If 2 of 3 authors match → 10 pts (2/3 × 15)
- Full credit: If all authors match → 15 pts

**2. Format Quality (10 pts max)**
- M4B with chapters: 10
- M4B without chapters: 9
- FLAC: 7 (lossless audio)
- M4A: 6
- MP3: 4
- Other: 1

**3. Seeder Count (15 pts max)**
- Formula: `Math.min(15, Math.log10(seeders + 1) * 6)`
- 1 seeder: 0pts, 10 seeders: 6pts, 100 seeders: 12pts, 1000+: 15pts
- Note: Usenet/NZB results without seeders get full 15 pts (centralized availability)

## Bonus Points System

**Extensible multiplicative bonus system** for external quality factors:

**Indexer Priority Bonus (configurable 1-25, default: 10)**
- Formula: `bonusPoints = baseScore × (priority / 25)`
- Priority 10/25 (40%) → 95 base score → +38 bonus = 133 final
- Priority 20/25 (80%) → 95 base score → +76 bonus = 171 final
- Priority 25/25 (100%) → 95 base score → +95 bonus = 190 final
- Ensures high-quality torrent from low-priority indexer beats low-quality from high-priority
- Bonus scales with quality (better torrents get more benefit from priority)

**Indexer Flag Bonus (configurable -100% to +100%, default: 0%)**
- Formula: `bonusPoints = baseScore × (modifier / 100)`
- Positive modifiers reward desired flags (e.g., "Freeleech" at +50%)
  - +50% modifier → 85 base score → +42.5 bonus = 127.5 final
- Negative modifiers penalize undesired flags (e.g., "Unwanted" at -60%)
  - -60% modifier → 85 base score → -51 penalty = 34 final
- Dual threshold filtering:
  - Base score must be ≥ minQualityScore (quality minimum; **admin-configurable**, default 50)
  - Final score must be ≥ minQualityScore (not disqualified by negative bonuses)
  - Title/author match gate (matchScore > 0) applies independently — even at threshold 0, wrong books are rejected
  - Configured via Indexers settings tab → keys `indexer.min_quality_score` (audiobook) / `indexer.min_quality_score_ebook` (ebook). See [settings-pages.md](../settings-pages.md#minimum-score-threshold-indexers-tab)
  - Automatic searches only; manual/interactive searches are never filtered
  - Negative bonuses can disqualify otherwise good torrents
- Flag extraction from Prowlarr API:
  - `downloadVolumeFactor: 0` → "Freeleech"
  - `downloadVolumeFactor: <1` → "Partial Freeleech"
  - `uploadVolumeFactor: >1` → "Double Upload"
- Case-insensitive, whitespace-trimmed matching
- Universal across all indexers (not indexer-specific)
- Multiple flag bonuses stack (additive)

**Edge Cases - Flag Matching:**
- ✅ "FREELEECH" matches config "freeleech" (case-insensitive)
- ✅ "  Freeleech  " matches config " Freeleech " (whitespace-trimmed)
- ✅ Multiple flags: ["Freeleech", "Double Upload"] → both bonuses applied
- Example stacking: Freeleech (+50%) + Double Upload (+25%) on 80 base score
  - Freeleech bonus: 80 × 0.5 = +40
  - Double Upload bonus: 80 × 0.25 = +20
  - Total bonus: +60 points
  - Final score: 80 + 60 = 140

**Future Modifiers (planned):**
- User preferences
- Custom rules

**Final Score Calculation:**
1. Calculate base score (0-100) using standard criteria
2. Calculate bonus modifiers (indexer priority, flag bonuses, etc.)
3. Sum bonus points
4. Final score = base score + bonus points
5. Apply dual threshold filter:
   - Base score ≥ 50 (quality minimum)
   - Final score ≥ 50 (not disqualified by negative bonuses)
6. Sort by final score (descending), then publish date (descending)

## Tiebreaker Sorting

When multiple torrents have identical final scores:
- **Secondary sort:** Publish date descending (newest first)
- Ensures latest uploads are preferred when quality is equal
- Example: 3 torrents with 171 final score → newest upload ranks #1

**Edge Cases - Tiebreaker Examples:**
- ✅ Same score, different dates:
  - Torrent A: Score 85, published 2024-06-01 → **Ranks #1**
  - Torrent B: Score 85, published 2023-01-01 → Ranks #2
- ❌ Different scores, ignore date:
  - Torrent A: Score 95, published 2020-01-01 → **Ranks #1** (better match wins despite older date)
  - Torrent B: Score 75, published 2024-01-01 → Ranks #2

## Interface

```typescript
interface IndexerFlagConfig {
  name: string;         // Flag name (e.g., "Freeleech")
  modifier: number;     // -100 to 100 (percentage)
}

interface RankTorrentsOptions {
  indexerPriorities?: Map<number, number>;  // indexerId -> priority (1-25)
  flagConfigs?: IndexerFlagConfig[];        // Flag bonus configurations
  requireAuthor?: boolean;                  // Enforce author check (default: true)
}

interface BonusModifier {
  type: 'indexer_priority' | 'indexer_flag' | 'custom';
  value: number;        // Multiplier (e.g., 0.4 for 40%)
  points: number;       // Calculated bonus points
  reason: string;       // Human-readable explanation
}

interface TorrentResult {
  // ... existing fields
  flags?: string[];     // Extracted flags from Prowlarr API
}

interface RankedTorrent extends TorrentResult {
  score: number;              // Base score (0-100)
  bonusModifiers: BonusModifier[];
  bonusPoints: number;        // Sum of all bonus points
  finalScore: number;         // score + bonusPoints
  rank: number;
  breakdown: {
    formatScore: number;
    seederScore: number;
    matchScore: number;
    totalScore: number;      // Same as score
    notes: string[];
  };
}

// New API (recommended)
function rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest,
  options?: RankTorrentsOptions
): RankedTorrent[];

// Legacy API (backwards compatible)
function rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest,
  indexerPriorities?: Map<number, number>,
  flagConfigs?: IndexerFlagConfig[]
): RankedTorrent[];
```

## Usage Examples

**Automatic selection (strict author filtering):**
```typescript
// Background job - safe auto-download
const ranked = rankTorrents(torrents, audiobook, {
  indexerPriorities,
  flagConfigs,
  requireAuthor: true  // Default - prevents wrong authors
});

const topResult = ranked[0];  // Safe to auto-download
```

**Interactive search (show all results):**
```typescript
// User browsing - let user decide
const ranked = rankTorrents(torrents, audiobook, {
  indexerPriorities,
  flagConfigs,
  requireAuthor: false  // Show everything, including edge cases
});

return ranked;  // User can see torrents without author info
```

## Ebook Torrent Ranking

The ranking algorithm also supports ebook torrents from indexers with ebook-specific scoring.

### Unified Code Architecture

Ebook ranking **reuses** the following from audiobook ranking:
- `scoreMatch()` - Title/author matching (60 pts)
- `scoreSeeders()` - Seeder count scoring (15 pts)
- Bonus modifier system (indexer priority, flag bonuses)
- Dual threshold filtering (base >= 50, final >= 50)

### Ebook-Specific Scoring

**Format Match (10 pts max)**
- 10 pts if torrent format matches preferred format
- 0 pts otherwise (no partial credit)
- Format detected from torrent title keywords: `.epub`, `.pdf`, `.mobi`, `.azw3`, etc.

**Size Quality (15 pts max, INVERTED)**
- < 5 MB: 15 pts (optimal for ebooks)
- 5-15 MB: 10 pts (may have images)
- 15-20 MB: 5 pts (large but acceptable)
- > 20 MB: **Filtered out** (too large for ebooks)

### Ebook vs Audiobook Comparison

| Component | Audiobook | Ebook |
|-----------|-----------|-------|
| Title/Author | 60 pts (reused) | 60 pts (reused) |
| Format | 10 pts (M4B > M4A > MP3) | 10 pts (match = 10, else 0) |
| Size | 15 pts (larger = better) | 15 pts (smaller = better) |
| Seeders | 15 pts (reused) | 15 pts (reused) |
| Size Filter | < 20 MB filtered | > 20 MB filtered |

### Ebook Interface

```typescript
interface EbookTorrentRequest {
  title: string;
  author: string;
  preferredFormat: string;  // 'epub', 'pdf', 'mobi', etc.
}

interface RankEbookTorrentsOptions {
  indexerPriorities?: Map<number, number>;
  flagConfigs?: IndexerFlagConfig[];
  requireAuthor?: boolean;  // Default: true
}

function rankEbookTorrents(
  torrents: TorrentResult[],
  ebook: EbookTorrentRequest,
  options?: RankEbookTorrentsOptions
): RankedEbookTorrent[];
```

### Ebook Usage Example

```typescript
// Ebook search from indexers
const ranked = rankEbookTorrents(prowlarrResults, {
  title: 'Project Hail Mary',
  author: 'Andy Weir',
  preferredFormat: 'epub',
}, {
  indexerPriorities,
  flagConfigs,
  requireAuthor: true,
});

const bestEbook = ranked[0];  // Safe to auto-download
```

## Tech Stack

- string-similarity (fuzzy matching)
- Regex for format detection
