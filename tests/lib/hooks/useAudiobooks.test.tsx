/**
 * Component: Audiobooks Hooks Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSWRMock = vi.hoisted(() => vi.fn());
const authenticatedFetcherMock = vi.hoisted(() => vi.fn());

vi.mock('swr', () => ({
  default: useSWRMock,
}));

vi.mock('@/lib/utils/api', () => ({
  authenticatedFetcher: authenticatedFetcherMock,
}));

const HookProbe = ({ label, value }: { label: string; value: any }) => (
  <div data-testid={label}>{JSON.stringify(value)}</div>
);

describe('useAudiobooks hooks', () => {
  beforeEach(() => {
    useSWRMock.mockReset();
    authenticatedFetcherMock.mockReset();
    vi.resetModules();
  });

  it('builds the popular audiobooks endpoint and returns data', async () => {
    useSWRMock.mockReturnValue({
      data: { audiobooks: [{ asin: 'a1' }], totalPages: 3, totalCount: 30, hasMore: true },
      error: null,
      isLoading: false,
    });

    const { useAudiobooks } = await import('@/lib/hooks/useAudiobooks');

    const Probe = () => {
      const result = useAudiobooks('popular', 10, 2);
      return <HookProbe label="popular" value={result} />;
    };

    render(<Probe />);

    expect(useSWRMock).toHaveBeenCalledWith(
      '/api/audiobooks/popular?page=2&limit=10',
      authenticatedFetcherMock,
      expect.objectContaining({ dedupingInterval: 60000 })
    );

    const parsed = JSON.parse(screen.getByTestId('popular').textContent || '{}');
    expect(parsed.audiobooks).toHaveLength(1);
    expect(parsed.totalPages).toBe(3);
    expect(parsed.hasMore).toBe(true);
  });

  it('skips search when the query is empty', async () => {
    useSWRMock.mockReturnValue({ data: null, error: null, isLoading: false });

    const { useSearch } = await import('@/lib/hooks/useAudiobooks');

    const Probe = () => {
      const result = useSearch('', 1);
      return <HookProbe label="search" value={result} />;
    };

    render(<Probe />);

    expect(useSWRMock).toHaveBeenCalledWith(
      null,
      authenticatedFetcherMock,
      expect.objectContaining({ dedupingInterval: 30000 })
    );

    const parsed = JSON.parse(screen.getByTestId('search').textContent || '{}');
    expect(parsed.isLoading).toBeFalsy();
  });

  it('requests audiobook details when an ASIN is provided', async () => {
    useSWRMock.mockReturnValue({
      data: { audiobook: { asin: 'a2', title: 'Details' } },
      error: null,
      isLoading: false,
    });

    const { useAudiobookDetails } = await import('@/lib/hooks/useAudiobooks');

    const Probe = () => {
      const result = useAudiobookDetails('a2');
      return <HookProbe label="details" value={result} />;
    };

    render(<Probe />);

    expect(useSWRMock).toHaveBeenCalledWith(
      '/api/audiobooks/a2',
      authenticatedFetcherMock,
      expect.objectContaining({ dedupingInterval: 300000 })
    );

    const parsed = JSON.parse(screen.getByTestId('details').textContent || '{}');
    expect(parsed.audiobook.asin).toBe('a2');
  });
});
