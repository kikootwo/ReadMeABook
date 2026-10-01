/**
 * Component: Admin Author Blacklist Page
 * Documentation: documentation/admin-features/author-blacklist.md
 *
 * Review + remove only. Adding is done from the author detail page (admin-only button).
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { authenticatedFetcher, fetchWithAuth } from '@/lib/utils/api';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { formatDistanceToNow } from 'date-fns';

interface BlacklistEntry {
  id: string;
  authorName: string;
  authorKey: string;
  createdAt: string;
}

interface BlacklistData {
  entries: BlacklistEntry[];
  count: number;
}

function AuthorBlacklistContent() {
  const toast = useToast();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<BlacklistData>(
    '/api/admin/author-blacklist',
    authenticatedFetcher
  );

  const entries = data?.entries ?? [];

  const handleRemove = async (entry: BlacklistEntry) => {
    if (removingId) return;
    setRemovingId(entry.id);
    try {
      const response = await fetchWithAuth(
        `/api/admin/author-blacklist/${entry.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to remove author');
      }
      toast.success(`Unblocked "${entry.authorName}"`);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove author');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Author Blacklist
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Review and remove blocked authors. To blacklist an author, open their
              author page and use Blacklist Author (admins only).
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors text-sm font-medium self-start sm:self-auto flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            <span>Back to Dashboard</span>
          </Link>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              Error Loading Author Blacklist
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {error?.message || 'Failed to load author blacklist'}
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2" data-testid="author-blacklist-skeleton">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              No authors on the blacklist yet. Open an author page and use
              Blacklist Author to add one.
            </p>
          </div>
        ) : (
          <ul className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {entry.authorName}
                  </p>
                  <p
                    className="text-xs text-gray-500 dark:text-gray-400"
                    title={new Date(entry.createdAt).toLocaleString()}
                  >
                    Blocked{' '}
                    {formatDistanceToNow(new Date(entry.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(entry)}
                  disabled={removingId === entry.id}
                  className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  {removingId === entry.id ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AdminAuthorBlacklistPage() {
  return (
    <ToastProvider>
      <AuthorBlacklistContent />
    </ToastProvider>
  );
}
