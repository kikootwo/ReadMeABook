/**
 * Component: Explicit mark hooks (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * useExplicitMarkEnabled: true only once the public /api/auth/providers (cached by SWR, one request
 * for every card) says Audiobookshelf mode and the admin setting is on; false while loading, on
 * error, in Plex mode or with the setting off, so no control flashes before the answer arrives.
 * useSetExplicit: PUT /api/requests/[id]/explicit; returns the server's message (shown as a toast)
 * and revalidates the plain request keys (the admin table). The filter mutate skips infinite lists:
 * My Requests reloads its own through RequestCard's onChanged. A 403 FeatureDisabled answer (turned
 * off since the page loaded) revalidates the providers key, so the controls on that page disappear.
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { fetchWithAuth } from '@/lib/utils/api';

/** SWR key of the public providers response; the settings save revalidates it. */
export const PROVIDERS_KEY = '/api/auth/providers';

const providersFetcher = async (url: string): Promise<{ backendMode?: string; explicitMarkEnabled?: boolean }> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

/** True only once the backend is known to be Audiobookshelf and the Explicit mark setting is on. */
export function useExplicitMarkEnabled(): boolean {
  const { data } = useSWR(PROVIDERS_KEY, providersFetcher, { revalidateOnFocus: false });
  return data?.backendMode === 'audiobookshelf' && data.explicitMarkEnabled === true;
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
      if (!response.ok) {
        // Turned off since this page loaded: refetch the flag so the controls disappear here
        if (data?.error === 'FeatureDisabled') void mutate(PROVIDERS_KEY);
        throw new Error(data?.message || 'Failed to update the explicit mark');
      }
      mutate((key) => typeof key === 'string' && key.includes('/api/requests'));
      mutate((key) => typeof key === 'string' && key.includes('/api/admin/requests'));
      return { explicit: data?.request?.explicit === true, ...(data?.message ? { message: data.message } : {}) };
    } finally {
      setIsLoading(false);
    }
  };

  return { setExplicit, isLoading };
}
