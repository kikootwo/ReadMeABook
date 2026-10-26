/**
 * Component: Catalog Series Choice Tests (pickCatalogSeries)
 * Documentation: documentation/integrations/audible.md
 */

import { describe, expect, it } from 'vitest';
import { pickCatalogSeries } from '@/lib/integrations/audible-series-fill';

const NONE = { series: undefined, seriesPart: undefined, seriesAsin: undefined };

describe('pickCatalogSeries', () => {
  it.each([
    ['no array', undefined],
    ['an empty array', []],
  ])('returns no series for %s', (_label, entries) => {
    expect(pickCatalogSeries(entries)).toEqual(NONE);
  });

  it('picks the first entry with a sequence, even if it is not first', () => {
    expect(pickCatalogSeries([
      { asin: 'S000', title: 'Wrong Series', sequence: '' },
      { asin: 'S001', title: 'Right Series', sequence: '3' },
    ])).toEqual({ series: 'Right Series', seriesPart: '3', seriesAsin: 'S001' });
  });

  it('treats a whitespace-only sequence as no sequence', () => {
    expect(pickCatalogSeries([
      { asin: 'S010', title: 'Blank Sequence', sequence: '   ' },
      { asin: 'S011', title: 'Numbered', sequence: '1' },
    ])).toEqual({ series: 'Numbered', seriesPart: '1', seriesAsin: 'S011' });
  });

  it('falls back to the first entry, without a part, when no entry has a sequence', () => {
    expect(pickCatalogSeries([
      { asin: 'S020', title: 'Fallback Series', sequence: ' ' },
      { asin: 'S021', title: 'Other Series' },
    ])).toEqual({ series: 'Fallback Series', seriesPart: undefined, seriesAsin: 'S020' });
  });

  it.each([
    ['2, Dramatized Adaptation', '2'],
    ['1.5', '1.5'],
    ['Prequel', 'Prequel'],
  ])('reads the part from sequence %j as %j', (sequence, part) => {
    expect(pickCatalogSeries([{ asin: 'S030', title: 'Series', sequence }]).seriesPart).toBe(part);
  });

  it('keeps a missing title or asin missing', () => {
    expect(pickCatalogSeries([{ sequence: '4' }])).toEqual({ series: undefined, seriesPart: '4', seriesAsin: undefined });
    expect(pickCatalogSeries([{ title: 'No Asin', sequence: '4' }])).toEqual({ series: 'No Asin', seriesPart: '4', seriesAsin: undefined });
  });
});
