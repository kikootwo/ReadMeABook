/**
 * Component: useSearch Language Filter Paging Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * Real SWR, fake fetcher. While the admin language filter is on (pages carry
 * hiddenCount), a page can be empty with more pages behind it: the hook loads past it
 * by itself, at most 4 pages in a row per query or click, and a new query ends the chain.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain holder: the config's mockReset clears vi.fn implementations per test
const fetcher = vi.hoisted(() => ({ urls: [] as string[], answer: (async () => ({})) as (url: string) => Promise<unknown> }));
vi.mock('@/lib/utils/api', () => ({
  authenticatedFetcher: (url: string) => {
    fetcher.urls.push(url);
    return fetcher.answer(url);
  },
}));

import { useSearch, MAX_AUTO_PAGE_LOADS } from '@/lib/hooks/useAudiobooks';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

const pageOf = (url: string) => Number(new URL(url, 'http://x').searchParams.get('page'));
const queryOf = (url: string) => new URL(url, 'http://x').searchParams.get('q');
const book = (asin: string) => ({ asin, title: asin, author: 'A' });

/** Every page hidden by the filter, with more behind it */
const allHidden = async () => ({ success: true, results: [], hasMore: true, hiddenCount: 50, filterLanguage: 'French' });

beforeEach(() => {
  fetcher.urls = [];
});

describe('useSearch with the language filter', () => {
  it('off (no hiddenCount): an empty page waits for the user, as before', async () => {
    fetcher.answer = async () => ({ success: true, results: [], hasMore: true });
    const { result } = renderHook(() => useSearch('six of crows'), { wrapper });

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetcher.urls.map(pageOf)).toEqual([1]);
    expect(result.current.filterLanguage).toBeUndefined();
    expect(result.current.hiddenCount ?? 0).toBe(0);
  });

  it('on: loads past a fully hidden page and sums the hidden count', async () => {
    fetcher.answer = async (url) =>
      pageOf(url) === 1
        ? allHidden()
        : { success: true, results: [book('B0KEPT0001')], hasMore: false, hiddenCount: 20, filterLanguage: 'French' };
    const { result } = renderHook(() => useSearch('six of crows'), { wrapper });

    await waitFor(() => expect(result.current.results.map((b) => b.asin)).toEqual(['B0KEPT0001']));

    expect(fetcher.urls.map(pageOf)).toEqual([1, 2]);
    expect(result.current).toMatchObject({ hiddenCount: 70, filterLanguage: 'French', hasMore: false });
  });

  it('on: stops after 4 automatic loads; a click allows 4 more', async () => {
    expect(MAX_AUTO_PAGE_LOADS).toBe(4);
    fetcher.answer = allHidden;
    const { result } = renderHook(() => useSearch('english title'), { wrapper });

    await waitFor(() => expect(fetcher.urls).toHaveLength(1 + MAX_AUTO_PAGE_LOADS));
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetcher.urls.map(pageOf)).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());

    await waitFor(() => expect(fetcher.urls).toHaveLength(2 + 2 * MAX_AUTO_PAGE_LOADS));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetcher.urls.map(pageOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('on: a new query mid-chain fires no further request for the old one', async () => {
    let releasePage2: () => void = () => {};
    fetcher.answer = async (url) => {
      if (queryOf(url) === 'old' && pageOf(url) === 2) await new Promise<void>((resolve) => (releasePage2 = resolve));
      return allHidden();
    };
    const { result, rerender } = renderHook(({ q }) => useSearch(q), { wrapper, initialProps: { q: 'old' } });

    await waitFor(() => expect(fetcher.urls).toEqual(['/api/audiobooks/search?q=old&page=1', '/api/audiobooks/search?q=old&page=2']));
    rerender({ q: 'new' });
    await waitFor(() => expect(fetcher.urls.some((url) => queryOf(url) === 'new')).toBe(true));
    await act(async () => releasePage2());
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetcher.urls.filter((url) => queryOf(url) === 'old').map(pageOf)).toEqual([1, 2]);
    // (page 1 can be asked twice: the hook's existing reset to one page on a new query revalidates it)
    expect([...new Set(fetcher.urls.filter((url) => queryOf(url) === 'new').map(pageOf))]).toEqual([1, 2, 3, 4, 5]);
  });
});
