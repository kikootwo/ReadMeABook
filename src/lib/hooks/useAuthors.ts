/**
 * Component: Authors Fetching Hooks
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useRef, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { authenticatedFetcher } from '@/lib/utils/api';
import { Audiobook } from './useAudiobooks';

export interface Author {
  asin: string;
  name: string;
  description?: string;
  image?: string;
  genres: string[];
  similarCount: number;
}

export interface SimilarAuthor {
  asin: string;
  name: string;
  image?: string;
}

export interface AuthorDetail {
  asin: string;
  name: string;
  description?: string;
  image?: string;
  genres: string[];
  similar: SimilarAuthor[];
  audibleUrl?: string;
}

export function useAuthorSearch(name: string) {
  const shouldFetch = name && name.length > 0;
  const endpoint = shouldFetch
    ? `/api/authors/search?name=${encodeURIComponent(name)}`
    : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  return {
    authors: (data?.authors || []) as Author[],
    query: data?.query || '',
    isLoading: shouldFetch && isLoading,
    error,
  };
}

export function useAuthorDetail(asin: string | null) {
  const endpoint = asin ? `/api/authors/${asin}` : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // Cache for 5 minutes
  });

  return {
    author: (data?.author || null) as AuthorDetail | null,
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

export function useAuthorBooks(asin: string | null, authorName: string | null) {
  const prevIdentityRef = useRef<string | null>(null);
  const identity = asin && authorName ? `${asin}:${authorName}` : null;

  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite(
    (pageIndex, prevPageData) => {
      if (!asin || !authorName) return null;
      if (pageIndex === 0) return `/api/authors/${asin}/books?name=${encodeURIComponent(authorName)}&page=1`;
      if (!prevPageData?.hasMore) return null;
      return `/api/authors/${asin}/books?name=${encodeURIComponent(authorName)}&page=${pageIndex + 1}`;
    },
    authenticatedFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
      revalidateFirstPage: false,
    }
  );

  // Reset when author changes
  useEffect(() => {
    if (identity !== prevIdentityRef.current) {
      prevIdentityRef.current = identity;
      setSize(1);
    }
  }, [identity, setSize]);

  const books = (data ? dedupeByAsin(data.flatMap(page => page?.books || [])) : []) as Audiobook[];
  const totalBooks = data?.[0]?.totalBooks || 0;
  const hasMore = !!(data && data.length > 0 && data[data.length - 1]?.hasMore);
  const isLoadingInitial = !data && !error && !!identity;
  const isLoadingMore = !!(data && typeof data[size - 1] === 'undefined' && isValidating);

  const loadMore = useCallback(() => {
    setSize(prev => prev + 1);
  }, [setSize]);

  return {
    books,
    totalBooks,
    hasMore,
    isLoading: isLoadingInitial || (!!identity && isLoading),
    isLoadingMore,
    loadMore,
    error,
  };
}
