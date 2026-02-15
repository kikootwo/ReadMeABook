/**
 * Component: German Locale & Label Stripping Tests
 * Tests for region-aware label prefix stripping and locale config
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIBLE_REGIONS,
  stripLabelPrefixes,
  getRegionConfig,
} from '@/lib/types/audible';

describe('stripLabelPrefixes', () => {
  const dePrefixes = AUDIBLE_REGIONS.de.labelPrefixes;
  const usPrefixes = AUDIBLE_REGIONS.us.labelPrefixes;

  describe('German author labels', () => {
    it('strips "Von:" prefix', () => {
      expect(stripLabelPrefixes('Von: Michael Ende', dePrefixes.author)).toBe('Michael Ende');
    });

    it('strips "Geschrieben von:" prefix', () => {
      expect(stripLabelPrefixes('Geschrieben von: Sebastian Fitzek', dePrefixes.author)).toBe('Sebastian Fitzek');
    });

    it('strips "Autor:" prefix', () => {
      expect(stripLabelPrefixes('Autor: Hermann Hesse', dePrefixes.author)).toBe('Hermann Hesse');
    });

    it('also strips English "By:" on German region', () => {
      expect(stripLabelPrefixes('By: Stephen King', dePrefixes.author)).toBe('Stephen King');
    });

    it('preserves text without prefix', () => {
      expect(stripLabelPrefixes('Michael Ende', dePrefixes.author)).toBe('Michael Ende');
    });

    it('preserves umlauts in author names', () => {
      expect(stripLabelPrefixes('Von: Günter Grass', dePrefixes.author)).toBe('Günter Grass');
    });
  });

  describe('German narrator labels', () => {
    it('strips "Gesprochen von:" prefix', () => {
      expect(stripLabelPrefixes('Gesprochen von: Rufus Beck', dePrefixes.narrator)).toBe('Rufus Beck');
    });

    it('strips "Sprecher:" prefix', () => {
      expect(stripLabelPrefixes('Sprecher: Simon Jäger', dePrefixes.narrator)).toBe('Simon Jäger');
    });

    it('also strips English "Narrated by:" on German region', () => {
      expect(stripLabelPrefixes('Narrated by: John Smith', dePrefixes.narrator)).toBe('John Smith');
    });
  });

  describe('English author labels', () => {
    it('strips "By:" prefix', () => {
      expect(stripLabelPrefixes('By: Stephen King', usPrefixes.author)).toBe('Stephen King');
    });

    it('strips "Written by:" prefix', () => {
      expect(stripLabelPrefixes('Written by: J.K. Rowling', usPrefixes.author)).toBe('J.K. Rowling');
    });
  });

  describe('English narrator labels', () => {
    it('strips "Narrated by:" prefix', () => {
      expect(stripLabelPrefixes('Narrated by: Jim Dale', usPrefixes.narrator)).toBe('Jim Dale');
    });
  });

  describe('case insensitivity', () => {
    it('strips prefix regardless of case', () => {
      expect(stripLabelPrefixes('von: Michael Ende', dePrefixes.author)).toBe('Michael Ende');
      expect(stripLabelPrefixes('VON: Michael Ende', dePrefixes.author)).toBe('Michael Ende');
    });
  });
});

describe('getRegionConfig', () => {
  it('returns correct config for German region', () => {
    const config = getRegionConfig('de');
    expect(config.code).toBe('de');
    expect(config.baseUrl).toBe('https://www.audible.de');
    expect(config.isEnglish).toBe(false);
    expect(config.languageParam).toBeUndefined();
    expect(config.acceptLanguage).toContain('de-DE');
  });

  it('returns correct config for US region', () => {
    const config = getRegionConfig('us');
    expect(config.code).toBe('us');
    expect(config.languageParam).toBe('english');
    expect(config.acceptLanguage).toContain('en-US');
  });

  it('German region accepts both German and English content', () => {
    const config = getRegionConfig('de');
    expect(config.acceptedContentLanguages).toContain('deutsch');
    expect(config.acceptedContentLanguages).toContain('german');
    expect(config.acceptedContentLanguages).toContain('english');
  });

  it('US region only accepts English content', () => {
    const config = getRegionConfig('us');
    expect(config.acceptedContentLanguages).toEqual(['english']);
  });

  it('German region has German label prefixes', () => {
    const config = getRegionConfig('de');
    expect(config.labelPrefixes.author).toContain('Von:');
    expect(config.labelPrefixes.narrator).toContain('Gesprochen von:');
    expect(config.labelPrefixes.language).toContain('Sprache:');
    expect(config.labelPrefixes.length).toContain('Dauer:');
    expect(config.labelPrefixes.releaseDate).toContain('Erscheinungsdatum:');
  });
});
