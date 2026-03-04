/**
 * Component: Watched Series Hook
 * Documentation: documentation/features/watched-lists.md
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/utils/api';

export interface WatchedSeriesItem {
  id: string;
  seriesAsin: string;
  seriesTitle: string;
  coverArtUrl: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

const fetcher = (url: string) =>
  fetchWithAuth(url).then((res) => res.json());

export function useWatchedSeries() {
  const { accessToken } = useAuth();

  const endpoint = accessToken ? '/api/user/watched-series' : null;

  const { data, error, isLoading } = useSWR(
    endpoint,
    fetcher,
    { refreshInterval: 60000 }
  );

  return {
    series: (data?.series || []) as WatchedSeriesItem[],
    isLoading,
    error,
  };
}

export function useAddWatchedSeries() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSeries = async (seriesAsin: string, seriesTitle: string, coverArtUrl?: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/user/watched-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesAsin, seriesTitle, coverArtUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to watch series');
      }

      // Revalidate watched series list
      mutate((key) => typeof key === 'string' && key.includes('/api/user/watched-series'));

      return data.series as WatchedSeriesItem;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { addSeries, isLoading, error };
}

export function useDeleteWatchedSeries() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteSeries = async (id: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/user/watched-series/${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to unwatch series');
      }

      // Revalidate watched series list
      mutate((key) => typeof key === 'string' && key.includes('/api/user/watched-series'));

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { deleteSeries, isLoading, error };
}
