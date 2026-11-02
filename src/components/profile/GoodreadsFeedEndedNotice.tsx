/**
 * Component: Goodreads Feed Ended Notice (Profile shelf card, Add Shelf modal)
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Shown on every Goodreads shelf and in the Add Shelf modal's Goodreads tab: Goodreads no longer
 * serves shelf RSS feeds (#514). GoodreadsShelf stores no sync error, so the notice does not
 * depend on a failed sync.
 */

import React from 'react';
import { GOODREADS_FEEDS_ENDED_NOTICE } from '@/lib/utils/goodreads-rss-url';
import { cn } from '@/lib/utils/cn';

interface GoodreadsFeedEndedNoticeProps {
  /** Defaults to the saved-shelf wording */
  message?: string;
  className?: string;
}

export function GoodreadsFeedEndedNotice({
  message = GOODREADS_FEEDS_ENDED_NOTICE,
  className,
}: GoodreadsFeedEndedNoticeProps) {
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed',
        'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60',
        'dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
        className,
      )}
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
      <span>{message}</span>
    </p>
  );
}
