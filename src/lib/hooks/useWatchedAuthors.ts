/**
 * Component: Watched Authors Hook
 * Documentation: documentation/features/watched-lists.md
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/utils/api';

export interface WatchedAuthorItem {
  id: string;
  authorAsin: string;
  authorName: string;
  coverArtUrl: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

const fetcher = (url: string) =>
  fetchWithAuth(url).then((res) => res.json());

export function useWatchedAuthors() {
  const { accessToken } = useAuth();

  const endpoint = accessToken ? '/api/user/watched-authors' : null;

  const { data, error, isLoading } = useSWR(
    endpoint,
    fetcher,
    { refreshInterval: 60000 }
  );

  return {
    authors: (data?.authors || []) as WatchedAuthorItem[],
    isLoading,
    error,
  };
}

export function useAddWatchedAuthor() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addAuthor = async (authorAsin: string, authorName: string, coverArtUrl?: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/user/watched-authors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorAsin, authorName, coverArtUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to watch author');
      }

      // Revalidate watched authors list
      mutate((key) => typeof key === 'string' && key.includes('/api/user/watched-authors'));

      return data.author as WatchedAuthorItem;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { addAuthor, isLoading, error };
}

export function useDeleteWatchedAuthor() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteAuthor = async (id: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/user/watched-authors/${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to unwatch author');
      }

      // Revalidate watched authors list
      mutate((key) => typeof key === 'string' && key.includes('/api/user/watched-authors'));

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { deleteAuthor, isLoading, error };
}
