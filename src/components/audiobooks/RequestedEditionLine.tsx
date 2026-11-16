/**
 * Component: Requested edition line of the details modal
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';

interface RequestedEditionLineProps {
  /** The requested edition's Audible record (title and narrator are shown when set) */
  requested: { title?: string | null; narrator?: string | null };
  requestedAsin: string;
  /** The library's edition when it differs from the requested one, else null (renders nothing) */
  libraryAsin: string | null;
  /** The modal shows the library's edition; false when its lookup failed */
  libraryShown: boolean;
}

/**
 * When the library holds another edition: names the requested edition under the library's one,
 * or, when the library edition could not be looked up, says which ASIN the library holds.
 */
export function RequestedEditionLine({ requested, requestedAsin, libraryAsin, libraryShown }: RequestedEditionLineProps) {
  if (!libraryAsin) return null;

  const text = libraryShown
    ? [requested.title, requested.narrator && `narrated by ${requested.narrator}`, requestedAsin].filter(Boolean).join(' · ')
    : `Your library holds a different edition (ASIN ${libraryAsin})`;

  return (
    <p data-testid="requested-edition" className="mt-2 text-sm text-gray-500 dark:text-gray-400 break-words">
      {libraryShown && <span className="font-medium text-gray-700 dark:text-gray-300">Requested edition: </span>}
      {text}
    </p>
  );
}
