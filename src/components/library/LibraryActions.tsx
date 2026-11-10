/**
 * Component: Library detail actions (existing endpoints only; each runs its own check)
 * Documentation: documentation/features/library-view.md
 *
 * Search again → POST /api/requests/[id]/manual-search. Interactive search → the existing modal
 * (interactive-search, then select-torrent). Fetch ebook → POST /api/requests/[id]/fetch-ebook.
 * View request → /admin (admin) or /requests. After an action: toast, then the list, live and the
 * request detail revalidate.
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { InteractiveTorrentSearchModal } from '@/components/requests/InteractiveTorrentSearchModal';
import { useToast } from '@/components/ui/Toast';
import { useManualSearch } from '@/lib/hooks/useRequests';
import { fetchWithAuth } from '@/lib/utils/api';
import type { LibraryItem } from '@/lib/library-view/types';
import type { LibraryActionSet } from './library-actions';

interface LibraryActionsProps {
  item: LibraryItem;
  actions: LibraryActionSet;
  /** Admin-set search terms from the request detail; undefined until it has loaded. */
  customSearchTerms: string | null | undefined;
  onChanged: () => void;
  onChildOpenChange: (open: boolean) => void;
}

const BUTTON =
  'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
const PRIMARY = `${BUTTON} bg-blue-600 hover:bg-blue-700 text-white`;
const SECONDARY = `${BUTTON} border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800`;

export function LibraryActions({ item, actions, customSearchTerms, onChanged, onChildOpenChange }: LibraryActionsProps) {
  const toast = useToast();
  const { triggerManualSearch } = useManualSearch();
  const [busy, setBusy] = useState<'search' | 'ebook' | null>(null);
  const [showInteractive, setShowInteractive] = useState(false);
  const requestId = item.request?.id;

  useEffect(() => {
    onChildOpenChange(showInteractive);
  }, [showInteractive, onChildOpenChange]);

  if (!requestId) return null;

  const searchAgain = async () => {
    setBusy('search');
    try {
      await triggerManualSearch(requestId);
      toast.success(`Searching again for ${item.title}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start the search');
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const fetchEbook = async () => {
    setBusy('ebook');
    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/fetch-ebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Failed to fetch the ebook');
      if (data.success) toast.success(data.message || 'Ebook fetch started');
      else toast.warning(`Ebook fetch failed: ${data.message}`);
    } catch (error) {
      toast.error(`Failed to fetch the ebook: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const interactiveReady = customSearchTerms !== undefined;

  return (
    <div className="flex flex-wrap gap-3">
      {actions.searchAgain && (
        <button type="button" onClick={searchAgain} disabled={busy !== null} className={PRIMARY}>
          {busy === 'search' ? 'Searching...' : 'Search again'}
        </button>
      )}
      {actions.interactiveSearch && (
        <button
          type="button"
          onClick={() => setShowInteractive(true)}
          disabled={busy !== null || !interactiveReady}
          className={actions.searchAgain ? SECONDARY : PRIMARY}
        >
          Interactive search
        </button>
      )}
      {actions.fetchEbook && (
        <button type="button" onClick={fetchEbook} disabled={busy !== null} className={SECONDARY}>
          {busy === 'ebook' ? 'Fetching ebook...' : 'Fetch ebook'}
        </button>
      )}
      {actions.viewRequestHref && (
        <Link href={actions.viewRequestHref} className={SECONDARY}>
          View request
        </Link>
      )}

      {showInteractive && (
        <InteractiveTorrentSearchModal
          isOpen={showInteractive}
          onClose={() => setShowInteractive(false)}
          requestId={requestId}
          audiobook={{ title: item.title, author: item.author }}
          customSearchTerms={customSearchTerms ?? null}
          onSuccess={() => {
            toast.success(`Download started for ${item.title}`);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
