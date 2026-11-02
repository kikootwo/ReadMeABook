/**
 * Component: Authors Fetching Hooks Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSWRInfiniteMock = vi.hoisted(() => vi.fn());

vi.mock('swr', () => ({ default: vi.fn() }));
vi.mock('swr/infinite', () => ({ default: useSWRInfiniteMock }));
vi.mock('@/lib/utils/api', () => ({ authenticatedFetcher: vi.fn() }));

import { useAuthorBooks } from '@/lib/hooks/useAuthors';

type Page = { books: { asin: string }[]; hasMore: boolean; totalBooks?: number };

function mockPages(pages: Page[] | undefined, extra: { size?: number; isValidating?: boolean; error?: unknown } = {}) {
  const setSize = vi.fn();
  useSWRInfiniteMock.mockReturnValue({
    data: pages,
    error: extra.error,
    size: extra.size ?? pages?.length ?? 1,
    setSize,
    isLoading: false,
    isValidating: extra.isValidating ?? false,
  });
  return setSize;
}

const Probe = () => {
  const result = useAuthorBooks('A000TOLKEN', 'J.R.R. Tolkien');
  return <div data-testid="hook">{JSON.stringify(result)}</div>;
};
const read = () => JSON.parse(screen.getByTestId('hook').textContent || '{}');

describe('useAuthorBooks paging past empty pages (#310)', () => {
  beforeEach(() => {
    useSWRInfiniteMock.mockReset();
  });

  it('loads the next page by itself when the last page has no books but more remain', () => {
    const setSize = mockPages([{ books: [{ asin: 'B1' }], hasMore: true }, { books: [], hasMore: true }]);

    render(<Probe />);

    expect(setSize).toHaveBeenCalledWith(3);
    expect(read().isLoadingMore).toBe(true);
  });

  it('shows loading, not an empty result, while skipping an empty first page', () => {
    const setSize = mockPages([{ books: [], hasMore: true }]);

    render(<Probe />);

    expect(setSize).toHaveBeenCalledWith(2);
    expect(read().isLoading).toBe(true);
    expect(read().books).toEqual([]);
  });

  it('does not ask again while the next page is already loading', () => {
    const setSize = mockPages([{ books: [], hasMore: true }], { size: 2, isValidating: true });

    render(<Probe />);

    expect(setSize).not.toHaveBeenCalledWith(3);
    expect(read().isLoading).toBe(true);
  });

  it('waits for the user when the last page has books', () => {
    const setSize = mockPages([{ books: [{ asin: 'B1' }], hasMore: true }]);

    render(<Probe />);

    expect(setSize).not.toHaveBeenCalledWith(2);
    expect(read().hasMore).toBe(true);
    expect(read().isLoadingMore).toBe(false);
  });

  it('ends on an empty last page with nothing more', () => {
    const setSize = mockPages([{ books: [], hasMore: false }]);
    render(<Probe />);
    expect(setSize).not.toHaveBeenCalledWith(2);
    expect(read().isLoading).toBe(false);
  });

  it('stops skipping when the next page failed to load', () => {
    const setSize = mockPages([{ books: [], hasMore: true }], { size: 2, error: new Error('boom') });

    render(<Probe />);

    expect(setSize).not.toHaveBeenCalledWith(3);
    expect(read().isLoading).toBe(false);
  });
});
