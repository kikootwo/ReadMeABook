/**
 * Component: Import lists unit tests
 * Documentation: documentation/backend/services/list-sync.md
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: vi.fn() }));
vi.mock('@/lib/services/request-creator.service', () => ({ createRequestForUser: vi.fn() }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: vi.fn() }));

import { cleanListTitle, parseListPage } from '@/lib/services/import-lists/goodreads-list.provider';
import { deepFilter, firstInvalidPattern, needsMetadata, preFilter } from '@/lib/services/import-lists/filter';
import type { FilterRules } from '@/lib/services/import-lists/filter';
import { pickBestMatch, similarity } from '@/lib/services/import-lists/match';
import { ownedHow, ownedKey } from '@/lib/services/import-lists/owned';
import { isDue } from '@/lib/services/import-lists/sync.service';
import { parseListId } from '@/lib/services/import-lists/validation';

const rules = (over: Partial<FilterRules> = {}): FilterRules => ({
  skipPartsAndSets: true, titleExcludePatterns: [], authorExcludePatterns: [], requireAudibleAsin: true,
  allowAbridged: false, minRuntimeMinutes: 60, maxRuntimeMinutes: 0, minPublicationYear: 0, maxPublicationYear: 0,
  allowedLanguages: ['english'], excludedPublishers: [], excludedNarrators: [], excludedGenres: [], includedGenres: [],
  minAudibleRating: 3.5, ...over,
});

describe('parseListId', () => {
  it('reads a plain number and a slugged list URL', () => {
    expect(parseListId('135')).toBe(135);
    expect(parseListId(' https://www.goodreads.com/list/show/135.Best_Horror_Novels ')).toBe(135);
    expect(parseListId('https://www.goodreads.com/list/show/264')).toBe(264);
  });
  it('rejects anything else', () => {
    expect(parseListId('banana')).toBeNull();
    expect(parseListId('https://example.com/list/show/135')).toBeNull();
    expect(parseListId('0')).toBeNull();
  });
});

describe('goodreads list page parsing', () => {
  const row = (id: number, title: string, author: string) => `
    <tr itemscope itemtype="http://schema.org/Book">
      <td><img class="bookCover" src="https://img/${id}.jpg"></td>
      <td><a class="bookTitle" href="/book/show/${id}.x"><span itemprop="name">${title}</span></a>
      <a class="authorName" href="/author/show/1"><span itemprop="name">${author}</span></a></td>
    </tr>`;

  it('extracts name, size, ranked books and cleans series suffixes', () => {
    const html = `<html><head><title>Best Horror Novels (2139 books)</title></head><body><table>
      ${row(11, 'The Shining (The Shining, #1)', 'Stephen  King')}${row(22, 'Dracula', 'Bram Stoker')}</table></body></html>`;
    const page = parseListPage(html);
    expect(page.name).toBe('Best Horror Novels');
    expect(page.size).toBe(2139);
    expect(page.books).toEqual([
      { bookId: '11', title: 'The Shining', author: 'Stephen King', coverUrl: 'https://img/11.jpg', rank: 1 },
      { bookId: '22', title: 'Dracula', author: 'Bram Stoker', coverUrl: 'https://img/22.jpg', rank: 2 },
    ]);
  });
  it('continues ranking from the page offset', () => {
    const html = `<title>X (5 books)</title><table>${row(5, 'A Book', 'An Author')}</table>`;
    expect(parseListPage(html, 101).books[0].rank).toBe(101);
  });
  it('cleans titles', () => {
    expect(cleanListTitle('It (It, #1)')).toBe('It');
    expect(cleanListTitle('Plain Title')).toBe('Plain Title');
  });
});

describe('matching', () => {
  const result = (asin: string, title: string, author: string, formatType = 'unabridged') =>
    ({ asin, title, author, formatType }) as never;

  it('scores identical and different titles', () => {
    expect(similarity('The Shining', 'the shining')).toBe(1);
    expect(similarity('The Shining', 'Doctor Sleep')).toBeLessThan(0.5);
  });
  it('picks the right book and ignores a different author', () => {
    const results = [result('A1', 'Doctor Sleep', 'Stephen King'), result('A2', 'The Shining Girls', 'Lauren Beukes'), result('A3', 'The Shining', 'Stephen King')];
    expect(pickBestMatch('The Shining', 'Stephen King', results)?.asin).toBe('A3');
  });
  it('returns null when nothing is close enough', () => {
    expect(pickBestMatch('The Shining', 'Stephen King', [result('A1', 'Cujo', 'Stephen King')])).toBeNull();
  });
  it('matches a title that Audible prefixes with a series name', () => {
    const results = [result('D1', 'The Dark Tower I: The Gunslinger', 'Stephen King'), result('D2', 'The Dark Tower II: The Drawing of the Three', 'Stephen King')];
    expect(pickBestMatch('The Gunslinger', 'Stephen King', results)?.asin).toBe('D1');
    expect(pickBestMatch('The Drawing of the Three', 'Stephen King', results)?.asin).toBe('D2');
    expect(pickBestMatch('On Writing: A Memoir of the Craft', 'Stephen King', [result('W', 'On Writing: 10th Anniversary Edition', 'Stephen King')])?.asin).toBe('W');
  });
  it('uses the subtitle when Audible keeps the real name there', () => {
    const results = [
      { asin: 'D1', title: 'Dark Tower I', subtitle: 'The Gunslinger', author: 'Stephen King', formatType: 'unabridged' },
      { asin: 'G2', title: 'Gunslinger', subtitle: 'The Life of Brett Favre', author: 'Jeff Pearlman', formatType: 'unabridged' },
    ] as never;
    expect(pickBestMatch('The Gunslinger', 'Stephen King', results)?.asin).toBe('D1');
  });
  it('does not let a single common word match a longer title, or another author match', () => {
    expect(pickBestMatch('It', 'Stephen King', [result('X', 'It Ends with Us', 'Colleen Hoover')])).toBeNull();
    expect(pickBestMatch('The Shining', 'Stephen King', [result('Y', 'The Shining Girls', 'Lauren Beukes')])).toBeNull();
  });
  it('prefers the unabridged edition of the same title', () => {
    const results = [result('AB', 'It', 'Stephen King', 'abridged'), result('UN', 'It', 'Stephen King', 'unabridged')];
    expect(pickBestMatch('It', 'Stephen King', results)?.asin).toBe('UN');
  });
});

describe('filter rules', () => {
  it('drops box sets and excluded patterns before matching', () => {
    expect(preFilter('The Expanse Boxed Set', 'James Corey', rules())).toBe('box set / omnibus');
    expect(preFilter('Books 1-3 Omnibus', 'X', rules())).toBe('box set / omnibus');
    expect(preFilter('Coloring Book', 'X', rules({ titleExcludePatterns: ['coloring'] }))).toBe('title excluded');
    expect(preFilter('A Normal Book', 'X', rules())).toBeNull();
  });
  it('applies the strict Audible rules', () => {
    const good = { asin: 'A', title: 't', author: 'a', rating: 4.5, durationMinutes: 600, language: 'english', formatType: 'unabridged' };
    expect(deepFilter(good, rules())).toBeNull();
    expect(deepFilter({ ...good, rating: 3 }, rules())).toBe('rating too low');
    expect(deepFilter({ ...good, durationMinutes: 30 }, rules())).toBe('too short');
    expect(deepFilter({ ...good, language: 'german' }, rules())).toBe('language');
    expect(deepFilter({ ...good, formatType: 'abridged' }, rules())).toBe('abridged');
    expect(deepFilter({ ...good, genres: ['Erotica'] }, rules({ excludedGenres: ['erotica'] }))).toBe('genre excluded');
  });
  it('knows when no Audible data is needed and validates patterns', () => {
    expect(needsMetadata(rules({ allowAbridged: true, minRuntimeMinutes: 0, allowedLanguages: [], minAudibleRating: 0 }))).toBe(false);
    expect(needsMetadata(rules())).toBe(true);
    expect(firstInvalidPattern(['ok', '(unclosed'])).toBe('(unclosed');
    expect(firstInvalidPattern(['fine'])).toBeNull();
  });
});

describe('ownership check', () => {
  const index = { asins: new Set(['B001']), keys: new Set([ownedKey('Stephen King', 'Cujo')!]) };
  it('matches by ASIN, and by title and author under a different ASIN', () => {
    expect(ownedHow(index, [{ asin: 'B001', title: 'x', author: 'y' }])).toBe('asin');
    expect(ownedHow(index, [{ asin: 'B999', title: 'Cujo', author: 'Stephen King' }])).toBe('title and author');
    expect(ownedHow(index, [{ asin: 'B999', title: 'Pet Sematary', author: 'Stephen King' }])).toBeNull();
  });
  it('ignores series suffixes, leading numbers and subtitles', () => {
    expect(ownedKey('Stephen King', '01 Cujo')).toBe(ownedKey('Stephen King', 'Cujo (A Novel, #1)'));
    expect(ownedKey('Stephen King', 'Cujo: A Novel')).toBe(ownedKey('Stephen King', 'Cujo'));
  });
});

describe('when a list is due', () => {
  const now = Date.UTC(2026, 10, 2, 12);
  const base = { enabled: true, syncIntervalHours: 24, lastSyncedAt: null, lastSuccessfulSyncAt: null, lastError: null };
  it('is due when never synced, and after its interval', () => {
    expect(isDue(base, now)).toBe(true);
    expect(isDue({ ...base, lastSyncedAt: new Date(now - 3600_000), lastSuccessfulSyncAt: new Date(now - 25 * 3600_000) }, now)).toBe(true);
    expect(isDue({ ...base, lastSyncedAt: new Date(now - 3600_000), lastSuccessfulSyncAt: new Date(now - 3600_000) }, now)).toBe(false);
  });
  it('skips paused lists and backs off for an hour after an error', () => {
    expect(isDue({ ...base, enabled: false }, now)).toBe(false);
    expect(isDue({ ...base, lastError: 'boom', lastSyncedAt: new Date(now - 600_000) }, now)).toBe(false);
    expect(isDue({ ...base, lastError: 'boom', lastSyncedAt: new Date(now - 2 * 3600_000) }, now)).toBe(true);
  });
});
