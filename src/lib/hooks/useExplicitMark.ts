/**
 * Component: Explicit mark hooks (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * useBackendMode: the library backend from the public /api/auth/providers (null while loading or on
 * error), so the Explicit controls show in Audiobookshelf mode only.
 * useSetExplicit: PUT /api/requests/[id]/explicit; returns the server's message (shown as a toast)
 * and revalidates the request lists.
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { fetchWithAuth } from '@/lib/utils/api';

export type BackendMode = 'plex' | 'audiobookshelf';

const providersFetcher = async (url: string): Promise<{ backendMode?: string }> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

export function useBackendMode(): BackendMode | null {
  const { data } = useSWR('/api/auth/providers', providersFetcher, { revalidateOnFocus: false });
  const mode = data?.backendMode;
  return mode === 'plex' || mode === 'audiobookshelf' ? mode : null;
}

/** True only once the backend is known to be Audiobookshelf. */
export function useIsAudiobookshelf(): boolean {
  return useBackendMode() === 'audiobookshelf';
}

export interface SetExplicitResult {
  explicit: boolean;
  /** Set when Audiobookshelf wasn't changed or the admin needs to act there */
  message?: string;
}

export function useSetExplicit() {
  const [isLoading, setIsLoading] = useState(false);

  const setExplicit = async (requestId: string, explicit: boolean): Promise<SetExplicitResult> => {
    setIsLoading(true);
    try {
      const response = await fetchWithAuth(`/api/requests/${encodeURIComponent(requestId)}/explicit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ explicit }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || 'Failed to update the explicit mark');
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));
      mutate((key) => typeof key === 'string' && key.includes('/api/admin/requests'));
      return { explicit: data?.request?.explicit === true, ...(data?.message ? { message: data.message } : {}) };
    } finally {
      setIsLoading(false);
    }
  };

  return { setExplicit, isLoading };
}
