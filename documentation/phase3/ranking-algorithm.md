# Intelligent Ranking Algorithm

**Status:** ❌ Not Implemented

Evaluates and scores torrents to automatically select best audiobook download.

## Scoring Criteria (100 points max)

**1. Format Quality (40 pts max)**
- M4B with chapters: 40
- M4B without chapters: 35
- M4A: 25
- MP3: 15
- Other: 5

**2. Seeder Count (25 pts max)**
- Formula: `Math.min(25, Math.log10(seeders + 1) * 10)`
- 1 seeder: 0pts, 10 seeders: 10pts, 100 seeders: 20pts, 1000+: 25pts

**3. Size Reasonableness (20 pts max)**
- Expected: 1-2 MB/min (64-128 kbps)
- Deviation from expected → penalty

**4. Title Match Quality (15 pts max)**
- Fuzzy match: title + author (Levenshtein distance)
- Narrator bonus

## Interface

```typescript
interface RankedTorrent extends TorrentResult {
  score: number;
  rank: number;
  breakdown: {
    formatScore: number;
    seederScore: number;
    sizeScore: number;
    matchScore: number;
    totalScore: number;
    notes: string[];
  };
}

function rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest
): RankedTorrent[];
```

## Tech Stack

- string-similarity (fuzzy matching)
- Regex for format detection
