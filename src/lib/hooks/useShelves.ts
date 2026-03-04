/**
 * Component: Shelves Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import useSWR from 'swr';
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
