/**
 * Component: Language Filter Page States Tests (search, series, series detail; #259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * Real hooks and SWR over a fake fetcher. While the filter is on (responses carry
 * hiddenCount): the "N in other languages hidden" line, the Load more bar with nothing
 * shown yet, and a "No results in {Language}" empty state. Off: the pages as before.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../helpers/render';

// Plain holder: the config's mockReset clears vi.fn implementations per test
const api = vi.hoisted(() => ({ fetcher: (async () => ({})) as (url: string) => Promise<unknown>, hideAvailable: false }));
vi.mock('@/lib/utils/api', () => ({ authenticatedFetcher: (url: string) => api.fetcher(url) }));
vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    cardSize: 5, setCardSize: () => {}, squareCovers: false, setSquareCovers: () => {}, hideAvailable: api.hideAvailable, setHideAvailable: () => {},
  }),
}));
vi.mock('@/components/auth/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/layout/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/components/ui/SectionToolbar', () => ({ SectionToolbar: () => <div /> }));
vi.mock('@/components/audiobooks/AudiobookGrid', () => ({
  AudiobookGrid: ({ audiobooks, isLoading, emptyMessage }: { audiobooks: Array<{ asin: string }>; isLoading: boolean; emptyMessage: string }) =>
    isLoading ? <div data-testid="skeleton" /> : audiobooks.length === 0 ? <p>{emptyMessage}</p> : <ul>{audiobooks.map((b) => <li key={b.asin}>{b.asin}</li>)}</ul>,
}));
vi.mock('@/components/series/SeriesGrid', () => ({
  SeriesGrid: ({ series, isLoading, emptyMessage }: { series: Array<{ asin: string }>; isLoading: boolean; emptyMessage: string }) =>
    isLoading ? <div data-testid="skeleton" /> : series.length === 0 ? <p>{emptyMessage}</p> : <ul>{series.map((s) => <li key={s.asin}>{s.asin}</li>)}</ul>,
}));
vi.mock('@/components/series/SeriesDetailCard', () => ({ SeriesDetailCard: () => <div />, SeriesDetailSkeleton: () => <div /> }));
vi.mock('@/components/series/SimilarSeriesRow', () => ({ SimilarSeriesRow: () => <div />, SimilarSeriesSkeleton: () => <div /> }));

const pageOf = (url: string) => Number(new URL(url, 'http://x').searchParams.get('page'));
const HIDDEN_LINE = /in other languages hidden/;

async function search(query: string) {
  const { default: SearchPage } = await import('@/app/search/page');
  renderWithProviders(<SearchPage />);
  fireEvent.change(screen.getByPlaceholderText('Search by title, author, or narrator...'), { target: { value: query } });
  await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
}

beforeEach(() => {
  api.fetcher = async () => ({});
  api.hideAvailable = false;
});

/** Books already in the library: hide-available leaves them out */
const inLibrary = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ asin: `${prefix}${i}`, isAvailable: true }));

describe('search page', () => {
  it('on, every page hidden: the hidden line and the bar, not "No results found"', async () => {
    api.fetcher = async () => ({ success: true, results: [], totalResults: 0, hasMore: true, hiddenCount: 50, filterLanguage: 'French' });

    await search('english title');

    await waitFor(() => expect(screen.getByText('No results in French so far')).toBeInTheDocument());
    expect(screen.getByText('250 in other languages hidden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(screen.queryByText(/No results found/)).not.toBeInTheDocument();
  });

  it('on, nothing left: "No results in French" with the hidden line', async () => {
    api.fetcher = async () => ({ success: true, results: [], totalResults: 0, hasMore: false, hiddenCount: 12, filterLanguage: 'French' });

    await search('english title');

    await waitFor(() => expect(screen.getByText('No results in French for "english title"')).toBeInTheDocument());
    expect(screen.getByText('12 in other languages hidden')).toBeInTheDocument();
  });

  it('on, some kept: results, the hidden line and the bar', async () => {
    api.fetcher = async (url) => ({
      success: true, results: [{ asin: `B0KEPT000${pageOf(url)}` }], totalResults: 1, hasMore: true, hiddenCount: 37, filterLanguage: 'French',
    });

    await search('six of crows');

    await waitFor(() => expect(screen.getByText('B0KEPT0001')).toBeInTheDocument());
    expect(screen.getByText('37 in other languages hidden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('on, with hide-available emptying a page of kept results: "No results found", not the language bar', async () => {
    api.hideAvailable = true;
    api.fetcher = async () => ({ success: true, results: inLibrary('B0OWNED', 12), totalResults: 12, hasMore: true, hiddenCount: 38, filterLanguage: 'German' });

    await search('owned');

    await waitFor(() => expect(screen.getByText('No results found for "owned"')).toBeInTheDocument());
    expect(screen.queryByText('No results in German so far')).not.toBeInTheDocument();
    expect(screen.queryByText(/No results in German/)).not.toBeInTheDocument();
  });

  it('off: no hidden line, and an empty answer says "No results found"', async () => {
    api.fetcher = async () => ({ success: true, results: [], totalResults: 0, hasMore: false });

    await search('nothing');

    await waitFor(() => expect(screen.getByText('No results found for "nothing"')).toBeInTheDocument());
    expect(screen.queryByText(HIDDEN_LINE)).not.toBeInTheDocument();
  });
});

describe('series search page', () => {
  async function seriesPage(body: object) {
    api.fetcher = async () => body;
    const { default: SeriesPage } = await import('@/app/series/page');
    renderWithProviders(<SeriesPage />, { searchParams: 'q=cosmere' });
  }

  it('on, everything hidden: "No series in English" and the hidden line', async () => {
    await seriesPage({ success: true, series: [], query: 'cosmere', hiddenCount: 7, filterLanguage: 'English' });

    await waitFor(() => expect(screen.getByText('No series in English for "cosmere"')).toBeInTheDocument());
    expect(screen.getByText('7 in other languages hidden')).toBeInTheDocument();
  });

  it('on, some kept: the series and the hidden line', async () => {
    await seriesPage({ success: true, series: [{ asin: 'B0DMXGP353', title: 'The Cosmere', bookCount: 1, tags: [], audibleUrl: '' }], query: 'cosmere', hiddenCount: 6, filterLanguage: 'English' });

    await waitFor(() => expect(screen.getByText('B0DMXGP353')).toBeInTheDocument());
    expect(screen.getByText('6 in other languages hidden')).toBeInTheDocument();
  });

  it('off: "No series found" and no hidden line', async () => {
    await seriesPage({ success: true, series: [], query: 'cosmere' });

    await waitFor(() => expect(screen.getByText('No series found for "cosmere"')).toBeInTheDocument());
    expect(screen.queryByText(HIDDEN_LINE)).not.toBeInTheDocument();
  });
});

describe('series detail page', () => {
  const detail = (books: Array<{ asin: string }>, extra: object) => ({
    success: true,
    series: { asin: 'B0SERIES01', title: 'Saga', bookCount: 120, tags: [], books, similarSeries: [], audibleUrl: '', hasMore: true, page: 1 },
    hasMore: true,
    page: 1,
    ...extra,
  });

  async function detailPage(body: object) {
    api.fetcher = async () => body;
    const { default: SeriesDetailPage } = await import('@/app/series/[asin]/page');
    // One promise for every render: use() suspends again on a new one
    const params = Promise.resolve({ asin: 'B0SERIES01' });
    await act(async () => {
      renderWithProviders(<SeriesDetailPage params={params} />);
    });
  }

  it('on, a fully hidden page with more: the hidden line and the bar, no empty message', async () => {
    await detailPage(detail([], { hiddenCount: 50, filterLanguage: 'German' }));

    await waitFor(() => expect(screen.getByText('No books in German so far')).toBeInTheDocument());
    expect(screen.getByText('50 in other languages hidden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(screen.queryByText(/No books found/)).not.toBeInTheDocument();
  });

  it("on: the header and bar count the books shown, not Audible's total with other languages", async () => {
    await detailPage(detail([{ asin: 'B0EN000001' }, { asin: 'B0EN000002' }], { hiddenCount: 18, filterLanguage: 'English' }));

    await waitFor(() => expect(screen.getByText('(2 titles)')).toBeInTheDocument());
    expect(screen.getByText('2 books loaded')).toBeInTheDocument();
    expect(screen.getByText('18 in other languages hidden')).toBeInTheDocument();
    expect(screen.queryByText(/of 120/)).not.toBeInTheDocument();
  });

  it("off: the header and bar still count against Audible's total", async () => {
    await detailPage(detail([{ asin: 'B0EN000001' }, { asin: 'B0EN000002' }], {}));

    await waitFor(() => expect(screen.getByText('(2 of 120 titles)')).toBeInTheDocument());
    expect(screen.getByText('Showing 2 of 120 books')).toBeInTheDocument();
  });

  it('on, with hide-available emptying the kept books: "No books found", not the language message', async () => {
    api.hideAvailable = true;
    const body = detail(inLibrary('B0OWNED', 6), { hiddenCount: 4, filterLanguage: 'English' });
    await detailPage({ ...body, hasMore: false, series: { ...body.series, hasMore: false } });

    await waitFor(() => expect(screen.getByText('No books found for Saga')).toBeInTheDocument());
    expect(screen.queryByText(/No books in English/)).not.toBeInTheDocument();
    expect(screen.getByText('4 in other languages hidden')).toBeInTheDocument();
  });

  it('on, with hide-available and more pages: no "so far" bar while English books are loaded', async () => {
    api.hideAvailable = true;
    await detailPage(detail(inLibrary('B0OWNED', 6), { hiddenCount: 4, filterLanguage: 'English' }));

    await waitFor(() => expect(screen.getByText('No books found for Saga')).toBeInTheDocument());
    expect(screen.queryByText('No books in English so far')).not.toBeInTheDocument();
  });

  it('off: a page with no books shows the empty message and no bar, as before', async () => {
    await detailPage(detail([], {}));

    await waitFor(() => expect(screen.getByText('No books found for Saga')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.queryByText(HIDDEN_LINE)).not.toBeInTheDocument();
  });
});
