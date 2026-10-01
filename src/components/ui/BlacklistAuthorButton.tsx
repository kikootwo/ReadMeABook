/**
 * Component: Blacklist Author Button
 * Documentation: documentation/admin-features/author-blacklist.md
 *
 * Admin-only toggle on the author detail page. Mirrors WatchAuthorButton UX:
 * confirm before blacklisting; unblock is instant.
 */

'use client';

import React, { useState } from 'react';
import {
  useAuthorBlacklist,
  useAddAuthorBlacklist,
  useRemoveAuthorBlacklist,
} from '@/lib/hooks/useAuthorBlacklist';
import { ConfirmModal } from './ConfirmModal';

interface BlacklistAuthorButtonProps {
  authorName: string;
}

export function BlacklistAuthorButton({ authorName }: BlacklistAuthorButtonProps) {
  const { isAdmin, findByAuthorName } = useAuthorBlacklist();
  const { addAuthor, isLoading: isAdding } = useAddAuthorBlacklist();
  const { removeAuthor, isLoading: isRemoving } = useRemoveAuthorBlacklist();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  if (!isAdmin) return null;

  const blockedEntry = findByAuthorName(authorName);
  const isBlacklisted = !!blockedEntry;
  const isLoading = isAdding || isRemoving;

  const handleClick = async () => {
    setError(null);
    if (isBlacklisted && blockedEntry) {
      try {
        await removeAuthor(blockedEntry.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      }
    } else {
      setShowConfirm(true);
    }
  };

  const handleConfirmBlacklist = async () => {
    setShowConfirm(false);
    setError(null);
    try {
      await addAuthor(authorName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
          isBlacklisted
            ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-700/50'
            : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300 border border-gray-200 dark:border-gray-600/50 hover:border-red-200 dark:hover:border-red-700/50'
        } ${isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {isLoading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        )}
        {isBlacklisted ? 'Blacklisted' : 'Blacklist Author'}
      </button>
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmBlacklist}
        title={`Blacklist "${authorName}"?`}
        message={`Requests for books by "${authorName}" will be rejected for all users with a notice that the author is blocked by the administrator. Continue?`}
        confirmText="Blacklist"
        variant="danger"
        isLoading={isAdding}
      />
    </div>
  );
}
