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

/** Automatic search score for one release (0 rows: filtered; matchScore 0: rejected) */
const automatic = (title: string, book: Book): number =>
  rankTorrents([release(title)], book, { requireAuthor: true })[0].breakdown.matchScore;
const interactive = (title: string, book: Book): number =>
  rankTorrents([release(title)], book, { requireAuthor: false })[0].breakdown.matchScore;

// The cases from #307, restated: the request title says "Book One" in words, the catalog says part 1
describe('catalog series part, title only (the #307 cases)', () => {
  const healer = (seriesPart = '1'): Book => ({ title: 'Azarinth Healer: Book One', author: 'Rhaegar', seriesPart });

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
});

describe('catalog series name and part', () => {
  const book3: Book = { title: 'Golden Son', author: 'Pierce Brown', series: 'Red Rising Saga', seriesPart: '3' };
  const golden = (name: string) => `Pierce Brown - ${name} - Golden Son`;

  it('rejects another number right after the series name and keeps the right one', () => {
    expect(automatic(golden('Red Rising Saga 02'), book3)).toBe(0);
    expect(automatic(golden('Red Rising Saga 03'), book3)).toBeGreaterThan(0);
  });

  it('reads every high-confidence form after the series name', () => {
    expect(automatic(golden('Red Rising Saga, Book 2'), book3)).toBe(0);
    expect(automatic(golden('Red Rising Saga #2'), book3)).toBe(0);
    expect(automatic(golden('Red Rising Saga T02'), book3)).toBe(0);
    expect(automatic(golden('Red Rising Saga Vol. 2'), book3)).toBe(0);
    expect(automatic(golden('Red Rising Saga, Book 3'), book3)).toBeGreaterThan(0);
    expect(automatic(golden('Red Rising Saga #3'), book3)).toBeGreaterThan(0);
  });

  it('never reads a date as the part', () => {
    for (const date of ['2019', '2019-05-01', '(2003)', '05-01-2019', '2019.05.01']) {
      expect(automatic(golden(`Red Rising Saga ${date}`), book3)).toBeGreaterThan(0);
    }
  });

  it('never reads a part count, a chapter count or a bitrate as the part', () => {
    expect(automatic(golden('Red Rising Saga [44/97]'), book3)).toBeGreaterThan(0);
    expect(automatic(golden('Red Rising Saga 44 of 97'), book3)).toBeGreaterThan(0);
    expect(automatic(golden('Red Rising Saga 45 Chapters'), book3)).toBeGreaterThan(0);
    expect(automatic(golden('Red Rising Saga 64 kbps'), book3)).toBeGreaterThan(0);
  });

  it('keeps an omnibus range that holds the part', () => {
    const book2: Book = { title: 'Golden Son', author: 'Pierce Brown', series: 'Red Rising Saga', seriesPart: '2' };
    expect(automatic('Pierce Brown - Red Rising Saga 1-3 - Golden Son', book2)).toBeGreaterThan(0);
    expect(automatic('Pierce Brown - Red Rising Saga Books 1-3', { ...book2, title: 'Red Rising Saga' })).toBeGreaterThan(0);
  });

  it('never rejects on a bare number away from the series name or title', () => {
    expect(automatic('Pierce Brown - Golden Son - Unabridged 2 - Red Rising Saga', book3)).toBeGreaterThan(0);
  });

  it('keeps today\'s behavior when the part is missing or not a number', () => {
    const noPart: Book = { title: 'Golden Son', author: 'Pierce Brown', series: 'Red Rising Saga' };
    expect(automatic(golden('Red Rising Saga 02'), noPart)).toBeGreaterThan(0);
    expect(automatic(golden('Red Rising Saga 02'), { ...noPart, seriesPart: 'Prequel' })).toBeGreaterThan(0);
  });

  it('reads a part written as "Book 3"', () => {
    expect(automatic(golden('Red Rising Saga 02'), { ...book3, seriesPart: 'Book 3' })).toBe(0);
    expect(automatic(golden('Red Rising Saga 03'), { ...book3, seriesPart: 'Book 3' })).toBeGreaterThan(0);
  });

  it('keeps a title-named position from another series beside the catalog part', () => {
    // Discworld book 8, catalog series City Watch part 1: either number is the right book
    const guards: Book = { title: 'Guards! Guards! (Discworld, Book 8)', author: 'Terry Pratchett', series: 'City Watch', seriesPart: '1' };
    expect(automatic('Terry Pratchett - Discworld 08 - Guards! Guards!', guards)).toBeGreaterThan(0);
    expect(automatic('Terry Pratchett - City Watch 01 - Guards! Guards!', guards)).toBeGreaterThan(0);
    expect(automatic('Terry Pratchett - City Watch 02 - Guards! Guards!', guards)).toBe(0);
  });

  it('leaves interactive search listing everything', () => {
    expect(interactive(golden('Red Rising Saga 02'), book3)).toBeGreaterThan(0);
    expect(interactive('Rhaegar - Azarinth Healer 03', { title: 'Azarinth Healer: Book One', author: 'Rhaegar', seriesPart: '1' })).toBeGreaterThan(0);
  });
});
