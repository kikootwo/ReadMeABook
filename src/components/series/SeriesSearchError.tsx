/**
 * Component: Series Search Error
 * Documentation: documentation/frontend/components.md
 *
 * Shown in place of the series grid when a search fails, so a failure never reads as
 * "No series found". The Audible wording is only for the route's 502 (the Audible
 * catalog didn't answer); any other failure gets the generic line.
 */

'use client';

import React, { useEffect, useRef } from 'react';
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface SeriesSearchErrorProps {
  /** The route answered 502: Audible didn't return results */
  audibleUnavailable: boolean;
  onRetry: () => void;
  /** Move focus to Try again when shown (after the user's own retry failed) */
  focusRetry?: boolean;
  /** Called once focus has moved, so the parent can drop the request */
  onRetryFocused?: () => void;
}

export function SeriesSearchError({ audibleUnavailable, onRetry, focusRetry = false, onRetryFocused }: SeriesSearchErrorProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusRetry) return;
    buttonRef.current?.focus();
    onRetryFocused?.();
  }, [focusRetry, onRetryFocused]);

  return (
    <div role="alert" className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <ExclamationTriangleIcon className="w-10 h-10 text-red-400 mb-3" aria-hidden="true" />
      <p className="text-gray-900 dark:text-gray-100 font-medium">
        {audibleUnavailable ? "Couldn't get results from Audible" : 'Series search failed'}
      </p>
      {audibleUnavailable && (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Audible didn&apos;t return series results. Try again in a moment.
        </p>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={onRetry}
        className="mt-4 min-h-[44px] flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <ArrowPathIcon className="w-4 h-4" aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
