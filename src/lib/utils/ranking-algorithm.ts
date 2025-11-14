/**
 * Component: Intelligent Ranking Algorithm
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { compareTwoStrings } from 'string-similarity';

export interface TorrentResult {
  indexer: string;
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  publishDate: Date;
  downloadUrl: string;
  infoHash?: string;
  guid: string;
  format?: 'M4B' | 'M4A' | 'MP3' | 'OTHER';
  bitrate?: string;
  hasChapters?: boolean;
}

export interface AudiobookRequest {
  title: string;
  author: string;
  narrator?: string;
  durationMinutes?: number;
}

export interface ScoreBreakdown {
  formatScore: number;
  seederScore: number;
  sizeScore: number;
  matchScore: number;
  totalScore: number;
  notes: string[];
}

export interface RankedTorrent extends TorrentResult {
  score: number;
  rank: number;
  breakdown: ScoreBreakdown;
}

export class RankingAlgorithm {
  /**
   * Rank all torrents and return sorted by score (best first)
   */
  rankTorrents(
    torrents: TorrentResult[],
    audiobook: AudiobookRequest
  ): RankedTorrent[] {
    const ranked = torrents.map((torrent) => {
      const formatScore = this.scoreFormat(torrent);
      const seederScore = this.scoreSeeders(torrent.seeders);
      const sizeScore = this.scoreSize(torrent.size, audiobook.durationMinutes);
      const matchScore = this.scoreMatch(torrent, audiobook);

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
          notes: this.generateNotes(torrent, {
            formatScore,
            seederScore,
            sizeScore,
            matchScore,
            totalScore,
            notes: [],
          }),
        },
      };
    });

    // Sort by score descending (best first)
    ranked.sort((a, b) => b.score - a.score);

    // Assign ranks
    ranked.forEach((r, index) => {
      r.rank = index + 1;
    });

    return ranked;
  }

  /**
   * Get detailed scoring breakdown for a torrent
   */
  getScoreBreakdown(
    torrent: TorrentResult,
    audiobook: AudiobookRequest
  ): ScoreBreakdown {
    const formatScore = this.scoreFormat(torrent);
    const seederScore = this.scoreSeeders(torrent.seeders);
    const sizeScore = this.scoreSize(torrent.size, audiobook.durationMinutes);
    const matchScore = this.scoreMatch(torrent, audiobook);
    const totalScore = formatScore + seederScore + sizeScore + matchScore;

    return {
      formatScore,
      seederScore,
      sizeScore,
      matchScore,
      totalScore,
      notes: this.generateNotes(torrent, {
        formatScore,
        seederScore,
        sizeScore,
        matchScore,
        totalScore,
        notes: [],
      }),
    };
  }

  /**
   * Score format quality (40 points max)
   * M4B with chapters: 40 pts
   * M4B without chapters: 35 pts
   * M4A: 25 pts
   * MP3: 15 pts
   * Other: 5 pts
   */
  private scoreFormat(torrent: TorrentResult): number {
    const format = this.detectFormat(torrent);

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

  /**
   * Score seeder count (25 points max)
   * Logarithmic scaling:
   * 1 seeder: 0 points
   * 10 seeders: 10 points
   * 100 seeders: 20 points
   * 1000+ seeders: 25 points
   */
  private scoreSeeders(seeders: number): number {
    if (seeders === 0) return 0;
    return Math.min(25, Math.log10(seeders + 1) * 10);
  }

  /**
   * Score size reasonableness (20 points max)
   * Expected: 1-2 MB per minute (64-128 kbps)
   * Perfect match: 20 points
   * Too small/large: Reduced points
   */
  private scoreSize(size: number, durationMinutes?: number): number {
    if (!durationMinutes) {
      return 10; // Neutral score if duration unknown
    }

    // Expected size: 1-2 MB per minute
    const minExpected = durationMinutes * 1024 * 1024; // 1 MB/min
    const maxExpected = durationMinutes * 2 * 1024 * 1024; // 2 MB/min

    if (size >= minExpected && size <= maxExpected) {
      return 20; // Perfect size
    }

    // Calculate deviation penalty
    const deviation =
      size < minExpected
        ? (minExpected - size) / minExpected
        : (size - maxExpected) / maxExpected;

    return Math.max(0, 20 - deviation * 20);
  }

  /**
   * Score title/author match quality (15 points max)
   * Title similarity: 0-10 points
   * Author presence: 0-5 points
   */
  private scoreMatch(
    torrent: TorrentResult,
    audiobook: AudiobookRequest
  ): number {
    const title = torrent.title.toLowerCase();
    const requestTitle = audiobook.title.toLowerCase();
    const requestAuthor = audiobook.author.toLowerCase();

    // Title similarity (0-10 points)
    const titleSimilarity = compareTwoStrings(requestTitle, title) * 10;

    // Author presence (0-5 points)
    const hasAuthor = title.includes(requestAuthor) ? 5 : 0;

    return Math.min(15, titleSimilarity + hasAuthor);
  }

  /**
   * Detect format from torrent title
   */
  private detectFormat(torrent: TorrentResult): 'M4B' | 'M4A' | 'MP3' | 'OTHER' {
    // Use explicit format if provided
    if (torrent.format) {
      return torrent.format;
    }

    const title = torrent.title.toUpperCase();

    // Check for format keywords in title
    if (title.includes('M4B')) return 'M4B';
    if (title.includes('M4A')) return 'M4A';
    if (title.includes('MP3')) return 'MP3';

    // Default to OTHER if no format detected
    return 'OTHER';
  }

  /**
   * Generate human-readable notes about scoring
   */
  private generateNotes(
    torrent: TorrentResult,
    breakdown: ScoreBreakdown
  ): string[] {
    const notes: string[] = [];

    // Format notes
    const format = this.detectFormat(torrent);
    if (format === 'M4B') {
      notes.push('Excellent format (M4B)');
      if (torrent.hasChapters !== false) {
        notes.push('Has chapter markers');
      }
    } else if (format === 'M4A') {
      notes.push('Good format (M4A)');
    } else if (format === 'MP3') {
      notes.push('Acceptable format (MP3)');
    } else {
      notes.push('Unknown or uncommon format');
    }

    // Seeder notes
    if (torrent.seeders === 0) {
      notes.push('⚠️ No seeders available');
    } else if (torrent.seeders < 5) {
      notes.push(`Low seeders (${torrent.seeders})`);
    } else if (torrent.seeders >= 50) {
      notes.push(`Excellent availability (${torrent.seeders} seeders)`);
    }

    // Size notes
    if (breakdown.sizeScore < 10) {
      notes.push('⚠️ Unusual file size');
    }

    // Match notes
    if (breakdown.matchScore < 8) {
      notes.push('⚠️ Title/author may not match well');
    }

    // Overall quality assessment
    if (breakdown.totalScore >= 80) {
      notes.push('✓ Excellent choice');
    } else if (breakdown.totalScore >= 60) {
      notes.push('✓ Good choice');
    } else if (breakdown.totalScore < 40) {
      notes.push('⚠️ Consider reviewing this choice');
    }

    return notes;
  }
}

// Singleton instance
let ranker: RankingAlgorithm | null = null;

export function getRankingAlgorithm(): RankingAlgorithm {
  if (!ranker) {
    ranker = new RankingAlgorithm();
  }
  return ranker;
}

/**
 * Helper function to rank torrents using the singleton instance
 */
export function rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest
): (TorrentResult & { qualityScore: number })[] {
  const algorithm = getRankingAlgorithm();
  const ranked = algorithm.rankTorrents(torrents, audiobook);

  // Return torrents with qualityScore field for compatibility
  return ranked.map((r) => ({
    ...r,
    qualityScore: Math.round(r.score),
  }));
}
