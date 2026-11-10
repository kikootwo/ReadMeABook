/**
 * Component: Bulk Import - finished screen (queued count, refused rows with their reasons)
 * Documentation: documentation/features/bulk-import.md
 *
 * Execute answers one result per row, in the order sent, so a refused result is matched to its
 * row by index (two tag groups in one folder share a folder path).
 */

'use client';

import React from 'react';
import { XCircleIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import type { ImportOutcome } from './types';

/** Refused rows: the sent row's path relative to the scan root (else the folder path) and the reason. */
export function refusedRows(outcome: ImportOutcome) {
  return (outcome.results ?? [])
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => !result.success)
    .map(({ result, index }) => ({
      index,
      path: outcome.sentPaths?.[index] ?? result.folderPath,
      reason: result.error || 'Import failed',
    }));
}

interface ImportResultsViewProps {
  outcome: ImportOutcome;
  onClose: () => void;
}

export function ImportResultsView({ outcome, onClose }: ImportResultsViewProps) {
  if (outcome.success === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-16">
        <XCircleIcon className="w-14 h-14 text-red-500 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Import Failed</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">
          {outcome.error || 'An unexpected error occurred'}
        </p>
        <button
          onClick={onClose}
          className="px-6 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-medium rounded-xl transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  const succeeded = outcome.summary?.succeeded || 0;
  const failed = outcome.summary?.failed || 0;
  const refused = refusedRows(outcome);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col items-center justify-center min-h-full px-4 sm:px-6 py-10">
        <CheckCircleSolid className="w-14 h-14 text-green-500 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Import Started</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-2">
          {succeeded} audiobook{succeeded !== 1 ? 's' : ''} queued for import.
        </p>
        {failed > 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400 text-center mb-2">
            {failed} book{failed !== 1 ? 's' : ''} could not be queued.
          </p>
        )}
        {refused.length > 0 && (
          <ul
            aria-label="Books not queued"
            className="w-full max-w-lg max-h-56 overflow-y-auto my-3 rounded-xl border border-amber-200 dark:border-amber-800/50 divide-y divide-amber-100 dark:divide-amber-900/40 text-left"
          >
            {refused.map((row) => (
              <li key={row.index} className="px-3 py-2">
                <p className="text-[11px] font-mono text-gray-600 dark:text-gray-300 break-all">{row.path}</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">{row.reason}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center max-w-sm">
          Files will be organized, tagged, and imported into your library. Check the admin
          dashboard for progress.
        </p>
        <button
          onClick={onClose}
          className="mt-6 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
