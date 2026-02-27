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

  const createRequest = async (audiobook: Audiobook, options?: { skipAutoSearch?: boolean }) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const queryParams = options?.skipAutoSearch ? '?skipAutoSearch=true' : '';
      const response = await fetchWithAuth(`/api/requests${queryParams}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audiobook }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle specific error types with custom messages
        if (data.error === 'BeingProcessed') {
          throw new Error('This audiobook is being processed. It will be available in your library soon.');
        }
        if (data.error === 'AlreadyAvailable') {
          throw new Error('This audiobook is already in your Plex library.');
        }
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

  const searchTorrents = async (requestId: string, customTitle?: string) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/interactive-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: customTitle ? JSON.stringify({ customTitle }) : undefined,
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

export function useSearchTorrents() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTorrents = async (title: string, author: string, asin?: string) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/audiobooks/search-torrents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, author, asin }),
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

export function useRequestWithTorrent() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestWithTorrent = async (audiobook: Audiobook, torrent: any) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/audiobooks/request-with-torrent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audiobook, torrent }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle specific error types with custom messages
        if (data.error === 'BeingProcessed') {
          throw new Error('This audiobook is being processed. It will be available in your library soon.');
        }
        if (data.error === 'AlreadyAvailable') {
          throw new Error('This audiobook is already in your Plex library.');
        }
        throw new Error(data.message || 'Failed to create request and download torrent');
      }

      // Revalidate requests
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));

      // Revalidate audiobook lists
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

  return { requestWithTorrent, isLoading, error };
}

export function useInteractiveSearchEbook() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchEbooks = async (requestId: string, customTitle?: string) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/interactive-search-ebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: customTitle ? JSON.stringify({ customTitle }) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to search for ebooks');
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

  return { searchEbooks, isLoading, error };
}

export function useSelectEbook() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectEbook = async (requestId: string, ebook: any) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/select-ebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ebook }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to download ebook');
      }

      // Revalidate requests
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { selectEbook, isLoading, error };
}

// ==================== ASIN-based Ebook Hooks ====================
// These hooks are used for requesting ebooks from the audiobook details modal
// where we only have an ASIN, not an existing request ID

export interface EbookStatus {
  ebookSourcesEnabled: boolean;
  hasActiveEbookRequest: boolean;
  existingEbookStatus: string | null;
  existingEbookRequestId: string | null;
}

export function useEbookStatus(asin: string | null) {
  const { accessToken } = useAuth();

  const endpoint = accessToken && asin ? `/api/audiobooks/${asin}/ebook-status` : null;

  const { data, error, isLoading, mutate: revalidate } = useSWR<EbookStatus>(
    endpoint,
    fetcher,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
    }
  );

  return {
    ebookStatus: data || null,
    isLoading,
    error,
    revalidate,
  };
}

interface DownloadStatus {
  downloadAvailable: boolean;
  requestId: string | null;
}

export function useDownloadStatus(asin: string | null) {
  const { accessToken } = useAuth();

  const endpoint = accessToken && asin ? `/api/audiobooks/${asin}/download-status` : null;

  const { data, isLoading } = useSWR<DownloadStatus>(endpoint, fetcher);

  return {
    downloadAvailable: data?.downloadAvailable ?? false,
    requestId: data?.requestId ?? null,
    isLoading,
  };
}

export function useFetchEbookByAsin() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEbook = async (asin: string) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/audiobooks/${asin}/fetch-ebook`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to request ebook');
      }

      // Revalidate requests and ebook status
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));
      mutate((key) => typeof key === 'string' && key.includes('/api/audiobooks'));

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { fetchEbook, isLoading, error };
}

export function useInteractiveSearchEbookByAsin() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchEbooks = async (asin: string, customTitle?: string) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/audiobooks/${asin}/interactive-search-ebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: customTitle ? JSON.stringify({ customTitle }) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to search for ebooks');
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

  return { searchEbooks, isLoading, error };
}

export function useSelectEbookByAsin() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectEbook = async (asin: string, ebook: any) => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/audiobooks/${asin}/select-ebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ebook }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to download ebook');
      }

      // Revalidate requests and ebook status
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));
      mutate((key) => typeof key === 'string' && key.includes('/api/audiobooks'));

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { selectEbook, isLoading, error };
}
