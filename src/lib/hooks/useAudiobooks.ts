/**
 * Component: Audiobooks Fetching Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import useSWR from 'swr';
import { authenticatedFetcher } from '@/lib/utils/api';

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
  isAvailable?: boolean;  // Set by real-time matching against plex_library
  plexGuid?: string | null;
  dbId?: string | null;
  isRequested?: boolean;  // Set if ANY user has requested this audiobook
  requestStatus?: string | null;  // Status of request (if any)
  requestId?: string | null;  // ID of request (if any)
  requestedByUsername?: string | null;  // Username who requested (only if not current user)
}

export function useAudiobooks(type: 'popular' | 'new-releases', limit: number = 20, page: number = 1) {
  const endpoint =
    type === 'popular'
      ? `/api/audiobooks/popular?page=${page}&limit=${limit}`
      : `/api/audiobooks/new-releases?page=${page}&limit=${limit}`;

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

export function useSearch(query: string, page: number = 1) {
  const shouldFetch = query && query.length > 0;
  const endpoint = shouldFetch ? `/api/audiobooks/search?q=${encodeURIComponent(query)}&page=${page}` : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
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

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // Cache for 5 minutes
  });

  return {
    audiobook: data?.audiobook || null,
    isLoading,
    error,
  };
}
