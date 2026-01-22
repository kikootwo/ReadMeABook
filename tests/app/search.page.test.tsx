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

const useSearchMock = vi.hoisted(() => vi.fn());
const usePreferencesMock = vi.hoisted(() => ({
  cardSize: 5,
  setCardSize: vi.fn(),
}));

vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useSearch: useSearchMock,
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

vi.mock('@/components/ui/CardSizeControls', () => ({
  CardSizeControls: ({ size }: { size: number }) => <div data-testid="card-size" data-size={size} />,
}));

describe('SearchPage', () => {
  beforeEach(() => {
    resetMockAuthState();
    resetMockRouter();
    useSearchMock.mockReset();
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
    });

    const { default: SearchPage } = await import('@/app/search/page');
    render(<SearchPage />);

    expect(screen.getByText('Start typing to search for audiobooks')).toBeInTheDocument();
    expect(useSearchMock).toHaveBeenCalledWith('', 1);
  });

  it('debounces search input and loads more results', async () => {
    useSearchMock.mockImplementation((query: string, page: number) => {
      if (!query) {
        return { results: [], totalResults: 0, hasMore: false, isLoading: false };
      }
      if (page === 1) {
        return {
          results: [{ asin: 'a1', title: 'Book One', author: 'Author' }],
          totalResults: 2,
          hasMore: true,
          isLoading: false,
        };
      }
      return {
        results: [{ asin: 'a2', title: 'Book Two', author: 'Author' }],
        totalResults: 2,
        hasMore: false,
        isLoading: false,
      };
    });

    const { default: SearchPage } = await import('@/app/search/page');
    render(<SearchPage />);

    const input = screen.getByPlaceholderText('Search by title, author, or narrator...');
    fireEvent.change(input, { target: { value: 'Dune' } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText('Search Results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load More Results' })).toBeInTheDocument();
    expect(screen.getByTestId('grid')).toHaveAttribute('data-count', '1');

    fireEvent.click(screen.getByRole('button', { name: 'Load More Results' }));

    expect(useSearchMock).toHaveBeenCalledWith('Dune', 2);
  });
});
