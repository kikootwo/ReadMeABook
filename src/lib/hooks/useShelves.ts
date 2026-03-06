/**
 * Component: Shelves Hook
 * Documentation: documentation/frontend/components.md
 */
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/utils/api';
import { ShelfBook } from './useGoodreadsShelves';

export interface GenericShelf {
  id: string;
  type: 'goodreads' | 'hardcover';
  name: string;
  sourceId: string; // Either rssUrl or listId
  lastSyncAt: string | null;
  createdAt: string;
  bookCount: number | null;
  books: ShelfBook[];
}

const fetcher = (url: string) => fetchWithAuth(url).then((res) => res.json());

export function useShelves() {
  const { accessToken } = useAuth();

  const endpoint = accessToken ? '/api/user/shelves' : null;

  const { data, error, isLoading } = useSWR(endpoint, fetcher, {
    refreshInterval: 30000,
  });

  return {
    shelves: (data?.shelves || []) as GenericShelf[],
    isLoading,
    error,
  };
}

export function useSyncShelves() {
  const { accessToken } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncShelves = async (
    shelfId?: string,
    shelfType?: 'goodreads' | 'hardcover',
  ) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/user/shelves/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shelfId, shelfType }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to trigger sync');
      }

      // Invalidate both the provider-specific endpoints and the combined endpoint
      mutate(
        (key) =>
          typeof key === 'string' &&
          (key.includes('/api/user/shelves') ||
            key.includes('/api/user/goodreads-shelves') ||
            key.includes('/api/user/hardcover-shelves')),
      );

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  };

  return { syncShelves, isSyncing, error };
}
