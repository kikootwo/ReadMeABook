/**
 * Component: Hardcover Shelves Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/utils/api';

export interface ShelfBook {
  coverUrl: string;
  asin: string | null;
  title: string;
  author: string;
}

export interface HardcoverShelf {
  id: string;
  name: string;
  listId: string;
  lastSyncAt: string | null;
  createdAt: string;
  bookCount: number | null;
  books: ShelfBook[];
}

const fetcher = (url: string) => fetchWithAuth(url).then((res) => res.json());

export function useHardcoverShelves() {
  const { accessToken } = useAuth();

  const endpoint = accessToken ? '/api/user/hardcover-shelves' : null;

  const { data, error, isLoading } = useSWR(endpoint, fetcher, {
    refreshInterval: 30000,
  });

  return {
    shelves: (data?.shelves || []) as HardcoverShelf[],
    isLoading,
    error,
  };
}

export function useAddHardcoverShelf() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addShelf = async (apiToken: string, listId: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/user/hardcover-shelves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken, listId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to add list');
      }

      // Revalidate shelves list
      mutate(
        (key) =>
          typeof key === 'string' &&
          key.includes('/api/user/hardcover-shelves'),
      );

      return data.shelf as HardcoverShelf;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { addShelf, isLoading, error };
}

export function useDeleteHardcoverShelf() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteShelf = async (shelfId: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(
        `/api/user/hardcover-shelves/${shelfId}`,
        {
          method: 'DELETE',
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to remove list');
      }

      // Revalidate shelves list
      mutate(
        (key) =>
          typeof key === 'string' &&
          key.includes('/api/user/hardcover-shelves'),
      );

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { deleteShelf, isLoading, error };
}

export function useUpdateHardcoverShelf() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateShelf = async (
    shelfId: string,
    updates: { listId?: string; apiToken?: string },
  ) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(
        `/api/user/hardcover-shelves/${shelfId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to update list');
      }

      // Revalidate shelves list
      mutate(
        (key) =>
          typeof key === 'string' &&
          key.includes('/api/user/hardcover-shelves'),
      );
      mutate(
        (key) => typeof key === 'string' && key.includes('/api/user/shelves'),
      );

      return data.shelf as HardcoverShelf;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { updateShelf, isLoading, error };
}
