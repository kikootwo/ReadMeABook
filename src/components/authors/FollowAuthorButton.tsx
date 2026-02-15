/**
 * Component: Follow Author Button
 * Documentation: documentation/features/followed-authors.md
 *
 * Toggle button for following/unfollowing an author.
 * Shows filled heart when following, outline when not.
 */

'use client';

import React from 'react';
import { useIsFollowing, useFollowActions } from '@/lib/hooks/useAuthors';

interface FollowAuthorButtonProps {
  asin: string;
  name: string;
  image?: string;
  /** Compact mode for cards (icon only) */
  compact?: boolean;
  className?: string;
}

export function FollowAuthorButton({
  asin,
  name,
  image,
  compact = false,
  className = '',
}: FollowAuthorButtonProps) {
  const { following, isLoading: statusLoading } = useIsFollowing(asin);
  const { follow, unfollow, isLoading: actionLoading } = useFollowActions();

  const isLoading = statusLoading || actionLoading;

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isLoading) return;

    if (following) {
      await unfollow(asin);
    } else {
      await follow({ asin, name, image });
    }
  };

  if (statusLoading) {
    return compact ? (
      <div className={`w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse ${className}`} />
    ) : (
      <div className={`h-10 w-32 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse ${className}`} />
    );
  }

  if (compact) {
    return (
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={`
          relative z-10 flex items-center justify-center
          w-8 h-8 rounded-full
          transition-all duration-200
          ${following
            ? 'bg-red-100 dark:bg-red-900/40 text-red-500 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/60'
            : 'bg-gray-100 dark:bg-gray-700/60 text-gray-400 dark:text-gray-500 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 hover:text-indigo-500 dark:hover:text-indigo-400'
          }
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className}
        `}
        aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
        title={following ? `Unfollow ${name}` : `Follow ${name}`}
      >
        {following ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={`
        inline-flex items-center gap-2 px-4 py-2 rounded-lg
        text-sm font-medium
        transition-all duration-200
        ${following
          ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40'
          : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
        }
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
      aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
    >
      {following ? (
        <>
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
          </svg>
          Following
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          Follow
        </>
      )}
    </button>
  );
}
