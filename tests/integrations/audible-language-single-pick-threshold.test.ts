/**
 * Component: Language Filter Single-Pick Threshold Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * pickSearchMatch on its own: the first result kept as before unless it was hidden, then
 * the title share bar, the subtitle, a trailing "(Series, #1)", and the explicit-language
 * rule. Callers are covered in audible-language-single-pick.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { pickSearchMatch, SINGLE_PICK_TITLE_SHARE } from '@/lib/integrations/audible-language-filter';

const book = (title: string, language = 'english') => ({ asin: title, title, author: 'A', language });

describe('pickSearchMatch title threshold (80% of the requested words)', () => {
  // The page's first product was in another language and hidden
  const on = { language: 'en' as const, hiddenCount: 1, firstResultHidden: true };

  it('accepts 4 of 5 requested words and rejects 3 of 5', () => {
    const search = { results: [book('Alpha Bravo Charlie'), book('Alpha Bravo Charlie Delta')], languageFilter: on };

    expect(pickSearchMatch(search, 'Alpha Bravo Charlie Delta Echo')?.asin).toBe('Alpha Bravo Charlie Delta');
    expect(pickSearchMatch({ ...search, results: [search.results[0]] }, 'Alpha Bravo Charlie Delta Echo')).toBeUndefined();
  });

  it('reads the subtitle too, and leaves out a trailing "(Series, #1)"', () => {
    const search = { results: [{ ...book('The Final Empire'), subtitle: 'Mistborn, Book 1' }], languageFilter: on };

    expect(pickSearchMatch(search, 'Mistborn: The Final Empire')?.asin).toBe('The Final Empire');
    expect(pickSearchMatch(search, 'The Final Empire (Mistborn, #1)')?.asin).toBe('The Final Empire');
  });

  it('leaves out only the last parenthetical group, not everything from the first "("', () => {
    const search = { results: [book('Foo')], languageFilter: on };

    expect(pickSearchMatch(search, 'Foo (Illustrated) Bar Baz (Series, #2)')).toBeUndefined();
    expect(pickSearchMatch(search, 'Foo (Series, #2)')?.asin).toBe('Foo');
  });
});

describe('pickSearchMatch with the first result kept (accepted language or none listed)', () => {
  const kept = { language: 'en' as const, hiddenCount: 2, firstResultHidden: false };

  it('takes the first result as before, whatever its title', () => {
    expect(pickSearchMatch({ results: [book('The Hobbit')], languageFilter: kept }, 'The Hobbit, or There and Back Again')?.asin).toBe('The Hobbit');
    expect(pickSearchMatch({ results: [book('A Podcast', '')], languageFilter: kept }, 'Something Else')?.asin).toBe('A Podcast');
  });
});

describe('pickSearchMatch language rule', () => {
  const on = { language: 'de' as const, hiddenCount: 1, firstResultHidden: true };
  const result = (language?: string) => ({ asin: language ?? 'none', title: 'Six of Crows', author: 'A', language });

  it('takes only an explicitly accepted language with the filter on; a result with no language is not enough', () => {
    expect(SINGLE_PICK_TITLE_SHARE).toBe(0.8);
    expect(pickSearchMatch({ results: [result(), result('english'), result('german')], languageFilter: on }, 'Six of Crows')?.asin).toBe('german');
    expect(pickSearchMatch({ results: [result(), result('english')], languageFilter: on }, 'Six of Crows')).toBeUndefined();
  });

  it('off: the first result, whatever its language or title', () => {
    expect(pickSearchMatch({ results: [result('english'), result('german')] }, 'Something Else')?.asin).toBe('english');
    expect(pickSearchMatch({ results: [] }, 'Six of Crows')).toBeUndefined();
  });
});
