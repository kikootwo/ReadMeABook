/**
 * Component: Audiobooks Fetching Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useRef, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { authenticatedFetcher } from '@/lib/utils/api';

export interface Audiobook {
  asin: string;
  title: string;
  author: string;
  authorAsin?: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  genres?: string[];
  series?: string;         // Series name (e.g., "A Song of Ice and Fire")
  seriesPart?: string;     // Position in series (e.g., "1", "1.5")
  seriesAsin?: string;     // Audible ASIN for the series (links to /series/{asin})
  isAvailable?: boolean;  // Set by real-time matching against plex_library
  plexGuid?: string | null;
  dbId?: string | null;
  isRequested?: boolean;  // Set if ANY user has requested this audiobook
  requestStatus?: string | null;  // Status of request (if any)
  requestId?: string | null;  // ID of request (if any)
  requestedByUsername?: string | null;  // Username who requested (only if not current user)
  hasReportedIssue?: boolean;  // True if an open issue exists for this audiobook
}

export function useAudiobooks(type: 'popular' | 'new-releases', limit: number = 20, page: number = 1, hideAvailable: boolean = false) {
  const hideParam = hideAvailable ? '&hideAvailable=true' : '';
  const endpoint =
    type === 'popular'
      ? `/api/audiobooks/popular?page=${page}&limit=${limit}${hideParam}`
      : `/api/audiobooks/new-releases?page=${page}&limit=${limit}${hideParam}`;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // Cache for 1 minute
  });

  return {
    audiobooks: data?.audiobooks || [],
    totalCount: data?.totalCount || 0,
    totalPages: data?.totalPages || 0,
    currentPage: data?.page || page,
    hasMore: data?.hasMore || false,
    message: data?.message || null,
    isLoading,
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

export function useSearch(query: string) {
  const prevQueryRef = useRef(query);

  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite(
    (pageIndex, prevPageData) => {
      if (!query || query.length === 0) return null;
      if (pageIndex === 0) return `/api/audiobooks/search?q=${encodeURIComponent(query)}&page=1`;
      if (!prevPageData?.hasMore) return null;
      return `/api/audiobooks/search?q=${encodeURIComponent(query)}&page=${pageIndex + 1}`;
    },
    authenticatedFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
      revalidateFirstPage: false,
    }
  );

  // Reset to page 1 when query changes
  useEffect(() => {
    if (query !== prevQueryRef.current) {
      prevQueryRef.current = query;
      setSize(1);
    }
  }, [query, setSize]);

  const results = data ? dedupeByAsin(data.flatMap(page => page?.results || [])) : [];
  const totalResults = data?.[0]?.totalResults || 0;
  const hasMore = !!(data && data.length > 0 && data[data.length - 1]?.hasMore);
  const isLoadingInitial = !data && !error && !!query;
  const isLoadingMore = !!(data && typeof data[size - 1] === 'undefined' && isValidating);

  const loadMore = useCallback(() => {
    setSize(prev => prev + 1);
  }, [setSize]);

  return {
    results,
    totalResults,
    hasMore,
    isLoading: isLoadingInitial,
    isLoadingMore,
    loadMore,
    error,
  };
}

export function useAudiobookDetails(asin: string | null) {
  const endpoint = asin ? `/api/audiobooks/${asin}` : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // Cache for 5 minutes
  });

  return {
    audiobook: data?.audiobook || null,
    audibleBaseUrl: data?.audibleBaseUrl || 'https://www.audible.com',
    isLoading,
    error,
  };
}
