/**
 * Component: Requests Management Hook
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
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

const fetcher = (url: string, token: string) =>
  fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((res) => res.json());

export function useRequests(status?: string, limit: number = 50) {
  const { accessToken } = useAuth();

  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (limit) params.append('limit', limit.toString());

  const endpoint = accessToken ? `/api/requests?${params.toString()}` : null;

  const { data, error, isLoading } = useSWR(
    endpoint ? [endpoint, accessToken] : null,
    ([url, token]) => fetcher(url, token as string),
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
    endpoint ? [endpoint, accessToken] : null,
    ([url, token]) => fetcher(url, token as string),
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
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ audiobook }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to create request');
      }

      // Revalidate requests list
      mutate((key) => Array.isArray(key) && key[0]?.includes('/api/requests'));

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
      const response = await fetch(`/api/requests/${requestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'cancel' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to cancel request');
      }

      // Revalidate requests
      mutate((key) => Array.isArray(key) && key[0]?.includes('/api/requests'));

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
