/**
 * Component: Series Fetching Hooks
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useRef, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { authenticatedFetcher } from '@/lib/utils/api';
import { Audiobook } from './useAudiobooks';

export interface SeriesSummary {
  asin: string;
  title: string;
  bookCount: number;
  rating?: number;
  ratingCount?: number;
  tags: string[];
  coverArtUrl?: string;
  audibleUrl: string;
}

export interface SimilarSeries {
  asin: string;
  title: string;
  bookCount?: number;
  coverArtUrl?: string;
}

export interface SeriesDetail {
  asin: string;
  title: string;
  bookCount: number;
  rating?: number;
  ratingCount?: number;
  description?: string;
  tags: string[];
  books: Audiobook[];
  similarSeries: SimilarSeries[];
  audibleUrl: string;
}

export function useSeriesSearch(query: string) {
  const shouldFetch = query && query.length > 0;
  const endpoint = shouldFetch
    ? `/api/series/search?q=${encodeURIComponent(query)}`
    : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  return {
    series: (data?.series || []) as SeriesSummary[],
    query: data?.query || '',
    isLoading: shouldFetch && isLoading,
    error,
  };
}

function dedupeByAsin<T extends { asin: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.asin)) return false;
    seen.add(item.asin);
    return true;
  });
}

export function useSeriesDetail(asin: string | null) {
  const prevAsinRef = useRef<string | null>(null);

  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite(
    (pageIndex, prevPageData) => {
      if (!asin) return null;
      if (pageIndex === 0) return `/api/series/${asin}?page=1`;
      if (!prevPageData?.hasMore) return null;
      return `/api/series/${asin}?page=${pageIndex + 1}`;
    },
    authenticatedFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000,
      revalidateFirstPage: false,
    }
  );

  // Reset when series changes
  useEffect(() => {
    if (asin !== prevAsinRef.current) {
      prevAsinRef.current = asin;
      setSize(1);
    }
  }, [asin, setSize]);

  // Merge pages: use first page's metadata, accumulate all books
  const firstPageSeries = data?.[0]?.series as SeriesDetail | undefined;
  const allBooks = (data ? dedupeByAsin(data.flatMap(page => page?.series?.books || [])) : []) as Audiobook[];

  const series: SeriesDetail | null = firstPageSeries
    ? { ...firstPageSeries, books: allBooks }
    : null;

  const hasMore = !!(data && data.length > 0 && data[data.length - 1]?.hasMore);
  const isLoadingInitial = !data && !error && !!asin;
  const isLoadingMore = !!(data && typeof data[size - 1] === 'undefined' && isValidating);

  const loadMore = useCallback(() => {
    setSize(prev => prev + 1);
  }, [setSize]);

  return {
    series,
    hasMore,
    isLoading: isLoadingInitial || (!!asin && isLoading),
    isLoadingMore,
    loadMore,
    error,
  };
}
