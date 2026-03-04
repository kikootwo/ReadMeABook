/**
 * Component: Audiobook Deduplication Tests
 * Documentation: documentation/integrations/audible.md
 */

import { describe, expect, it } from 'vitest';
import {
  deduplicateAudiobooks,
  deduplicateAndCollectGroups,
  normalizeTitle,
  areDurationsCompatible,
} from '@/lib/utils/deduplicate-audiobooks';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

// ---------------------------------------------------------------------------
// Helper: minimal AudibleAudiobook factory
// ---------------------------------------------------------------------------

function makeBook(overrides: Partial<AudibleAudiobook> & { asin: string; title: string; author: string }): AudibleAudiobook {
  return {
    narrator: undefined,
    coverArtUrl: undefined,
    durationMinutes: undefined,
    rating: undefined,
    description: undefined,
    releaseDate: undefined,
    genres: undefined,
    series: undefined,
    seriesPart: undefined,
    seriesAsin: undefined,
    authorAsin: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeTitle
// ---------------------------------------------------------------------------

describe('normalizeTitle', () => {
  it('lowercases', () => {
    expect(normalizeTitle('The Black Prism')).toBe('the black prism');
  });

  it('strips (Unabridged)', () => {
    expect(normalizeTitle('The Black Prism (Unabridged)')).toBe('the black prism');
  });

  it('strips [Abridged Edition]', () => {
    expect(normalizeTitle('The Black Prism [Abridged Edition]')).toBe('the black prism');
  });

  it('strips (2024 Remastered Edition)', () => {
    expect(normalizeTitle('The Hobbit (2024 Remastered Edition)')).toBe('the hobbit');
  });

  it('strips subtitle after colon', () => {
    expect(normalizeTitle('The Black Prism: Lightbringer, Book 1')).toBe('the black prism');
  });

  it('strips subtitle after long dash', () => {
    expect(normalizeTitle('The Black Prism \u2014 A Lightbringer Novel')).toBe('the black prism');
  });

  it('strips trailing "A Novel"', () => {
    expect(normalizeTitle('The Black Prism: A Novel')).toBe('the black prism');
  });

  it('strips (Audiobook)', () => {
    expect(normalizeTitle('The Hobbit (Audiobook)')).toBe('the hobbit');
  });

  it('strips (Dramatized Adaptation)', () => {
    expect(normalizeTitle('The Black Prism (Dramatized Adaptation)')).toBe('the black prism');
  });

  it('strips (Full Cast Narration)', () => {
    expect(normalizeTitle('The Black Prism (Full Cast Narration)')).toBe('the black prism');
  });

  it('collapses whitespace', () => {
    expect(normalizeTitle('  The   Black   Prism  ')).toBe('the black prism');
  });

  it('handles empty string', () => {
    expect(normalizeTitle('')).toBe('');
  });

  it('preserves hyphenated words (not subtitles)', () => {
    // "well-known" has a short dash, not a subtitle separator
    expect(normalizeTitle('A Well-Known Book')).toBe('a well-known book');
  });
});

// ---------------------------------------------------------------------------
// areDurationsCompatible
// ---------------------------------------------------------------------------

describe('areDurationsCompatible', () => {
  it('returns true when both undefined', () => {
    expect(areDurationsCompatible(undefined, undefined)).toBe(true);
  });

  it('returns true when one undefined', () => {
    expect(areDurationsCompatible(600, undefined)).toBe(true);
    expect(areDurationsCompatible(undefined, 600)).toBe(true);
  });

  it('returns true for identical durations', () => {
    expect(areDurationsCompatible(600, 600)).toBe(true);
  });

  it('uses 1% of longer duration as tolerance for long books', () => {
    // Two 40-hour books (2400 min): tolerance = max(2400*0.01, 5) = 24 min
    expect(areDurationsCompatible(2400, 2424)).toBe(true);  // exactly at tolerance
    expect(areDurationsCompatible(2400, 2425)).toBe(false); // just over
  });

  it('uses 5-minute minimum tolerance for short books', () => {
    // Two 2-hour books (120 min): tolerance = max(120*0.01, 5) = max(1.2, 5) = 5 min
    expect(areDurationsCompatible(120, 125)).toBe(true);  // exactly at 5-min minimum
    expect(areDurationsCompatible(120, 126)).toBe(false); // just over
  });

  it('keeps abridged vs unabridged separate (large duration gap)', () => {
    // Unabridged: 720 min (12 hrs), Abridged: 360 min (6 hrs)
    expect(areDurationsCompatible(720, 360)).toBe(false);
  });

  it('symmetry: order does not matter', () => {
    expect(areDurationsCompatible(2400, 2424)).toBe(true);
    expect(areDurationsCompatible(2424, 2400)).toBe(true);
    expect(areDurationsCompatible(120, 126)).toBe(false);
    expect(areDurationsCompatible(126, 120)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deduplicateAudiobooks
// ---------------------------------------------------------------------------

describe('deduplicateAudiobooks', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateAudiobooks([])).toEqual([]);
  });

  it('returns single book unchanged', () => {
    const book = makeBook({ asin: 'A1', title: 'Book One', author: 'Author' });
    expect(deduplicateAudiobooks([book])).toEqual([book]);
  });

  it('passes through all-unique books unchanged', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'Book One', author: 'Auth', narrator: 'Nar A', durationMinutes: 600 }),
      makeBook({ asin: 'A2', title: 'Book Two', author: 'Auth', narrator: 'Nar A', durationMinutes: 500 }),
      makeBook({ asin: 'A3', title: 'Book Three', author: 'Auth', narrator: 'Nar B', durationMinutes: 700 }),
    ];
    expect(deduplicateAudiobooks(books)).toHaveLength(3);
  });

  it('collapses simple duplicates (same title + narrator + similar duration)', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1260 }),
      makeBook({ asin: 'A2', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1262 }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(1);
  });

  it('keeps books with different narrators (different production)', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1260 }),
      makeBook({ asin: 'A2', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Full Cast', durationMinutes: 480 }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(2);
  });

  it('keeps abridged vs unabridged (same narrator, very different duration)', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Hobbit', author: 'Tolkien', narrator: 'Andy Serkis', durationMinutes: 660 }),
      makeBook({ asin: 'A2', title: 'The Hobbit', author: 'Tolkien', narrator: 'Andy Serkis', durationMinutes: 330 }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(2);
  });

  it('collapses when one book has missing duration', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1260 }),
      makeBook({ asin: 'A2', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: undefined }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(1);
  });

  it('collapses when both books have missing duration', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance' }),
      makeBook({ asin: 'A2', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance' }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(1);
  });

  it('collapses title variants with edition markers', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Black Prism (Unabridged)', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1260 }),
      makeBook({ asin: 'A2', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1258 }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(1);
  });

  it('collapses title variants with subtitles', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Black Prism: Lightbringer, Book 1', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1260 }),
      makeBook({ asin: 'A2', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1262 }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(1);
  });

  it('picks the representative with most metadata', () => {
    const sparse = makeBook({
      asin: 'A1', title: 'The Black Prism', author: 'Brent Weeks',
      narrator: 'Simon Vance', durationMinutes: 1260,
    });
    const rich = makeBook({
      asin: 'A2', title: 'The Black Prism', author: 'Brent Weeks',
      narrator: 'Simon Vance', durationMinutes: 1262,
      coverArtUrl: 'https://img.jpg', rating: 4.5, description: 'Great book',
    });
    const result = deduplicateAudiobooks([sparse, rich]);
    expect(result).toHaveLength(1);
    expect(result[0].asin).toBe('A2'); // rich entry wins
  });

  it('preserves original order (first-seen position)', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'Alpha', author: 'Auth', narrator: 'Nar', durationMinutes: 300 }),
      makeBook({ asin: 'B1', title: 'Beta', author: 'Auth', narrator: 'Nar', durationMinutes: 400 }),
      makeBook({ asin: 'A2', title: 'Alpha', author: 'Auth', narrator: 'Nar', durationMinutes: 302 }),
      makeBook({ asin: 'C1', title: 'Charlie', author: 'Auth', narrator: 'Nar', durationMinutes: 500 }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(3);
    expect(result.map(b => b.title)).toEqual(['Alpha', 'Beta', 'Charlie']);
  });

  it('handles Lightbringer-style scenario: unabridged + dramatized', () => {
    // Simon Vance full narration (long)
    const vance1 = makeBook({
      asin: 'SV1', title: 'The Black Prism', author: 'Brent Weeks',
      narrator: 'Simon Vance', durationMinutes: 1260,
      coverArtUrl: 'cover1.jpg', rating: 4.7,
    });
    // Re-listed Simon Vance (same duration, different ASIN)
    const vance2 = makeBook({
      asin: 'SV2', title: 'The Black Prism: Lightbringer Book 1', author: 'Brent Weeks',
      narrator: 'Simon Vance', durationMinutes: 1262,
    });
    // Dramatized with full cast (shorter, different narrator)
    const drama = makeBook({
      asin: 'DR1', title: 'The Black Prism (Dramatized Adaptation)', author: 'Brent Weeks',
      narrator: 'Full Cast', durationMinutes: 480,
      coverArtUrl: 'cover-drama.jpg',
    });

    const result = deduplicateAudiobooks([vance1, vance2, drama]);
    expect(result).toHaveLength(2);
    // Simon Vance should collapse to 1, Full Cast stays
    expect(result.find(b => b.narrator === 'Simon Vance')).toBeTruthy();
    expect(result.find(b => b.narrator === 'Full Cast')).toBeTruthy();
    // Should pick the richer entry for Simon Vance
    const svResult = result.find(b => b.narrator === 'Simon Vance')!;
    expect(svResult.asin).toBe('SV1'); // has cover + rating
  });

  it('uses percentage tolerance for very long audiobooks', () => {
    // Two 40-hour books: tolerance = max(2400*0.01, 5) = 24 min
    const books = [
      makeBook({ asin: 'A1', title: 'Long Book', author: 'Auth', narrator: 'Nar', durationMinutes: 2400 }),
      makeBook({ asin: 'A2', title: 'Long Book', author: 'Auth', narrator: 'Nar', durationMinutes: 2420 }),
    ];
    expect(deduplicateAudiobooks(books)).toHaveLength(1);

    // Beyond tolerance
    const booksFar = [
      makeBook({ asin: 'A1', title: 'Long Book', author: 'Auth', narrator: 'Nar', durationMinutes: 2400 }),
      makeBook({ asin: 'A2', title: 'Long Book', author: 'Auth', narrator: 'Nar', durationMinutes: 2430 }),
    ];
    expect(deduplicateAudiobooks(booksFar)).toHaveLength(2);
  });

  it('treats missing narrator as its own group', () => {
    // Two entries with same title but no narrator - should collapse
    const books = [
      makeBook({ asin: 'A1', title: 'Test Book', author: 'Auth', narrator: undefined, durationMinutes: 300 }),
      makeBook({ asin: 'A2', title: 'Test Book', author: 'Auth', narrator: undefined, durationMinutes: 302 }),
    ];
    expect(deduplicateAudiobooks(books)).toHaveLength(1);
  });

  it('does not collapse empty-narrator with named narrator', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'Test Book', author: 'Auth', narrator: undefined, durationMinutes: 300 }),
      makeBook({ asin: 'A2', title: 'Test Book', author: 'Auth', narrator: 'John Smith', durationMinutes: 302 }),
    ];
    expect(deduplicateAudiobooks(books)).toHaveLength(2);
  });

  it('collapses duplicates when narrators are listed in different order', () => {
    const books = [
      makeBook({
        asin: 'A1', title: 'The Passengers', author: 'John Marrs',
        narrator: 'Kristin Atherton, Roy McMillan, Clare Corbett, Tom Bateman, Patience Tomlinson, Shaheen Khan',
        durationMinutes: 600,
      }),
      makeBook({
        asin: 'A2', title: 'The Passengers', author: 'John Marrs',
        narrator: 'Clare Corbett, Roy McMillan, Tom Bateman, Shaheen Khan, Kristin Atherton, Patience Tomlinson',
        durationMinutes: 602,
      }),
    ];
    const result = deduplicateAudiobooks(books);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// deduplicateAndCollectGroups
// ---------------------------------------------------------------------------

describe('deduplicateAndCollectGroups', () => {
  it('returns empty groups array when no duplicates', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'Book One', author: 'Auth', narrator: 'Nar A', durationMinutes: 600 }),
      makeBook({ asin: 'A2', title: 'Book Two', author: 'Auth', narrator: 'Nar A', durationMinutes: 500 }),
    ];
    const { books: result, groups } = deduplicateAndCollectGroups(books);
    expect(result).toHaveLength(2);
    expect(groups).toHaveLength(0);
  });

  it('returns empty groups for empty input', () => {
    const { books: result, groups } = deduplicateAndCollectGroups([]);
    expect(result).toHaveLength(0);
    expect(groups).toHaveLength(0);
  });

  it('returns empty groups for single book', () => {
    const book = makeBook({ asin: 'A1', title: 'Book One', author: 'Auth' });
    const { books: result, groups } = deduplicateAndCollectGroups([book]);
    expect(result).toHaveLength(1);
    expect(groups).toHaveLength(0);
  });

  it('returns group with 2 ASINs when 2 books match', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1260 }),
      makeBook({ asin: 'A2', title: 'The Black Prism', author: 'Brent Weeks', narrator: 'Simon Vance', durationMinutes: 1262 }),
    ];
    const { books: result, groups } = deduplicateAndCollectGroups(books);
    expect(result).toHaveLength(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].allAsins).toHaveLength(2);
    expect(groups[0].allAsins).toContain('A1');
    expect(groups[0].allAsins).toContain('A2');
  });

  it('returns group with 3+ ASINs for multi-duplicate scenario', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'The Hobbit', author: 'Tolkien', narrator: 'Andy Serkis', durationMinutes: 660 }),
      makeBook({ asin: 'A2', title: 'The Hobbit', author: 'Tolkien', narrator: 'Andy Serkis', durationMinutes: 662 }),
      makeBook({ asin: 'A3', title: 'The Hobbit (Unabridged)', author: 'Tolkien', narrator: 'Andy Serkis', durationMinutes: 658 }),
    ];
    const { books: result, groups } = deduplicateAndCollectGroups(books);
    expect(result).toHaveLength(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].allAsins).toHaveLength(3);
    expect(groups[0].allAsins).toContain('A1');
    expect(groups[0].allAsins).toContain('A2');
    expect(groups[0].allAsins).toContain('A3');
  });

  it('canonicalAsin is the one with highest metadata score', () => {
    const sparse = makeBook({
      asin: 'SPARSE', title: 'The Black Prism', author: 'Brent Weeks',
      narrator: 'Simon Vance', durationMinutes: 1260,
    });
    const rich = makeBook({
      asin: 'RICH', title: 'The Black Prism', author: 'Brent Weeks',
      narrator: 'Simon Vance', durationMinutes: 1262,
      coverArtUrl: 'https://img.jpg', rating: 4.5, description: 'Great book',
    });
    const { groups } = deduplicateAndCollectGroups([sparse, rich]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonicalAsin).toBe('RICH');
  });

  it('groups only include entries with 2+ ASINs', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'Alpha', author: 'Auth', narrator: 'Nar', durationMinutes: 300 }),
      makeBook({ asin: 'A2', title: 'Alpha', author: 'Auth', narrator: 'Nar', durationMinutes: 302 }),
      makeBook({ asin: 'B1', title: 'Beta', author: 'Auth', narrator: 'Nar', durationMinutes: 500 }),
    ];
    const { groups } = deduplicateAndCollectGroups(books);
    // Only Alpha group should appear (Beta is a singleton)
    expect(groups).toHaveLength(1);
    expect(groups[0].allAsins).toContain('A1');
    expect(groups[0].allAsins).toContain('A2');
  });

  it('duration-incompatible books produce separate entries (no group for singletons)', () => {
    // Same title/narrator but very different durations (abridged vs unabridged)
    const books = [
      makeBook({ asin: 'A1', title: 'The Hobbit', author: 'Tolkien', narrator: 'Andy Serkis', durationMinutes: 660 }),
      makeBook({ asin: 'A2', title: 'The Hobbit', author: 'Tolkien', narrator: 'Andy Serkis', durationMinutes: 330 }),
    ];
    const { books: result, groups } = deduplicateAndCollectGroups(books);
    expect(result).toHaveLength(2); // Not collapsed
    expect(groups).toHaveLength(0); // No multi-ASIN groups
  });

  it('books field matches what deduplicateAudiobooks returns', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'Alpha', author: 'Auth', narrator: 'Nar', durationMinutes: 300, coverArtUrl: 'img.jpg', rating: 4.5 }),
      makeBook({ asin: 'A2', title: 'Alpha', author: 'Auth', narrator: 'Nar', durationMinutes: 302 }),
      makeBook({ asin: 'B1', title: 'Beta', author: 'Auth', narrator: 'Nar', durationMinutes: 500 }),
      makeBook({ asin: 'C1', title: 'Charlie', author: 'Auth', narrator: 'Nar', durationMinutes: 600 }),
      makeBook({ asin: 'C2', title: 'Charlie', author: 'Auth', narrator: 'Nar', durationMinutes: 601 }),
    ];
    const dedupOnly = deduplicateAudiobooks(books);
    const { books: withGroups } = deduplicateAndCollectGroups(books);
    expect(withGroups.map(b => b.asin)).toEqual(dedupOnly.map(b => b.asin));
  });

  it('includes narrator and durationMinutes from canonical entry in group', () => {
    const books = [
      makeBook({ asin: 'A1', title: 'Test Book', author: 'Auth', narrator: 'Jane Doe', durationMinutes: 480 }),
      makeBook({ asin: 'A2', title: 'Test Book', author: 'Auth', narrator: 'Jane Doe', durationMinutes: 482, coverArtUrl: 'img.jpg', rating: 4.0 }),
    ];
    const { groups } = deduplicateAndCollectGroups(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonicalAsin).toBe('A2'); // richer metadata
    expect(groups[0].narrator).toBe('Jane Doe');
    expect(groups[0].durationMinutes).toBe(482);
    expect(groups[0].author).toBe('Auth');
  });
});
