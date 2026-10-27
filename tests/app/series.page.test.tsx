/**
 * Component: Series Page Tests (search results, failure panel, Try again)
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../helpers/render';

// Plain holders: the config's mockReset clears vi.fn implementations per test
const api = vi.hoisted(() => ({
  urls: [] as string[],
  fetcher: (async () => ({ series: [] })) as (url: string) => Promise<unknown>,
}));
const grid = vi.hoisted(() => ({ renders: [] as Array<{ isLoading: boolean; count: number }> }));

vi.mock('@/lib/utils/api', () => ({
  authenticatedFetcher: (url: string) => {
    api.urls.push(url);
    return api.fetcher(url);
  },
}));

vi.mock('@/components/series/SeriesGrid', () => ({
  SeriesGrid: ({ series, isLoading, emptyMessage }: { series: Array<{ asin: string; title: string }>; isLoading: boolean; emptyMessage: string }) => {
    grid.renders.push({ isLoading, count: series.length });
    if (isLoading) return <div data-testid="series-skeleton" />;
    if (series.length === 0) return <p>{emptyMessage}</p>;
    return <ul>{series.map((s) => <li key={s.asin}>{s.title}</li>)}</ul>;
  },
}));

vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ cardSize: 5, setCardSize: () => {}, squareCovers: false, setSquareCovers: () => {} }),
}));
vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/Header', () => ({ Header: () => <div data-testid="header" /> }));

const QUERY = 'expeditionary force';
const KEY = `/api/series/search?q=${encodeURIComponent(QUERY)}`;
const AUDIBLE_HEADING = "Couldn't get results from Audible";
const EF = { asin: 'B01N9CUGHG', title: 'Expeditionary Force', bookCount: 22, tags: [], audibleUrl: 'https://www.audible.com/series/B01N9CUGHG' };

/** fetchJSON's error for a non-2xx answer */
function failure(status: number, message = 'Request failed') {
  return Object.assign(new Error(message), { status });
}

async function renderPage(search = `q=${QUERY}`, swr: Record<string, unknown> = {}) {
  const { default: SeriesPage } = await import('@/app/series/page');
  // A short retry interval: an automatic retry would show up within the waits below
  return renderWithProviders(<SeriesPage />, { searchParams: search, swr: { errorRetryInterval: 10, ...swr } });
}

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

beforeEach(() => {
  api.urls = [];
  api.fetcher = async () => ({ series: [] });
  grid.renders = [];
});

describe('series page search failures', () => {
  it('shows the Audible error once on a 502, with no automatic retry and no return to the skeleton', async () => {
    api.fetcher = async () => {
      throw failure(502, "Audible didn't return series results. Try again in a moment.");
    };

    await renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(AUDIBLE_HEADING);
    expect(alert).toHaveTextContent("Audible didn't return series results. Try again in a moment.");
    expect(screen.queryByText(/No series found/)).toBeNull();

    const rendersAtError = grid.renders.length;
    await wait(300);
    expect(api.urls).toEqual([KEY]);
    expect(grid.renders.slice(rendersAtError).some((r) => r.isLoading)).toBe(false);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The search box keeps focus when the first search fails
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Try again' }));
  });

  it.each([400, 500])('shows the generic failure, not the Audible copy, on a %i', async (status) => {
    api.fetcher = async () => {
      throw failure(status);
    };

    await renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Series search failed');
    expect(alert).not.toHaveTextContent(/Audible/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('runs the search again on Try again and shows the results', async () => {
    let call = 0;
    api.fetcher = async () => {
      call++;
      if (call === 1) throw failure(502);
      return { success: true, series: [EF], query: QUERY };
    };

    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Expeditionary Force')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.urls).toEqual([KEY, KEY]);
  });

  it('returns focus to Try again when the retry fails too', async () => {
    let rejectRetry: (error: Error) => void = () => {};
    let call = 0;
    api.fetcher = () => {
      call++;
      if (call === 1) return Promise.reject(failure(502));
      return new Promise((_resolve, reject) => {
        rejectRetry = reject;
      });
    };

    await renderPage();
    const button = await screen.findByRole('button', { name: 'Try again' });
    button.focus();
    fireEvent.click(button);

    // The panel gives way to the loading skeleton while the retry runs
    expect(await screen.findByTestId('series-skeleton')).toBeInTheDocument();
    await act(async () => rejectRetry(failure(502)));

    const again = await screen.findByRole('button', { name: 'Try again' });
    await waitFor(() => expect(document.activeElement).toBe(again));
  });

  it('keeps focus in the search box when the user types back to a query whose retry failed', async () => {
    api.fetcher = async (url) => {
      if (url === KEY) throw failure(502);
      return { success: true, series: [], query: 'other' };
    };

    await renderPage();
    const button = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(button);
    await waitFor(() => expect(api.urls).toEqual([KEY, KEY]));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' })));

    const input = screen.getByPlaceholderText('Search by series name...');
    input.focus();
    fireEvent.change(input, { target: { value: 'other' } });
    expect(await screen.findByText('No series found for "other"', {}, { timeout: 2000 })).toBeInTheDocument();

    // Back to the failed query: its cached error shows again, but the user is typing
    fireEvent.change(input, { target: { value: QUERY } });
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent(AUDIBLE_HEADING);
    await wait(50);
    expect(document.activeElement).toBe(input);
  });

  it('guard: shows "No series found" for an empty result, with no error panel', async () => {
    api.fetcher = async () => ({ success: true, series: [], query: QUERY });

    await renderPage();

    expect(await screen.findByText(`No series found for "${QUERY}"`)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sends no search for a whitespace-only query', async () => {
    await renderPage('q=%20%20%20');
    await wait(50);

    expect(api.urls).toEqual([]);
    expect(screen.getByText('Start typing to search for series')).toBeInTheDocument();
  });

  it('guard: keeps showing results it already has when a later request fails', async () => {
    // Guard only: there was no error panel to hide before
    api.fetcher = async () => {
      throw failure(502);
    };

    await renderPage(`q=${QUERY}`, { fallback: { [KEY]: { success: true, series: [EF], query: QUERY } } });
    await waitFor(() => expect(api.urls).toEqual([KEY]));
    await wait(50);

    expect(screen.getByText('Expeditionary Force')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
