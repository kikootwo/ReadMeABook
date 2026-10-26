/**
 * Component: Watch Mode Choice (Entire catalog / New releases only)
 * Documentation: documentation/features/watched-lists.md
 *
 * Radio group used in the Watch confirm dialog and in the watched list's "Change" dialog.
 */

'use client';

import React, { useId } from 'react';

interface WatchModeChoiceProps {
  kind: 'author' | 'series';
  /** Author name or series title */
  name: string;
  /** Selected mode: true = new releases only */
  value: boolean;
  onChange: (newReleasesOnly: boolean) => void;
  /** Existing watch's mode (change dialog); omit when creating a watch */
  current?: boolean;
  /** Existing watch's cutoff (ISO), shown when it is already new-only */
  currentSince?: string | null;
}

export function formatWatchDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function WatchModeChoice({ kind, name, value, onChange, current, currentSince }: WatchModeChoiceProps) {
  const groupName = useId();
  const scope = kind === 'author' ? `by "${name}"` : `in "${name}"`;
  const keepsCutoff = current === true && currentSince;

  const options = [
    {
      newReleasesOnly: false,
      title: 'Entire catalog',
      description: kind === 'author'
        ? `Request every book ${scope} that isn't in your library, then new releases as they come out.`
        : `Request every book ${scope} that isn't in your library, then new releases as they're added.`,
    },
    {
      newReleasesOnly: true,
      title: 'New releases only',
      description: keepsCutoff
        ? `Request only books released since ${formatWatchDate(currentSince)}. Older books aren't requested.`
        : "Request only books released from today on. Older books aren't requested.",
    },
  ];

  return (
    <div className="space-y-3">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-900 dark:text-white mb-3">What should be requested?</legend>
        {options.map((option) => {
          const checked = value === option.newReleasesOnly;
          return (
            <label
              key={option.title}
              className={`flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all ${
                checked
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <input
                type="radio"
                name={groupName}
                value={option.newReleasesOnly ? 'new' : 'all'}
                checked={checked}
                onChange={() => onChange(option.newReleasesOnly)}
                autoFocus={checked}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-3 flex-1">
                <span className="block font-medium text-gray-900 dark:text-white">{option.title}</span>
                <span className="block text-sm text-gray-500 dark:text-gray-400 mt-1">{option.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div aria-live="polite">
        {current === true && !value && (
          <p className="text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/50">
            The next watched-list check requests every book {scope} that isn&apos;t in your library. That can be a lot of requests.
          </p>
        )}
      </div>
    </div>
  );
}
