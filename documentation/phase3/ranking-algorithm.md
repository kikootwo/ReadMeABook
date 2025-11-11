# Intelligent Ranking Algorithm

## Current State

**Status:** Not Implemented

The ranking algorithm evaluates and scores torrent results to automatically select the best audiobook download.

## Design Architecture

### Ranking Criteria

The algorithm considers multiple factors with weighted scoring:

**1. Format Quality (40 points max)**
- M4B with chapters: 40 points (best)
- M4B without chapters: 35 points
- M4A: 25 points
- MP3: 15 points
- Other formats: 5 points

**Why M4B?**
- Native audiobook format
- Built-in chapter support
- Better compression than MP3
- Single file (easier to manage)
- Native iOS/iPod support

**2. Seeder Count (25 points max)**
- Logarithmic scaling for seeders
- Formula: `Math.min(25, Math.log10(seeders + 1) * 10)`
- 1 seeder: 0 points
- 10 seeders: 10 points
- 100 seeders: 20 points
- 1000+ seeders: 25 points

**3. Size Reasonableness (20 points max)**
- Expected size: ~1-2 MB per minute of audio
- Too small: Low quality or incomplete
- Too large: Excessive quality or includes extras
- Formula: Based on deviation from expected size

**4. Title Match Quality (15 points max)**
- Fuzzy match against requested title/author
- Uses Levenshtein distance
- Bonus for narrator name match
- Penalty for obvious mismatches

**Total Score: 100 points maximum**

## Implementation Details

### Algorithm Interface

```typescript
interface RankingAlgorithm {
  // Rank all torrents and return sorted by score
  rankTorrents(
    torrents: TorrentResult[],
    audiobook: AudiobookRequest
  ): RankedTorrent[];

  // Get detailed scoring breakdown for a torrent
  getScoreBreakdown(
    torrent: TorrentResult,
    audiobook: AudiobookRequest
  ): ScoreBreakdown;
}

interface RankedTorrent extends TorrentResult {
  score: number;
  rank: number;
  breakdown: ScoreBreakdown;
}

interface ScoreBreakdown {
  formatScore: number;
  seederScore: number;
  sizeScore: number;
  matchScore: number;
  totalScore: number;
  notes: string[];
}
```

### Scoring Implementation

```typescript
function scoreFormat(torrent: TorrentResult): number {
  const format = detectFormat(torrent.title);

  switch (format) {
    case 'M4B':
      return torrent.hasChapters !== false ? 40 : 35;
    case 'M4A':
      return 25;
    case 'MP3':
      return 15;
    default:
      return 5;
  }
}

function scoreSeeders(seeders: number): number {
  if (seeders === 0) return 0;
  return Math.min(25, Math.log10(seeders + 1) * 10);
}

function scoreSize(size: number, durationMinutes: number): number {
  if (!durationMinutes) return 10; // Neutral score if unknown

  // Expected size: 1-2 MB per minute (64-128 kbps)
  const minExpected = durationMinutes * 1024 * 1024; // 1 MB/min
  const maxExpected = durationMinutes * 2 * 1024 * 1024; // 2 MB/min

  if (size >= minExpected && size <= maxExpected) {
    return 20; // Perfect size
  }

  // Calculate deviation penalty
  const deviation = size < minExpected
    ? (minExpected - size) / minExpected
    : (size - maxExpected) / maxExpected;

  return Math.max(0, 20 - deviation * 20);
}

function scoreMatch(
  torrent: TorrentResult,
  audiobook: AudiobookRequest
): number {
  const title = torrent.title.toLowerCase();
  const requestTitle = audiobook.title.toLowerCase();
  const requestAuthor = audiobook.author.toLowerCase();

  // Title similarity (0-10 points)
  const titleSimilarity = stringSimilarity(requestTitle, title) * 10;

  // Author presence (0-5 points)
  const hasAuthor = title.includes(requestAuthor) ? 5 : 0;

  return Math.min(15, titleSimilarity + hasAuthor);
}
```

### Selection Logic

```typescript
async rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest
): Promise<RankedTorrent[]> {
  const ranked = torrents.map((torrent) => {
    const formatScore = scoreFormat(torrent);
    const seederScore = scoreSeeders(torrent.seeders);
    const sizeScore = scoreSize(torrent.size, audiobook.durationMinutes);
    const matchScore = scoreMatch(torrent, audiobook);

    const totalScore = formatScore + seederScore + sizeScore + matchScore;

    return {
      ...torrent,
      score: totalScore,
      rank: 0, // Will be assigned after sorting
      breakdown: {
        formatScore,
        seederScore,
        sizeScore,
        matchScore,
        totalScore,
        notes: generateNotes(torrent, totalScore),
      },
    };
  });

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  // Assign ranks
  ranked.forEach((r, index) => {
    r.rank = index + 1;
  });

  return ranked;
}
```

## Tech Stack

**String Similarity:** string-similarity package
**Format Detection:** Regular expressions
**Logging:** Winston for decision logging

## Dependencies

**NPM Packages:**
- string-similarity (fuzzy matching)

**Internal:**
- TorrentResult interface
- AudiobookRequest interface
- Logging service

## Usage Examples

### Rank and Select Best Torrent

```typescript
const ranker = new RankingAlgorithm();

const ranked = await ranker.rankTorrents(searchResults, {
  title: 'Foundation',
  author: 'Isaac Asimov',
  durationMinutes: 600, // 10 hours
});

const bestTorrent = ranked[0];
console.log(`Selected: ${bestTorrent.title}`);
console.log(`Score: ${bestTorrent.score}/100`);
console.log('Breakdown:', bestTorrent.breakdown);

// Log top 5 for admin review
ranked.slice(0, 5).forEach((r) => {
  console.log(`#${r.rank}: ${r.title} - ${r.score} points`);
});
```

### Get Score Breakdown

```typescript
const breakdown = ranker.getScoreBreakdown(torrent, audiobook);

console.log(`Format: ${breakdown.formatScore}/40`);
console.log(`Seeders: ${breakdown.seederScore}/25`);
console.log(`Size: ${breakdown.sizeScore}/20`);
console.log(`Match: ${breakdown.matchScore}/15`);
console.log(`Total: ${breakdown.totalScore}/100`);

breakdown.notes.forEach(note => console.log(`- ${note}`));
```

## Testing Strategy

### Unit Tests
- Test each scoring function independently
- Test with edge cases (0 seeders, huge files, etc.)
- Test sorting and ranking logic
- Verify score totals are correct

### Integration Tests
- Test with real Prowlarr search results
- Verify best torrents are selected logically
- Compare algorithm choices with manual selection

### Example Test Cases

```typescript
describe('Ranking Algorithm', () => {
  it('should prefer M4B over MP3', () => {
    const m4b = createMockTorrent({ format: 'M4B', seeders: 10 });
    const mp3 = createMockTorrent({ format: 'MP3', seeders: 10 });

    const ranked = ranker.rankTorrents([m4b, mp3], mockAudiobook);

    expect(ranked[0].title).toBe(m4b.title);
  });

  it('should prefer more seeders when formats equal', () => {
    const highSeeders = createMockTorrent({ format: 'M4B', seeders: 100 });
    const lowSeeders = createMockTorrent({ format: 'M4B', seeders: 5 });

    const ranked = ranker.rankTorrents([highSeeders, lowSeeders], mockAudiobook);

    expect(ranked[0].seeders).toBe(100);
  });

  it('should penalize unreasonable file sizes', () => {
    const normal = createMockTorrent({ size: 600 * 1024 * 1024 }); // 600 MB for 10hr book
    const tiny = createMockTorrent({ size: 50 * 1024 * 1024 }); // 50 MB (too small)
    const huge = createMockTorrent({ size: 5 * 1024 * 1024 * 1024 }); // 5 GB (too large)

    const ranked = ranker.rankTorrents([normal, tiny, huge], {
      ...mockAudiobook,
      durationMinutes: 600,
    });

    expect(ranked[0].size).toBe(normal.size);
  });
});
```

## Performance Considerations

**Complexity:** O(n log n) where n = number of torrents
**Memory:** Minimal (only stores scoring data)
**Speed:** Can rank 100 torrents in <10ms

## Known Issues

*This section will be updated during implementation.*

## Future Enhancements

- **User preferences**: Allow users to prefer MP3 over M4B
- **Blacklist**: Exclude specific uploaders/groups
- **Quality profiles**: High quality (larger files) vs. Low quality (smaller files)
- **Machine learning**: Learn from user cancellations and retries
- **Release group reputation**: Track which groups provide best quality
- **Partial matching**: Handle different editions (unabridged vs. abridged)
