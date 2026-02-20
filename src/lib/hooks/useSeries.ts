/**
 * Component: Series Fetching Hooks
 * Documentation: documentation/frontend/components.md
 */

'use client';

import useSWR from 'swr';
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

export function useSeriesDetail(asin: string | null) {
  const endpoint = asin ? `/api/series/${asin}` : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // Cache for 5 minutes
  });

  return {
    series: (data?.series || null) as SeriesDetail | null,
    isLoading,
    error,
  };
}
