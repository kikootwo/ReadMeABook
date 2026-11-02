/**
 * Component: Watch Mode Control (Profile watched lists)
 * Documentation: documentation/features/watched-lists.md
 *
 * Shows a watch's mode ("Entire catalog" / "New releases since <date>") with a "Change"
 * button that opens the mode dialog and saves it (PATCH).
 */

'use client';

import React, { useState } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { WatchModeChoice, formatWatchDate } from '@/components/ui/WatchModeChoice';
import { useUpdateWatchedAuthor } from '@/lib/hooks/useWatchedAuthors';
import { useUpdateWatchedSeries } from '@/lib/hooks/useWatchedSeries';

interface WatchModeControlProps {
  kind: 'author' | 'series';
  id: string;
  /** Author name or series title */
  name: string;
  newReleasesOnly: boolean;
  newReleasesSince: string | null;
}

export function WatchModeControl({ kind, id, name, newReleasesOnly, newReleasesSince }: WatchModeControlProps) {
  const authorUpdate = useUpdateWatchedAuthor();
  const seriesUpdate = useUpdateWatchedSeries();
  const { setNewReleasesOnly, isLoading } = kind === 'author' ? authorUpdate : seriesUpdate;
  const [isOpen, setIsOpen] = useState(false);
  const [selection, setSelection] = useState(newReleasesOnly);
  const [error, setError] = useState<string | null>(null);

  const label = newReleasesOnly && newReleasesSince
    ? `New releases since ${formatWatchDate(newReleasesSince)}`
    : 'Entire catalog';

  const open = () => {
    setSelection(newReleasesOnly);
    setError(null);
    setIsOpen(true);
  };

  const save = async () => {
    try {
      await setNewReleasesOnly(id, selection);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 mt-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        <button
          type="button"
          onClick={open}
          aria-label={`Change what is requested for ${name}`}
          className="px-2 py-0.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          Change
        </button>
      </div>
      <ConfirmModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onConfirm={save}
        title={`Requests for "${name}"`}
        message={
          <div className="space-y-3">
            <WatchModeChoice
              kind={kind}
              name={name}
              value={selection}
              onChange={setSelection}
              current={newReleasesOnly}
              currentSince={newReleasesSince}
            />
            {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
          </div>
        }
        confirmText="Save"
        confirmDisabled={selection === newReleasesOnly}
        isLoading={isLoading}
      />
    </>
  );
}
