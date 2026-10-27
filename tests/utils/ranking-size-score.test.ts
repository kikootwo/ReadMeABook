/**
 * Component: Ranking Algorithm Tests (size score per bitrate, #318)
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { describe, expect, it } from 'vitest';
import { RankingAlgorithm } from '@/lib/utils/ranking-algorithm';

const MINUTES = 600;

/** Size score of a release with this constant bitrate over a 600-minute book */
function sizeScoreAt(kbps: number): number {
  const bytes = (kbps * 1000 / 8) * 60 * MINUTES;
  const torrent = {
    indexer: 'X', title: 'Great Book', size: bytes, seeders: 10,
    publishDate: new Date('2025-01-01'), downloadUrl: 'x', guid: 'g',
  };
  return new RankingAlgorithm().getScoreBreakdown(torrent, { title: 'Great Book', author: 'Author Name', durationMinutes: MINUTES }).sizeScore;
}

describe('size score by bitrate (documented numbers, #318)', () => {
  it.each([
    [32, 3.43],
    [64, 6.87],
    [128, 13.73],
  ])('%i kbps scores %f', (kbps, points) => {
    expect(sizeScoreAt(kbps)).toBeCloseTo(points, 2);
  });

  it('full points start at 1 MiB per minute, about 140 kbps', () => {
    expect(sizeScoreAt(139)).toBeLessThan(15);
    expect(sizeScoreAt(140)).toBe(15);
    expect(sizeScoreAt(320)).toBe(15);
  });
});
