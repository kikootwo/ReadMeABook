/**
 * Component: Library empty, no-match and error states; the admin's no-library notice
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { fetchWithAuth } from '@/lib/utils/api';
import { useToast } from '@/components/ui/Toast';

type EmptyKind = 'empty' | 'no-match' | 'error';

interface LibraryEmptyStateProps {
  kind: EmptyKind;
  isAdmin: boolean;
  onClearAll?: () => void;
  onRetry?: () => void;
}

const COPY: Record<EmptyKind, { title: string; body: string }> = {
  empty: { title: 'Nothing here yet', body: 'Books in your library and every request show up here.' },
  'no-match': { title: 'No books match', body: 'Try another search or fewer filters.' },
  error: { title: "Couldn't load the library", body: 'Something went wrong while loading. Try again.' },
};

const BUTTON = 'inline-flex items-center justify-center h-10 px-4 rounded-xl text-sm font-semibold';
const PRIMARY = `${BUTTON} bg-blue-600 hover:bg-blue-700 text-white`;
const SECONDARY = `${BUTTON} border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800`;

/** Admin: run the scheduled library scan now (the existing job; never the direct scan route). */
function ScanNowButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [noJob, setNoJob] = useState(false);

  const scan = async () => {
    setBusy(true);
    try {
      const res = await fetchWithAuth('/api/admin/jobs');
      const body = await res.json().catch(() => null);
      const job = (body?.jobs as { id: string; type: string }[] | undefined)?.find((j) => j.type === 'plex_library_scan');
      if (!res.ok || !job) {
        setNoJob(true);
        return;
      }
      const run = await fetchWithAuth(`/api/admin/jobs/${job.id}/trigger`, { method: 'POST' });
      const result = await run.json().catch(() => null);
      if (!run.ok) throw new Error(result?.message || 'Failed to start the library scan');
      toast.success('Library scan started. Books appear here when it finishes.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start the library scan');
    } finally {
      setBusy(false);
    }
  };

  if (noJob) {
    return (
      <Link href="/admin/jobs" className={SECONDARY}>
        Open scheduled jobs
      </Link>
    );
  }
  return (
    <button type="button" onClick={scan} disabled={busy} className={`${SECONDARY} disabled:opacity-60`}>
      {busy ? 'Starting scan...' : 'Scan library now'}
    </button>
  );
}

export function LibraryEmptyState({ kind, isAdmin, onClearAll, onRetry }: LibraryEmptyStateProps) {
  const copy = COPY[kind];
  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-20 text-center" role={kind === 'error' ? 'alert' : undefined}>
      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-5">
        <svg className="w-8 h-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{copy.title}</h2>
      <p className="mt-2 text-gray-500 dark:text-gray-400">{copy.body}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {kind === 'empty' && (
          <>
            <Link href="/search" className={PRIMARY}>
              Find a book
            </Link>
            {isAdmin && <ScanNowButton />}
          </>
        )}
        {kind === 'no-match' && (
          <button type="button" onClick={onClearAll} className={PRIMARY}>
            Clear search and filters
          </button>
        )}
        {kind === 'error' && (
          <button type="button" onClick={onRetry} className={PRIMARY}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/** Admin only: no library is selected, so only requested books are listed. */
export function NotConfiguredNotice() {
  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      No library is selected, so only requested books are listed.{' '}
      <Link href="/admin/settings?tab=library" className="font-semibold underline">
        Choose a library in Settings
      </Link>
    </div>
  );
}

/** Kept items with a failed refresh: a quiet inline retry. */
export function LoadErrorBar({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
      <span>Couldn&apos;t load the library.</span>
      <button type="button" onClick={onRetry} className="font-semibold underline">
        Retry
      </button>
    </div>
  );
}
