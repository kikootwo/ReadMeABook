/**
 * Component: Ranking Series Position Tests (the book's catalog series part, #330)
 * Documentation: documentation/phase3/match-gates.md
 */

import { describe, expect, it } from 'vitest';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';

const MB = 1024 * 1024;

const release = (title: string) => ({
  indexer: 'X',
  indexerId: 1,
  title,
  size: 500 * MB,
  seeders: 10,
  publishDate: new Date('2025-01-01'),
  downloadUrl: 'x',
  guid: title,
});

type Book = { title: string; author: string; series?: string; seriesPart?: string };

/** matchScore in automatic search (0: rejected) and in interactive search */
const automatic = (title: string, book: Book): number =>
  rankTorrents([release(title)], book, { requireAuthor: true })[0].breakdown.matchScore;
const interactive = (title: string, book: Book): number =>
  rankTorrents([release(title)], book, { requireAuthor: false })[0].breakdown.matchScore;

// The cases from #307, restated: the title is the series name plus "Book One" in words, the catalog says part 1
describe('catalog series part (the #307 cases)', () => {
  const healer = (seriesPart = '1'): Book => ({ title: 'Azarinth Healer: Book One', author: 'Rhaegar', series: 'Azarinth Healer', seriesPart });

  it('rejects a release numbered as another book', () => {
    expect(automatic('Rhaegar - Azarinth Healer 03', healer())).toBe(0);
    expect(automatic('Rhaegar - Azarinth Healer 04', healer())).toBe(0);
  });

  it('keeps the same number with or without a leading zero', () => {
    expect(automatic('Rhaegar - Azarinth Healer 01', healer())).toBeGreaterThan(0);
    expect(automatic('Rhaegar - Azarinth Healer 1', healer())).toBeGreaterThan(0);
  });

  it('keeps a Book marker with the right number', () => {
    expect(automatic('Rhaegar - Azarinth Healer Book 1', healer())).toBeGreaterThan(0);
  });

  it('keeps a release with no number', () => {
    expect(automatic('Rhaegar - Azarinth Healer', healer())).toBeGreaterThan(0);
  });

  it('keeps a range holding the part and rejects one that does not', () => {
    expect(automatic('Rhaegar - Azarinth Healer 1-3', healer())).toBeGreaterThan(0);
    expect(automatic('Rhaegar - Azarinth Healer 01-03', healer())).toBeGreaterThan(0);
    expect(automatic('Rhaegar - Azarinth Healer 2-4', healer())).toBe(0);
  });

  it('reads decimal parts', () => {
    expect(automatic('Rhaegar - Azarinth Healer 1.5', healer('1.5'))).toBeGreaterThan(0);
    expect(automatic('Rhaegar - Azarinth Healer 2.5', healer('1.5'))).toBe(0);
    expect(automatic('Rhaegar - Azarinth Healer 1', healer('1.5'))).toBe(0);
  });

  it('does not read a year or a bitrate as the part', () => {
    expect(automatic('Rhaegar - Azarinth Healer 2025 64kbps', healer())).toBeGreaterThan(0);
  });

  it('reads "Book N of M" as book N', () => {
    expect(automatic('Rhaegar - Azarinth Healer, Book 3 of 6 [M4B]', healer())).toBe(0);
    expect(automatic('Rhaegar - Azarinth Healer #3 of 6 [M4B]', healer())).toBe(0);
    expect(automatic('Rhaegar - Azarinth Healer, Book 1 of 6 [M4B]', healer())).toBeGreaterThan(0);
  });

  it('reads a plural position word before a range', () => {
    expect(automatic('Rhaegar - Azarinth Healer Books 2-4', healer())).toBe(0);
    expect(automatic('Rhaegar - Azarinth Healer Vols 2-4', healer())).toBe(0);
    expect(automatic('Rhaegar - Azarinth Healer Books 1-3', healer())).toBeGreaterThan(0);
  });

  it('runs title-only when the catalog has no series name', () => {
    expect(automatic('Rhaegar - Azarinth Healer 03', { ...healer(), series: undefined })).toBeGreaterThan(0);
  });
});

describe('catalog series name and part (title is the series name plus a number)', () => {
  const book3: Book = { title: 'Azarinth Healer: Book Three', author: 'Rhaegar', series: 'Azarinth Healer', seriesPart: '3' };
  const named = (rest: string) => `Rhaegar - Azarinth Healer${rest} [M4B]`;

  it('rejects another number right after the series name and keeps the right one', () => {
    expect(automatic(named(' 02'), book3)).toBe(0);
    expect(automatic(named(' 03'), book3)).toBeGreaterThan(0);
  });

  it('reads every high-confidence form after the series name', () => {
    for (const form of [', Book 2', ' #2', ' T02', ' Vol. 2']) expect(automatic(named(form), book3)).toBe(0);
    for (const form of [', Book 3', ' #3', ' T03', ' Vol. 3']) expect(automatic(named(form), book3)).toBeGreaterThan(0);
  });

  it('never reads a date as the part', () => {
    for (const date of [' 2019', ' 2019-05-01', ' (2003)', ' 05-01-2019', ' 2019.05.01']) {
      expect(automatic(named(date), book3)).toBeGreaterThan(0);
    }
  });

  it('never reads a part count, a chapter count or a bitrate as the part', () => {
    for (const count of [' [44/97]', ' (1 of 2)', ' 44 of 97', ' 45 Chapters', ' 64 kbps']) {
      expect(automatic(named(count), book3)).toBeGreaterThan(0);
    }
  });

  it('keeps an omnibus range that holds the part', () => {
    expect(automatic(named(' 1-3'), book3)).toBeGreaterThan(0);
    expect(automatic(named(' Books 1-3'), book3)).toBeGreaterThan(0);
  });

  it('never rejects on a bare number away from the series name or title', () => {
    expect(automatic('Rhaegar - Unabridged 2 - Azarinth Healer [M4B]', book3)).toBeGreaterThan(0);
  });

  it('keeps today\'s behavior when the part is missing or not a number', () => {
    const noPart: Book = { ...book3, seriesPart: undefined };
    expect(automatic(named(' 02'), noPart)).toBeGreaterThan(0);
    expect(automatic(named(' 02'), { ...noPart, seriesPart: 'Prequel' })).toBeGreaterThan(0);
  });

  it('reads a part written as "Book 3"', () => {
    expect(automatic(named(' 02'), { ...book3, seriesPart: 'Book 3' })).toBe(0);
    expect(automatic(named(' 03'), { ...book3, seriesPart: 'Book 3' })).toBeGreaterThan(0);
  });

  it('leaves interactive search listing everything', () => {
    expect(interactive(named(' 02'), book3)).toBeGreaterThan(0);
  });
});

describe('catalog part when the release names the book by its own title (another numbering scheme)', () => {
  it('keeps right books whose release numbers the series differently', () => {
    const cases: [string, Book][] = [
      ['C.S. Lewis - The Chronicles of Narnia Book 1 - The Magician\'s Nephew [M4B]',
        { title: 'The Magician\'s Nephew', author: 'C.S. Lewis', series: 'The Chronicles of Narnia', seriesPart: '6' }],
      ['Andrzej Sapkowski - The Witcher Book 1 - Blood of Elves [M4B]',
        { title: 'Blood of Elves', author: 'Andrzej Sapkowski', series: 'The Witcher', seriesPart: '3' }],
      ['Terry Pratchett - Guards! Guards! - Book 1 of the City Watch [MP3]',
        { title: 'Guards! Guards!', author: 'Terry Pratchett', series: 'Discworld', seriesPart: '8' }],
      ['Robert Jordan - The Eye of the World Book 1 of 14 [M4B]',
        { title: 'The Eye of the World', author: 'Robert Jordan', series: 'Wheel of Time', seriesPart: '1' }],
    ];
    for (const [name, book] of cases) expect(automatic(name, book)).toBeGreaterThan(0);
  });

  it('still rejects a release named for another book of the series', () => {
    // Book 3 requested; the release is book 2 under its own title, so the title words are missing
    const morningStar: Book = { title: 'Morning Star', author: 'Pierce Brown', series: 'Red Rising Saga', seriesPart: '3' };
    expect(automatic('Pierce Brown - Red Rising Saga Book 2 - Golden Son [M4B]', morningStar)).toBe(0);
  });

  it('leaves interactive search listing everything', () => {
    const blood: Book = { title: 'Blood of Elves', author: 'Andrzej Sapkowski', series: 'The Witcher', seriesPart: '3' };
    expect(interactive('Andrzej Sapkowski - The Witcher Book 1 - Blood of Elves [M4B]', blood)).toBeGreaterThan(0);
  });
});

describe('title-only check (no catalog part)', () => {
  it('reads "Book N of M" after the title as book N, as on main', () => {
    const dcc: Book = { title: 'Dungeon Crawler Carl (book 1)', author: 'Matt Dinniman' };
    expect(automatic('Matt Dinniman - Dungeon Crawler Carl Book 3 of 7 [M4B]', dcc)).toBe(0);
    expect(automatic('Matt Dinniman - Dungeon Crawler Carl, Book 2 of 7 [M4B]', dcc)).toBe(0);
    expect(automatic('Matt Dinniman - Dungeon Crawler Carl T3 of 7 [M4B]', dcc)).toBe(0);
    expect(automatic('Matt Dinniman - Dungeon Crawler Carl Book 1 of 7 [M4B]', dcc)).toBeGreaterThan(0);
  });
});
