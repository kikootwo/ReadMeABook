/**
 * Component: Goodreads Feed Ended Notice (Profile shelf card)
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Shown on every Goodreads shelf: Goodreads no longer serves shelf RSS feeds (#514).
 * GoodreadsShelf stores no sync error, so the notice does not depend on a failed sync.
 */

import React from 'react';
import { GOODREADS_FEEDS_ENDED_NOTICE } from '@/lib/utils/goodreads-rss-url';

export function GoodreadsFeedEndedNotice() {
  return (
    <p
      role="note"
      className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
    >
      <svg
        className="w-3.5 h-3.5 mt-px flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
        />
      </svg>
      <span>{GOODREADS_FEEDS_ENDED_NOTICE}</span>
    </p>
  );
}
