/**
 * Component: Centralized Language Configuration Tests
 * Documentation: documentation/integrations/audible.md
 */

import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_CONFIGS,
  getLanguageForRegion,
  isAcceptedLanguage,
  stripPrefixes,
} from '@/lib/constants/language-config';
import { AUDIBLE_REGIONS, type AudibleRegion } from '@/lib/types/audible';
import { parseRuntime } from '@/lib/utils/parse-runtime';

const REGIONS = Object.keys(AUDIBLE_REGIONS) as AudibleRegion[];

describe('region to language mapping', () => {
  it.each(REGIONS)('resolves a full language config for region %s', (region) => {
    const config = getLanguageForRegion(region);

    expect(config).toBeDefined();
    expect(config.code).toBe(AUDIBLE_REGIONS[region].language);
    expect(config).toBe(LANGUAGE_CONFIGS[AUDIBLE_REGIONS[region].language]);
    expect(config.scraping.acceptedLanguageValues.length).toBeGreaterThan(0);
  });

  it('maps the Italy region to the Italian config', () => {
    const config = getLanguageForRegion('it');

    expect(config.code).toBe('it');
    expect(config.annasArchiveLang).toBe('it');
    expect(config.epubCode).toBe('it');
    expect(config.scraping.audibleLocaleParam).toBe('italiano');
  });
});

describe('Italian config', () => {
  const IT = getLanguageForRegion('it');

  it.each([
    ['5 ore e 54 min', 354],
    ['Durata: 26 ore e 4 min', 1564],
    ['1 ora', 60],
    ['2 ore', 120],
    ['45 min', 45],
    ['1 ora e 1 minuto', 61],
  ])('parses runtime "%s" as %i minutes', (text, minutes) => {
    expect(parseRuntime(text, IT)).toBe(minutes);
  });

  it('does not read words that merely start with "or" as hours', () => {
    expect(parseRuntime('3 orecchie', IT)).toBeUndefined();
    expect(parseRuntime('2 orari', IT)).toBeUndefined();
  });

  it('strips Italian author and narrator labels', () => {
    expect(stripPrefixes('Di: Elena Ferrante', IT.scraping.authorPrefixes)).toBe('Elena Ferrante');
    expect(stripPrefixes('Letto da: Anna Bonaiuto', IT.scraping.narratorPrefixes)).toBe('Anna Bonaiuto');
  });

  it('accepts Italian language values and rejects others', () => {
    expect(isAcceptedLanguage('italiano', IT)).toBe(true);
    expect(isAcceptedLanguage('Italian', IT)).toBe(true);
    expect(isAcceptedLanguage(' Italiano ', IT)).toBe(true);
    expect(isAcceptedLanguage('english', IT)).toBe(false);
    expect(isAcceptedLanguage('spanish', IT)).toBe(false);
  });

  it('uses the series and length labels shown on audible.it', () => {
    expect(IT.scraping.seriesLabels).toContain('Serie:');
    expect(IT.scraping.lengthLabels).toContain('Durata:');
  });
});
