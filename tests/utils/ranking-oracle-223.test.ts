/**
 * Component: Ranking Algorithm Tests (regression oracle for the #223 match gates)
 * Documentation: documentation/phase3/match-gates.md
 *
 * fixtures/ranking-oracle-223.json holds every unique (release, title, author, mode, language)
 * pair the ranking suites scored before the #223 gates, with the matchScore it got then.
 * To regenerate on a base commit: wrap RankingAlgorithm.prototype.scoreMatch in a vitest
 * setup file that appends each call's inputs and result to a JSONL file, run the ranking
 * suites (tests/utils/ranking-*.test.ts, tests/processors/search-indexers-non-latin.test.ts,
 * tests/api/audiobooks-search.routes.test.ts, tests/api/requests-actions.routes.test.ts,
 * tests/api/interactive-search-access.test.ts), then keep the first row of each unique key.
 */

import { describe, expect, it } from 'vitest';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';
import oracle from './fixtures/ranking-oracle-223.json';

interface OracleRow {
  release: string;
  title: string;
  author: string;
  requireAuthor: boolean;
  stopWords?: string[];
  characterReplacements?: Record<string, string>;
  match: number;
}

/** Initials now earn Stage 3 author credit (G2): these rows may only rise */
const INITIALS_RISE = new Set([
  'Olive Juice by T J Klune [ENG / M4B]',
  'Olive Juice by TJ Klune [M4B]',
  'Naked in Death by JD Robb',
  'The Casual Vacancy by J.K. Rowling [M4B]',
  'The Casual Vacancy by JK Rowling [M4B]',
  'Olive Juice Book 1 T J Klune',
  'A Game of Thrones by George RR Martin',
]);

const matchScore = (row: OracleRow): number => {
  const [ranked] = rankTorrents(
    [{ indexer: 'X', indexerId: 1, title: row.release, size: 100 * 1024 * 1024, seeders: 10, publishDate: new Date('2025-01-01'), downloadUrl: 'x', guid: 'g' }],
    { title: row.title, author: row.author },
    { requireAuthor: row.requireAuthor, stopWords: row.stopWords, characterReplacements: row.characterReplacements },
  );
  return ranked.breakdown.matchScore;
};

describe('ranking oracle: scores the existing suites rely on', () => {
  const rows = oracle as OracleRow[];

  it('covers every pair the suites scored', () => {
    expect(rows.length).toBe(176);
  });

  it.each(rows.map((row) => [`${row.requireAuthor ? 'auto' : 'interactive'} | ${row.title} | ${row.release}`, row] as const))(
    '%s',
    (_label, row) => {
      const now = matchScore(row);
      if (INITIALS_RISE.has(row.release)) {
        expect(now).toBeGreaterThanOrEqual(row.match - 1e-6);
      } else {
        expect(now).toBeCloseTo(row.match, 5);
      }
    },
  );
});
