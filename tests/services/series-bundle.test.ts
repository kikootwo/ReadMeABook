/**
 * Component: Series Bundle Detection Tests
 * Documentation: documentation/features/series-bundle-decomposition.md
 *
 * Covers detectBundle (pure heuristics) and enumerateSeriesBooks (series-page
 * enumeration + range narrowing), with scrapeSeriesPage mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockScrapeSeriesPage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/integrations/audible-series', () => ({
  scrapeSeriesPage: (...args: any[]) => mockScrapeSeriesPage(...args),
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

import { detectBundle, enumerateSeriesBooks } from '@/lib/services/series-bundle.service';

const SERIES_ASIN = 'B00SERIES1';

describe('detectBundle', () => {
  it('returns false without a seriesAsin (nothing to enumerate)', () => {
    expect(detectBundle({ title: 'The Mistborn Trilogy' }).isBundle).toBe(false);
  });

  it('detects a multi-position seriesPart as a bundle and captures the range', () => {
    const r = detectBundle({ title: 'Mistborn', seriesPart: '1-3', seriesAsin: SERIES_ASIN });
    expect(r.isBundle).toBe(true);
    expect(r.range).toEqual([1, 3]);
  });

  it('detects strong title keywords (trilogy/box set/omnibus) with a seriesAsin', () => {
    for (const title of ['The Mistborn Trilogy', 'Dune Box Set', 'Foundation Omnibus', 'The Complete Series']) {
      expect(detectBundle({ title, seriesAsin: SERIES_ASIN }).isBundle).toBe(true);
    }
  });

  it('captures a title-embedded range like "Books 1-3"', () => {
    const r = detectBundle({ title: 'The Stormlight Archive, Books 1-3', seriesAsin: SERIES_ASIN });
    expect(r.isBundle).toBe(true);
    expect(r.range).toEqual([1, 3]);
  });

  it('infers a [1, N] range from an "-logy" keyword when no explicit range is present', () => {
    expect(detectBundle({ title: 'The Mistborn Trilogy', seriesAsin: SERIES_ASIN }).range).toEqual([1, 3]);
    expect(detectBundle({ title: 'An Epic Tetralogy', seriesAsin: SERIES_ASIN }).range).toEqual([1, 4]);
    expect(detectBundle({ title: 'The Pentalogy', seriesAsin: SERIES_ASIN }).range).toEqual([1, 5]);
  });

  it('leaves open-ended bundle keywords (box set / complete / omnibus) without a range', () => {
    expect(detectBundle({ title: 'Dune Box Set', seriesAsin: SERIES_ASIN }).range).toBeUndefined();
    expect(detectBundle({ title: 'The Complete Series', seriesAsin: SERIES_ASIN }).range).toBeUndefined();
    expect(detectBundle({ title: 'Foundation Omnibus', seriesAsin: SERIES_ASIN }).range).toBeUndefined();
  });

  it('treats weak keywords as a bundle only with a long runtime', () => {
    expect(detectBundle({ title: 'The Dune Collection', seriesAsin: SERIES_ASIN }).isBundle).toBe(false);
    expect(
      detectBundle({ title: 'The Dune Collection', seriesAsin: SERIES_ASIN, durationMinutes: 2400 }).isBundle
    ).toBe(true);
  });

  it('does not flag an ordinary single book', () => {
    expect(
      detectBundle({ title: 'The Way of Kings', seriesPart: '1', seriesAsin: SERIES_ASIN, durationMinutes: 2700 }).isBundle
    ).toBe(false);
  });
});

describe('enumerateSeriesBooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const book = (asin: string, title: string, seriesPart?: string) => ({
    asin,
    title,
    author: 'Brandon Sanderson',
    narrator: 'Michael Kramer',
    coverArtUrl: `http://img/${asin}.jpg`,
    seriesPart,
  });

  it('returns all books when no range is given', async () => {
    mockScrapeSeriesPage.mockResolvedValueOnce({
      books: [book('B1', 'Book One', '1'), book('B2', 'Book Two', '2'), book('B3', 'Book Three', '3')],
      hasMore: false,
    });

    const result = await enumerateSeriesBooks(SERIES_ASIN);
    expect(result.map((b) => b.asin)).toEqual(['B1', 'B2', 'B3']);
    expect(result[0]).toMatchObject({ title: 'Book One', author: 'Brandon Sanderson', narrator: 'Michael Kramer' });
  });

  it('narrows to the requested position range and excludes unknown positions', async () => {
    mockScrapeSeriesPage.mockResolvedValueOnce({
      books: [
        book('B1', 'Book One', '1'),
        book('B2', 'Book Two', '2'),
        book('B3', 'Book Three', '3'),
        book('BX', 'Companion', undefined),
      ],
      hasMore: false,
    });

    const result = await enumerateSeriesBooks(SERIES_ASIN, [1, 2]);
    expect(result.map((b) => b.asin)).toEqual(['B1', 'B2']);
  });

  it('excludes the bundle ASIN and nested bundle-looking items', async () => {
    mockScrapeSeriesPage.mockResolvedValueOnce({
      books: [
        book('BUNDLE', 'The Trilogy', '1-3'),
        book('B1', 'Book One', '1'),
        book('NESTED', 'Box Set Volume', '2'),
      ],
      hasMore: false,
    });

    const result = await enumerateSeriesBooks(SERIES_ASIN, undefined, 'BUNDLE');
    expect(result.map((b) => b.asin)).toEqual(['B1']);
  });

  it('returns empty when the series cannot be scraped', async () => {
    mockScrapeSeriesPage.mockResolvedValueOnce(null);
    expect(await enumerateSeriesBooks(SERIES_ASIN)).toEqual([]);
  });
});
