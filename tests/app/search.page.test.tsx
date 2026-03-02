/**
 * Component: Search Page Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockAuthState } from '../helpers/mock-auth';
import { resetMockRouter } from '../helpers/mock-next-navigation';

const loadMoreMock = vi.hoisted(() => vi.fn());
const useSearchMock = vi.hoisted(() => vi.fn());
const usePreferencesMock = vi.hoisted(() => ({
  cardSize: 5,
  setCardSize: vi.fn(),
  squareCovers: false,
  setSquareCovers: vi.fn(),
  hideAvailable: false,
  setHideAvailable: vi.fn(),
}));

vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useSearch: useSearchMock,
  Audiobook: {},
}));

vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => usePreferencesMock,
}));

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/layout/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock('@/components/audiobooks/AudiobookGrid', () => ({
  AudiobookGrid: ({
    audiobooks,
    emptyMessage,
    cardSize,
  }: {
    audiobooks: any[];
    emptyMessage: string;
    cardSize?: number;
  }) => (
    <div data-testid="grid" data-count={audiobooks.length} data-size={cardSize}>
      <span>{emptyMessage}</span>
    </div>
  ),
}));

vi.mock('@/components/ui/SectionToolbar', () => ({
  SectionToolbar: () => <div data-testid="section-toolbar" />,
}));

vi.mock('@/components/ui/LoadMoreBar', () => ({
  LoadMoreBar: ({
    hasMore,
    isLoading,
    onLoadMore,
  }: {
    loadedCount: number;
    totalCount?: number;
    hasMore: boolean;
    isLoading: boolean;
    onLoadMore: () => void;
    itemLabel?: string;
  }) =>
    hasMore ? (
      <button onClick={onLoadMore} disabled={isLoading}>
        Load more
      </button>
    ) : (
      <div data-testid="all-loaded">All loaded</div>
    ),
}));

describe('SearchPage', () => {
  beforeEach(() => {
    resetMockAuthState();
    resetMockRouter();
    useSearchMock.mockReset();
    loadMoreMock.mockReset();
    usePreferencesMock.cardSize = 5;
    usePreferencesMock.setCardSize.mockReset();
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the empty state before a search query is entered', async () => {
    useSearchMock.mockReturnValue({
      results: [],
      totalResults: 0,
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
      loadMore: loadMoreMock,
    });

    const { default: SearchPage } = await import('@/app/search/page');
    render(<SearchPage />);

    expect(screen.getByText('Start typing to search for audiobooks')).toBeInTheDocument();
    expect(useSearchMock).toHaveBeenCalledWith('');
  });

  it('debounces search input and loads more results', async () => {
    useSearchMock.mockReturnValue({
      results: [{ asin: 'a1', title: 'Book One', author: 'Author' }],
      totalResults: 2,
      hasMore: true,
      isLoading: false,
      isLoadingMore: false,
      loadMore: loadMoreMock,
    });

    const { default: SearchPage } = await import('@/app/search/page');
    render(<SearchPage />);

    const input = screen.getByPlaceholderText('Search by title, author, or narrator...');
    fireEvent.change(input, { target: { value: 'Dune' } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText('Search Results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(screen.getByTestId('grid')).toHaveAttribute('data-count', '1');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(loadMoreMock).toHaveBeenCalled();
  });
});
