/**
 * Component: Audiobooks Fetching Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import useSWR from 'swr';

export interface Audiobook {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  genres?: string[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useAudiobooks(type: 'popular' | 'new-releases', limit: number = 20) {
  const endpoint =
    type === 'popular'
      ? `/api/audiobooks/popular?limit=${limit}`
      : `/api/audiobooks/new-releases?limit=${limit}`;

  const { data, error, isLoading } = useSWR(endpoint, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // Cache for 1 minute
  });

  return {
    audiobooks: data?.audiobooks || [],
    isLoading,
    error,
  };
}

export function useSearch(query: string, page: number = 1) {
  const shouldFetch = query && query.length > 0;
  const endpoint = shouldFetch ? `/api/audiobooks/search?q=${encodeURIComponent(query)}&page=${page}` : null;

  const { data, error, isLoading } = useSWR(endpoint, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000, // Cache for 30 seconds
  });

  return {
    results: data?.results || [],
    totalResults: data?.totalResults || 0,
    hasMore: data?.hasMore || false,
    isLoading: shouldFetch && isLoading,
    error,
  };
}

export function useAudiobookDetails(asin: string | null) {
  const endpoint = asin ? `/api/audiobooks/${asin}` : null;

  const { data, error, isLoading } = useSWR(endpoint, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // Cache for 5 minutes
  });

  return {
    audiobook: data?.audiobook || null,
    isLoading,
    error,
  };
}
