/**
 * Component: Authors Fetching Hooks
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useCallback, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { authenticatedFetcher, fetchJSON } from '@/lib/utils/api';
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

export function useAuthorBooks(asin: string | null, authorName: string | null) {
  const shouldFetch = asin && authorName;
  const endpoint = shouldFetch
    ? `/api/authors/${asin}/books?name=${encodeURIComponent(authorName)}`
    : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000, // Cache for 1 minute
  });

  return {
    books: (data?.books || []) as Audiobook[],
    totalBooks: data?.totalBooks || 0,
    isLoading: !!shouldFetch && isLoading,
    error,
  };
}

// ============================================================================
// Followed Authors Hooks
// ============================================================================

export interface FollowedAuthor {
  id: string;
  asin: string;
  name: string;
  image: string | null;
  createdAt: string;
}

/**
 * Hook to fetch the current user's followed authors
 */
export function useFollowedAuthors() {
  const { data, error, isLoading } = useSWR(
    '/api/authors/followed',
    authenticatedFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  );

  return {
    authors: (data?.authors || []) as FollowedAuthor[],
    count: data?.count || 0,
    isLoading,
    error,
  };
}

/**
 * Hook to check if a specific author is followed
 */
export function useIsFollowing(asin: string | null) {
  const endpoint = asin ? `/api/authors/followed/${asin}/status` : null;

  const { data, error, isLoading } = useSWR(endpoint, authenticatedFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  return {
    following: data?.following ?? false,
    isLoading,
    error,
  };
}

/**
 * Hook providing follow/unfollow mutation actions
 */
export function useFollowActions() {
  const [isLoading, setIsLoading] = useState(false);

  const follow = useCallback(
    async (author: { asin: string; name: string; image?: string }) => {
      setIsLoading(true);
      try {
        await fetchJSON('/api/authors/followed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(author),
        });
        // Revalidate followed authors list and this author's status
        await mutate('/api/authors/followed');
        await mutate(`/api/authors/followed/${author.asin}/status`);
        return true;
      } catch {
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const unfollow = useCallback(async (asin: string) => {
    setIsLoading(true);
    try {
      await fetchJSON(`/api/authors/followed/${asin}`, {
        method: 'DELETE',
      });
      await mutate('/api/authors/followed');
      await mutate(`/api/authors/followed/${asin}/status`);
      return true;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { follow, unfollow, isLoading };
}
