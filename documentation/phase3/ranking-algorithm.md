# Intelligent Ranking Algorithm

**Status:** ✅ Implemented | Comprehensive edge case test coverage
**Tests:** tests/utils/ranking-algorithm.test.ts, ranking-non-latin.test.ts, ranking-match-gates.test.ts, ranking-oracle-223.test.ts, match-gates.test.ts, match-normalize.test.ts, tests/processors/search-indexers-non-latin.test.ts
**Automatic-search gates (#223):** [match-gates.md](match-gates.md): one-word titles, required numbers, author whole words, volume conflict (title-only subset of #330)

Evaluates and scores torrents to automatically select best audiobook download.

## Scoring Criteria (100 points max)

**1. Title/Author Match (60 pts max) - MOST IMPORTANT**

**Pre-Processing: Text Normalization**
- All titles and author names are normalized before matching
- **CamelCase splitting:** `"TheCorrespondent"` → `"the correspondent"`
- **Punctuation to spaces:** `"Twelve.Months-Jim"` → `"twelve months jim"`
- **Apostrophes fold** (`foldApostrophes`, #466): `' ’ ‘ ‛` count as one; before an English ending (`s t d m ll re ve`) dropped, else a space. `Ender's` → `enders` (matches `Enders.Game`), `L'intruse` → `l intruse` (matches `L.Intruse`), `O'Brien` → `o brien`. Same in `foldForMatching`, so Stage 2 marker lookups agree. **Release side** (`keepUnrequestedApostrophes`, run first in `scoreMatch` and in the Prowlarr fallback check): a release word with an apostrophe ending folds only when the request writes that word with one (`apostropheEndingWords`); otherwise the apostrophe stays as `ꞌ` (U+A78C, a Latin letter), so the word stays whole and matches no plain word, as before #316. `The Lover's Dictionary` does not match "The Lovers"; `Enders.Game` and `Ender's Game` match "Ender's Game"; G3 author names allow a trailing `ꞌs` like `'s`
- Handles common indexer naming patterns (NZB, torrent scene releases)
- **Every script kept** (`src/lib/utils/match-normalize.ts`): letters, marks and digits of any script survive (`\p{L}\p{M}\p{N}`); everything else becomes a space
- **Other consumers:** Bulk Import grouping keys (`src/lib/utils/bulk-import-keys.ts`) are built with `normalizeForMatching`, so a change here shifts which files group as one book ([bulk-import.md](../features/bulk-import.md)); keys drop every non-letter, so the apostrophe fold leaves them unchanged. Series search match share (`src/lib/integrations/audible-series-rank.ts`): apostrophe titles now match either spelling (`enders game` → "Ender's Game" 0.5 → 1)
- **Folds:** accents (NFD, drop U+0300–036F, NFC; Greek tonos and Cyrillic ё/й fold too), Greek ς→σ, fullwidth ASCII → ASCII, `ø→o æ→ae œ→oe ß→ss ł→l đ ð→d þ→th ı→i ħ→h`; emoji presentation selectors (U+FE00–FE0F, U+E0100–E01EF, keycap U+20E3) dropped
- **CJK/Thai next to ASCII** gets a space: `哈利波特与魔法石Harry` → `哈利波特与魔法石 harry`, `三体2` → `三体 2`, `ラブストーリー2` → `ラブストーリー 2` (Script_Extensions, so shared marks like `ー` count)
- **Accepted changes vs. before #424 (Latin):** ø now behaves like ö, so `Bjørn` no longer matches `Bjoern` (`Björn`/`Bjoern` never did); non-ASCII letters or digits in a Latin title (π, µ, α, ², º, ʻ) are now part of it, so `The Joy of π` no longer matches `The Joy of Pi`
- **Known limits, fail closed:** spacing that differs inside a name (`村上 春樹` vs `村上春樹`; Korean names written without spaces vs with them); Simplified vs Traditional (`刘`/`劉`); Arabic/Persian letter variants (hamza forms `أ إ آ`/`ا`, taa marbuta `ة`/`ه`, `ی ک`/`ي ك`); vowel marks (Arabic harakat, Hebrew niqqud) must match exactly; halfwidth katakana, Roman-numeral (`Ⅲ`) and ligature (`ﬁ`) characters are not folded; no transliteration (`村上春樹` doesn't match `Haruki Murakami`); initials in non-Latin scripts don't join (`А. С. Пушкин` vs `АС Пушкин`)
- **Known limits, score lower:** a bilingual release with the non-Latin title first (`Гарри Поттер … / Harry Potter …`) still matches a Latin request but loses the complete-title bonus; CJK title markers `「」` don't earn that bonus; a one-character title (`心`) often lands under the automatic threshold unless the release name is plain (`夏目漱石 - 心`)
- **Known limit, too loose:** a 2-character CJK title inside the author's name (`春樹` / `村上春樹`) passes coverage; the author gate and scoring limit the impact

**Examples of normalization:**
- `"VirginaEvans TheCorrespondent"` → `"virgina evans the correspondent"`
- `"Twelve.Months-Jim.Butcher"` → `"twelve months jim butcher"`
- `"Author_Name-Book.Title.2024"` → `"author name book title 2024"`

**Multi-Stage Matching:**

**Stage 1: Word Coverage Filter (MANDATORY)**
- Extracts significant words from request (filters stop words: "the", "a", "an", "of", "on", "in", "at", "by", "for")
- **Parenthetical/bracketed content is optional**: Content in () [] {} 【】 (and fullwidth （）［］｛｝, folded first) treated as subtitle (may be omitted from torrents); so is text after `:` or `：`
  - "We Are Legion (We Are Bob)" → Required: ["we", "are", "legion"], Optional: ["bob"]
  - "Title [Series Name]" → Required: ["title"], Optional: ["series", "name"]
  - "Book Title {Extra Info}" → Required: ["book", "title"], Optional: ["extra", "info"]
- Calculates coverage: % of **required** words found in torrent title
- **Hard requirement: 80%+ coverage of required words or automatic 0 score**
- Numbers fold for coverage (`01` = `1`, one to twenty, `t01`); automatic mode also requires every number of the required title (G4a, [match-gates.md](match-gates.md))
- **Scripts without spaces** (Han, kana, Thai, Lao, Khmer, Myanmar): a required word of 2+ characters counts if it appears anywhere in the release name (`刘慈欣三体全集` covers `三体`); a 1-character word must be a whole word; all other words need an exact word
- **Fail closed:** a title that normalizes to nothing scores 0; a required part that normalizes to nothing (`★ (Star Stories)`) uses the whole title's words

**Stage 1.5: Author Presence Check (CONTEXT-AWARE)**
- **Automatic mode (requireAuthor: true - default):** At least ONE author must be present with high confidence
- **Interactive mode (requireAuthor: false):** Check disabled, all results shown to user
- **High confidence = any of:**
  1. Whole words: "dennis e. taylor" in torrent; `'s`/`s`, glued (`leechild`) allowed; substring only for unspaced-script names, CJK and Thai (G3)
  2. High fuzzy similarity (≥ 0.85): handles spacing/punctuation
  3. Core components present: First name + Last name as whole words within 30 chars
  4. Initials match: runs of 2+ single letters collapsed on both sides, then matched as whole words (`src/lib/utils/author-initials.ts`)
     - ✅ "TJ Klune" ↔ "T J Klune", "J D Robb" ↔ "JD Robb", "J.K. Rowling" ↔ "JK Rowling"
     - ❌ "E. L. James" vs "Michael James", "A. J. Smith" vs "Raj Smith" (no partial-word match)
     - Digits never join ("Book 1 T J Klune" → "book 1 tj klune"); a lone initial is untouched ("J. Smith" ≠ "John Smith")
     - Pure OR on top of checks 1-3; never rejects anything they accept
     - Known, accepted collision: any two-letter word right before the surname equals the same initials (a first name like "Al Smith" ↔ "A. L. Smith", or a word like "Possession as Byatt" ↔ "A. S. Byatt"); only matters when the title (80% coverage) and the surname also match
- Handles variations:
  - Middle initials: "Dennis E. Taylor" ↔ "Dennis Taylor"
  - Name order: "Brandon Sanderson" ↔ "Sanderson, Brandon"
  - Multiple authors: Only ONE needs to match (OR logic)
  - Filters roles: "translator", "narrator" ignored; names under 3 characters dropped unless in a non-Latin script (`金庸`, `한강` kept)
- **If check fails in automatic mode → automatic 0 score**
- An author that normalizes to nothing (emoji, punctuation) is ignored; none left → rejected in automatic mode
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
- Complete title match requirements (both must be true; markers are found in a folded copy of the release name that keeps punctuation, `foldForMatching`, so `Jo Nesbø - Snømannen [MP3]` counts):
  - **Acceptable prefix** (any of these):
    - No significant words before title (clean match)
    - Title preceded by metadata separator (` - `, `: `, `—`) — handles "Author - Series - 01 - Title"
    - Author name appears in prefix — handles "Author Name - Title"
  - **Acceptable suffix**: Followed by metadata markers: " by", " [", " -", " (", " {", " :", "," or end of string
    - Also accepts author name in suffix (e.g., "Title AuthorName Year")
- Complete match → 45 pts
- `Title: Subtitle` counts as complete only when the subtitle agrees with the request's (G1); one-word titles and volume conflicts: [match-gates.md](match-gates.md) (G4b, G4c)
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
- Whole-word or initials match → proportional credit (G2, G3)
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
  - Base score must be ≥ 50 (quality minimum)
  - Final score must be ≥ 50 (not disqualified by negative bonuses)
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

## Fixed Issues
- **#466 (apostrophe rows):** `L.Intruse…` for "L'intruse", `Changer.L.Eau.Des.Fleurs…`, `Enders.Game…` for "Ender's Game" scored 0 at word coverage (the apostrophe was kept in the word). Fixed by the apostrophe fold; pinned in `tests/utils/ranking-match-gates.test.ts`. Subtitles after `. ` / ` - ` (same issue) still open
- **Known limit:** a release that splits an English ending (`Ender.s.Game`) misses `enders` (on main only a request with a curly `’` matched it)
- **Known limit:** a request written without the apostrophe ("Enders Game") does not match `Ender’s Game` (as on main): a release possessive needs the apostrophe in the request, so "The Titans" never matches `The Titan's Curse`

## Tech Stack

- string-similarity (fuzzy matching)
- Regex for format detection
