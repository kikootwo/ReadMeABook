/**
 * Component: Requests Management Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/utils/api';
import { Audiobook } from './useAudiobooks';

export interface Request {
  id: string;
  status: string;
  progress: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  audiobook: {
    id: string;
    title: string;
    author: string;
    coverArtUrl?: string;
  };
  user: {
    id: string;
    plexUsername: string;
  };
}

const fetcher = (url: string) =>
  fetchWithAuth(url).then((res) => res.json());

export function useRequests(status?: string, limit: number = 50, myOnly: boolean = false) {
  const { accessToken } = useAuth();

  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (limit) params.append('limit', limit.toString());
  if (myOnly) params.append('myOnly', 'true');

  const endpoint = accessToken ? `/api/requests?${params.toString()}` : null;

  const { data, error, isLoading } = useSWR(
    endpoint,
    fetcher,
    {
      refreshInterval: 5000, // Refresh every 5 seconds for real-time updates
    }
  );

  return {
    requests: data?.requests || [],
    isLoading,
    error,
  };
}

export function useRequest(requestId: string) {
  const { accessToken } = useAuth();

  const endpoint = accessToken && requestId ? `/api/requests/${requestId}` : null;

  const { data, error, isLoading } = useSWR(
    endpoint,
    fetcher,
    {
      refreshInterval: 3000, // Refresh every 3 seconds for progress updates
    }
  );

  return {
    request: data?.request || null,
    isLoading,
    error,
  };
}

export function useCreateRequest() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRequest = async (audiobook: Audiobook) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audiobook }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to create request');
      }

      // Revalidate requests list
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));

      // Revalidate audiobook lists to update button states
      mutate((key) => typeof key === 'string' && key.includes('/api/audiobooks'));

      return data.request;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { createRequest, isLoading, error };
}

export function useCancelRequest() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelRequest = async (requestId: string) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'cancel' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to cancel request');
      }

      // Revalidate requests
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));

      return data.request;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { cancelRequest, isLoading, error };
}

export function useManualSearch() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerManualSearch = async (requestId: string) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/manual-search`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to trigger manual search');
      }

      // Revalidate requests
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));

      return data.request;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { triggerManualSearch, isLoading, error };
}

export function useInteractiveSearch() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTorrents = async (requestId: string) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/interactive-search`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to search for torrents');
      }

      return data.results || [];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { searchTorrents, isLoading, error };
}

export function useSelectTorrent() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectTorrent = async (requestId: string, torrent: any) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/select-torrent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ torrent }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to download torrent');
      }

      // Revalidate requests
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));

      return data.request;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { selectTorrent, isLoading, error };
}
