/**
 * Component: Home Page Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockAuthState } from '../helpers/mock-auth';
import { resetMockRouter } from '../helpers/mock-next-navigation';

const useAudiobooksMock = vi.hoisted(() => vi.fn());
const usePreferencesMock = vi.hoisted(() => ({
  cardSize: 5,
  setCardSize: vi.fn(),
}));

vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useAudiobooks: useAudiobooksMock,
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
  AudiobookGrid: ({ audiobooks, cardSize }: { audiobooks: any[]; cardSize?: number }) => (
    <div data-testid="grid" data-count={audiobooks.length} data-size={cardSize}>
      {audiobooks.map((book) => (
        <div key={book.asin}>{book.title}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/ui/CardSizeControls', () => ({
  CardSizeControls: ({ size }: { size: number }) => <div data-testid="card-size" data-size={size} />,
}));

vi.mock('@/components/ui/StickyPagination', () => ({
  StickyPagination: ({
    label,
    onPageChange,
  }: {
    label: string;
    onPageChange: (page: number) => void;
  }) => (
    <button type="button" onClick={() => onPageChange(2)}>
      {label} next
    </button>
  ),
}));

describe('HomePage', () => {
  beforeEach(() => {
    resetMockAuthState();
    resetMockRouter();
    useAudiobooksMock.mockReset();
    usePreferencesMock.cardSize = 5;
    usePreferencesMock.setCardSize.mockReset();
    vi.resetModules();
  });

  it('renders empty state messaging for popular audiobooks', async () => {
    useAudiobooksMock.mockImplementation((category: string) => {
      if (category === 'popular') {
        return {
          audiobooks: [],
          isLoading: false,
          totalPages: 1,
          message: 'Nothing here',
        };
      }
      return {
        audiobooks: [{ asin: 'n1', title: 'New Release', author: 'Author' }],
        isLoading: false,
        totalPages: 2,
        message: null,
      };
    });

    const { default: HomePage } = await import('@/app/page');
    render(<HomePage />);

    expect(screen.getByText('No popular audiobooks found')).toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('New Release')).toBeInTheDocument();
  });

  it('updates pagination when the sticky controls request a new page', async () => {
    useAudiobooksMock.mockImplementation((category: string, _limit: number, page: number) => {
      return {
        audiobooks: [{ asin: `${category}-${page}`, title: `${category}-${page}`, author: 'Author' }],
        isLoading: false,
        totalPages: 3,
        message: null,
      };
    });

    const { default: HomePage } = await import('@/app/page');
    render(<HomePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Popular Audiobooks next' }));

    await waitFor(() => {
      expect(useAudiobooksMock).toHaveBeenCalledWith('popular', 20, 2);
    });
  });
});
