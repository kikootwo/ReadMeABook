/**
 * Component: Ranking Algorithm Tests (right books that cleared the threshold before #223 still clear it)
 * Documentation: documentation/phase3/match-gates.md
 */

import { describe, expect, it } from 'vitest';
import { rankEbookTorrents, rankTorrents } from '@/lib/utils/ranking-algorithm';
import { LANGUAGE_CONFIGS, SupportedLanguage } from '@/lib/constants/language-config';
import corpus from './fixtures/ranking-right-books-223.json';

interface Row { release: string; title: string; author: string; lang?: SupportedLanguage; ebook?: boolean; mainTotal: number }

const MB = 1024 * 1024;
const rows = corpus.rows as Row[];

/** Right books a gate now rejects on purpose; at most five, each with its reason */
const EXCEPTIONS: Record<string, string> = {
  'C.S. Lewis - The Chronicles of Narnia Book 1 - The Magician\'s Nephew [M4B]': 'G4c: publication-order number (Book 1) against the requested chronological Book 6',
  'Andrzej Sapkowski - The Witcher Book 1 - Blood of Elves [M4B]': 'G4c: the saga numbers this Book 1, the request says Book 3',
  'Terry Pratchett - Guards! Guards! - Book 1 of the City Watch [MP3]': 'G4c: a sub-series number right after the title reads as the volume',
  'Kenneth Follett - The Pillars of the Earth [M4B]': 'G3: "Ken" no longer matches inside "Kenneth"',
  'Shirtaloon - He Who Fights with Monsters I [M4B]': 'G4a: a Roman numeral does not satisfy the required 1',
};

/** Automatic search through the real entry point, with the oracle's defaults */
function total(row: Row): number {
  const config = row.lang ? LANGUAGE_CONFIGS[row.lang] : undefined;
  const options = { requireAuthor: true, stopWords: config?.stopWords, characterReplacements: config?.characterReplacements };
  const torrent = { indexer: 'X', indexerId: 1, title: row.release, publishDate: new Date('2025-01-01'), downloadUrl: 'x', guid: 'g' };
  if (row.ebook) {
    return rankEbookTorrents([{ ...torrent, size: 2 * MB }], { title: row.title, author: row.author, preferredFormat: 'epub' }, options)[0].score;
  }
  return rankTorrents([{ ...torrent, size: 600 * MB }], { title: row.title, author: row.author, durationMinutes: 600 }, options)[0].score;
}

describe('right books that cleared 50 before #223', () => {
  it('holds only rows that cleared 50, and at most five listed exceptions', () => {
    expect(rows.length).toBe(193);
    expect(rows.every((row) => row.mainTotal >= 50)).toBe(true);
    expect(Object.keys(EXCEPTIONS).length).toBeLessThanOrEqual(5);
    for (const release of Object.keys(EXCEPTIONS)) expect(rows.some((row) => row.release === release)).toBe(true);
  });

  it.each(rows.filter((row) => !(row.release in EXCEPTIONS)).map((row) => [row.release, row.title, row] as const))(
    '%s (%s) still clears 50',
    (_release, _title, row) => {
      expect(total(row)).toBeGreaterThanOrEqual(50);
    },
  );

  it.each(Object.entries(EXCEPTIONS))('listed exception: %s (%s)', (release) => {
    const row = rows.find((r) => r.release === release) as Row;
    expect(total(row)).toBeLessThan(50);
  });
});
