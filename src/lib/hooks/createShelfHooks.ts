/**
 * Component: Shelf Hook Factory
 * Documentation: documentation/frontend/components.md
 *
 * Generic hook factory for shelf CRUD operations. Each provider (Goodreads,
 * Hardcover, etc.) calls this with its API endpoint to get fully typed hooks
 * without duplicating the SWR/fetch/mutate boilerplate.
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

const fetcher = (url: string) => fetchWithAuth(url).then((res) => res.json());

/**
 * Invalidate both the provider-specific endpoint and the combined /api/user/shelves endpoint.
 */
function revalidate(endpoint: string) {
  mutate((key) => typeof key === 'string' && key.includes(endpoint));
  mutate((key) => typeof key === 'string' && key.includes('/api/user/shelves'));
}

/**
 * Creates a set of hooks for a shelf provider endpoint.
 *
 * Returns:
 * - useList: SWR-based hook to list shelves
 * - useAdd: Hook returning { addShelf(body), isLoading, error }
 * - useDelete: Hook returning { deleteShelf(id), isLoading, error }
 * - useUpdate: Hook returning { updateShelf(id, body), isLoading, error }
 */
export function createShelfHooks<TShelf>(endpoint: string) {
  function useList() {
    const { accessToken } = useAuth();
    const key = accessToken ? endpoint : null;

    const { data, error, isLoading } = useSWR(key, fetcher, {
      refreshInterval: 30000,
    });

    return {
      shelves: (data?.shelves || []) as TShelf[],
      isLoading,
      error,
    };
  }

  function useAdd() {
    const { accessToken } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const addShelf = async (body: Record<string, unknown>) => {
      if (!accessToken) throw new Error('Not authenticated');

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchWithAuth(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || 'Failed to add shelf');
        }

        revalidate(endpoint);
        return data.shelf as TShelf;
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

  function useDelete() {
    const { accessToken } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const deleteShelf = async (shelfId: string) => {
      if (!accessToken) throw new Error('Not authenticated');

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchWithAuth(`${endpoint}/${shelfId}`, {
          method: 'DELETE',
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || 'Failed to remove shelf');
        }

        revalidate(endpoint);
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

  function useUpdate() {
    const { accessToken } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const updateShelf = async (shelfId: string, body: Record<string, unknown>) => {
      if (!accessToken) throw new Error('Not authenticated');

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchWithAuth(`${endpoint}/${shelfId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || 'Failed to update shelf');
        }

        revalidate(endpoint);
        return data.shelf as TShelf;
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

  return { useList, useAdd, useDelete, useUpdate };
}
