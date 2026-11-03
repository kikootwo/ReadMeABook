/**
 * Component: Audible Language Filter Split Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * partitionByLanguage is the one rule every filtered list uses. It must accept both
 * value forms Audible sends: catalog API names ('german') and series-page labels ('Deutsch').
 */

import { describe, expect, it } from 'vitest';
import * as languageConfig from '@/lib/constants/language-config';
import type { SupportedLanguage } from '@/lib/constants/language-config';
import { AUDIBLE_REGIONS, type AudibleRegion } from '@/lib/types/audible';

/** Read through the module so a missing export fails on an assertion, not a TypeError */
function exported<K extends keyof typeof languageConfig>(name: K): (typeof languageConfig)[K] {
  expect(languageConfig[name], `${name} is exported`).toBeDefined();
  return languageConfig[name];
}

const split = (languages: Array<string | undefined | null>, region: AudibleRegion) => {
  const partitionByLanguage = exported('partitionByLanguage');
  const { kept, hidden } = partitionByLanguage(
    languages.map((language, index) => ({ index, language })),
    (item) => item.language,
    languageConfig.getLanguageForRegion(region),
  );
  return { kept: kept.map((item) => item.index), hidden: hidden.map((item) => item.index) };
};

// Per language: the catalog API value, the series-page label, and one other language
const FORMS: Array<[AudibleRegion, string, string, string]> = [
  ['us', 'english', 'English', 'spanish'],
  ['uk', 'english', 'English', 'Español'],
  ['de', 'german', 'Deutsch', 'english'],
  ['es', 'spanish', 'Español', 'english'],
  ['fr', 'french', 'Français', 'English'],
  ['it', 'italian', 'Italiano', 'english'],
];

describe('partitionByLanguage', () => {
  it.each(FORMS)('region %s keeps "%s" and "%s", hides "%s"', (region, catalogValue, pageLabel, other) => {
    expect(split([catalogValue, pageLabel, other], region)).toEqual({ kept: [0, 1], hidden: [2] });
  });

  it('keeps items with no language, a blank one or whitespace', () => {
    expect(split([undefined, null, '', '   '], 'de')).toEqual({ kept: [0, 1, 2, 3], hidden: [] });
  });

  it('hides a language value it does not know, and ignores case and spaces', () => {
    expect(split(['castilian', '  GERMAN ', 'deutsch'], 'de')).toEqual({ kept: [1, 2], hidden: [0] });
  });

  it('keeps the input order in both lists', () => {
    expect(split(['french', 'english', undefined, 'english', 'français'], 'fr')).toEqual({ kept: [0, 2, 4], hidden: [1, 3] });
  });
});

describe('LANGUAGE_DISPLAY_NAMES', () => {
  it('names the language of every region', () => {
    const LANGUAGE_DISPLAY_NAMES = exported('LANGUAGE_DISPLAY_NAMES');
    const names = Object.fromEntries(
      (Object.keys(AUDIBLE_REGIONS) as AudibleRegion[]).map((region) => [region, LANGUAGE_DISPLAY_NAMES[AUDIBLE_REGIONS[region].language as SupportedLanguage]]),
    );
    expect(names).toEqual({
      us: 'English', ca: 'English', uk: 'English', au: 'English', in: 'English',
      de: 'German', es: 'Spanish', fr: 'French', it: 'Italian',
    });
  });
});
