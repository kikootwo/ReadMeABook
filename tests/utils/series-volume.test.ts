/**
 * Component: Series Volume Rules Tests
 * Documentation: documentation/integrations/audible.md
 */

import { describe, expect, it } from 'vitest';
import {
  isDifferentVolume,
  isSameSeries,
  normalizePosition,
  partitionVolumes,
  positionsSettled,
} from '@/lib/utils/series-volume';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const SERIES = 'B0H3C5X19W';
const TITLE = 'Die Tagebücher der Apothekerin';

function book(asin: string, overrides: Partial<AudibleAudiobook> = {}): AudibleAudiobook {
  return { asin, title: TITLE, author: 'Author', ...overrides };
}

describe('normalizePosition', () => {
  it('treats "1" and "1.0" as the same position', () => {
    expect(normalizePosition('1')).toBe('1');
    expect(normalizePosition('1.0')).toBe('1');
  });

  it('reads one-number labels and decimals', () => {
    expect(normalizePosition('1. Titel')).toBe('1');
    expect(normalizePosition('Book 1.5')).toBe('1.5');
    expect(normalizePosition('1,5')).toBe('1.5');
    expect(normalizePosition('Vol. 1')).toBe('1');
    expect(normalizePosition('Band 2')).toBe('2');
    expect(normalizePosition('0')).toBe('0');
  });

  it('treats ranges, empty and title-like text as unknown', () => {
    expect(normalizePosition('1-3')).toBeUndefined();
    expect(normalizePosition('')).toBeUndefined();
    expect(normalizePosition(undefined)).toBeUndefined();
    expect(normalizePosition('Keeping 13 - Mettiti in gioco')).toBeUndefined();
    expect(normalizePosition('Book 1 of 3')).toBeUndefined();
  });
});

describe('isDifferentVolume', () => {
  const v = (asin: string, part?: string, extra: Partial<AudibleAudiobook> = {}) =>
    book(asin, { seriesAsin: SERIES, seriesPart: part, ...extra });

  it('vetoes the same series with known, different positions at every level', () => {
    for (const level of ['heal', 'dedup', 'collapse'] as const) {
      expect(isDifferentVolume(v('A', '1'), v('B', '2'), level)).toBe(true);
    }
  });

  it('position "0" vetoes position "1"', () => {
    expect(isDifferentVolume(v('A', '0'), v('B', '1'), 'heal')).toBe(true);
  });

  it('is compatible when one position is unknown or both are the same', () => {
    expect(isDifferentVolume(v('A', '1'), v('B'), 'collapse')).toBe(false);
    expect(isDifferentVolume(v('A', '1'), v('B', '1.0'), 'collapse')).toBe(false);
  });

  it('is compatible across different series ASINs (same recording in two series)', () => {
    expect(isDifferentVolume(v('A', '8'), v('B', '1', { seriesAsin: 'B0OTHER001' }), 'collapse')).toBe(false);
  });

  it('uses the series name only when a series ASIN is missing', () => {
    const named = (asin: string, part: string, extra: Partial<AudibleAudiobook> = {}) =>
      book(asin, { series: 'Die Tagebücher der Apothekerin', seriesPart: part, ...extra });
    expect(isDifferentVolume(named('A', '1'), named('B', '2'), 'heal')).toBe(true);
    expect(isDifferentVolume(named('A', '1', { seriesAsin: SERIES }), named('B', '2'), 'heal')).toBe(true);
    expect(isSameSeries(named('A', '1', { seriesAsin: SERIES }), named('B', '2', { seriesAsin: 'B0OTHER001' }))).toBe(false);
  });

  it('vetoes "Band 2" vs "Band 3" in the subtitle when the series-name prefix is equal', () => {
    const a = book('A', { subtitle: 'Die Tagebücher der Apothekerin (Light Novels), Band 2' });
    const b = book('B', { subtitle: 'Die Tagebücher der Apothekerin (Light Novels), Band 3' });
    expect(isDifferentVolume(a, b, 'dedup')).toBe(true);
    expect(isDifferentVolume(a, b, 'heal')).toBe(false);
  });

  it('does not veto keyword numbers under different series names (one recording in two series)', () => {
    const a = book('A', { subtitle: 'Discworld, Book 8' });
    const b = book('B', { subtitle: 'City Watch, Book 1' });
    expect(isDifferentVolume(a, b, 'collapse')).toBe(false);
  });

  it('compares like with like: a title number never meets a subtitle number', () => {
    const a = book('A', { title: 'Catch 22' });
    const b = book('B', { title: 'Catch', subtitle: 'Some Series, Book 1' });
    expect(isDifferentVolume(a, b, 'dedup')).toBe(false);
  });

  it('applies the bare trailing title number only in the collapse', () => {
    const a = book('A', { title: `${TITLE} 4` });
    const b = book('B', { title: `${TITLE} 5` });
    expect(isDifferentVolume(a, b, 'collapse')).toBe(true);
    expect(isDifferentVolume(a, b, 'dedup')).toBe(false);
    expect(isDifferentVolume(a, b, 'heal')).toBe(false);
  });

  it('keeps "Fahrenheit 451" and "Fahrenheit 451 (Unabridged)" compatible', () => {
    expect(isDifferentVolume(book('A', { title: 'Fahrenheit 451' }), book('B', { title: 'Fahrenheit 451 (Unabridged)' }), 'collapse')).toBe(false);
  });
});

describe('positionsSettled', () => {
  it('is settled when every member has a known position or none is in a series', () => {
    expect(positionsSettled([book('A', { seriesAsin: SERIES, seriesPart: '1' }), book('B', { seriesAsin: SERIES, seriesPart: '1' })])).toBe(true);
    expect(positionsSettled([book('A'), book('B')])).toBe(true);
  });

  it('is not settled when a series member has no position', () => {
    expect(positionsSettled([book('A', { seriesAsin: SERIES }), book('B', { seriesAsin: SERIES })])).toBe(false);
    expect(positionsSettled([book('A', { series: 'X', seriesPart: '1' }), book('B')])).toBe(false);
  });
});

describe('partitionVolumes', () => {
  const v = (asin: string, part?: string) => book(asin, { seriesAsin: SERIES, seriesPart: part });

  it('starts from the canonical ASIN and splits known different positions', () => {
    const classes = partitionVolumes([v('V2', '2'), v('V1', '1'), v('V3', '3'), v('V2b', '2')], 'V1', 'heal');
    expect(classes.map((c) => c.map((b) => b.asin))).toEqual([['V1'], ['V2', 'V2b'], ['V3']]);
  });

  it('uses the first book as the anchor when the canonical ASIN is not in view', () => {
    const classes = partitionVolumes([v('V2', '2'), v('V1', '1')], 'GONE', 'heal');
    expect(classes[0][0].asin).toBe('V2');
  });

  it('keeps unknown positions with the first class they fit', () => {
    const classes = partitionVolumes([v('R'), v('V1', '1'), v('V2', '2')], undefined, 'heal');
    expect(classes.map((c) => c.map((b) => b.asin))).toEqual([['R', 'V1'], ['V2']]);
  });
});
