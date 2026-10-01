/**
 * Component: Author Blacklist Hooks
 * Documentation: documentation/admin-features/author-blacklist.md
 *
 * Admin-only hooks for listing / adding / removing blacklisted authors.
 * Add is used from the author detail page; admin page is review + remove.
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/utils/api';

export interface AuthorBlacklistEntry {
  id: string;
  authorName: string;
  authorKey: string;
  createdAt: string;
}

function normalizeAuthorKey(name: string): string {
  return name.trim().toLowerCase();
}

const fetcher = (url: string) =>
  fetchWithAuth(url).then((res) => res.json());

export function useAuthorBlacklist() {
  const { accessToken, user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const endpoint =
    accessToken && isAdmin ? '/api/admin/author-blacklist' : null;

  const { data, error, isLoading } = useSWR(endpoint, fetcher, {
    refreshInterval: 60000,
  });

  const entries = (data?.entries || []) as AuthorBlacklistEntry[];

  const findByAuthorName = (authorName: string) => {
    const key = normalizeAuthorKey(authorName);
    if (!key) return undefined;
    return entries.find((e) => e.authorKey === key);
  };

  return {
    entries,
    count: data?.count ?? entries.length,
    isLoading,
    error,
    isAdmin,
    findByAuthorName,
  };
}

export function useAddAuthorBlacklist() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addAuthor = async (authorName: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/admin/author-blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to blacklist author');
      }

      mutate(
        (key) =>
          typeof key === 'string' && key.includes('/api/admin/author-blacklist')
      );

      return data.entry as AuthorBlacklistEntry;
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

export function useRemoveAuthorBlacklist() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeAuthor = async (id: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(
        `/api/admin/author-blacklist/${id}`,
        { method: 'DELETE' }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to remove author');
      }

      mutate(
        (key) =>
          typeof key === 'string' && key.includes('/api/admin/author-blacklist')
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

  return { removeAuthor, isLoading, error };
}
