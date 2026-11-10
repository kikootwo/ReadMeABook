/**
 * Component: Library heading and stats tiles (unfiltered counts; tiles are not buttons)
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React from 'react';
import type { LibraryResponse } from '@/lib/library-view/types';

interface LibraryStatsProps {
  stats: LibraryResponse['stats'] | null;
  /** Live polling is on (something is moving). */
  live: boolean;
}

const TILES: { key: keyof LibraryResponse['stats']; label: string; dot: string }[] = [
  { key: 'total', label: 'Books', dot: 'bg-gray-400' },
  { key: 'available', label: 'In your library', dot: 'bg-emerald-400' },
  { key: 'onTheWay', label: 'On the way', dot: 'bg-amber-400' },
  { key: 'needsALook', label: 'Need a look', dot: 'bg-red-400' },
];

export function LibraryStats({ stats, live }: LibraryStatsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100">Library</h1>
        {live && (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
            title="Downloads in progress update by themselves"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
            Live
          </span>
        )}
      </div>
      <dl className="grid grid-cols-4 gap-2 sm:gap-4">
        {TILES.map((tile) => (
          <div
            key={tile.key}
            className="rounded-xl sm:rounded-2xl px-2.5 py-2 sm:px-4 sm:py-3 bg-white/90 dark:bg-gray-800/90 border border-gray-200/50 dark:border-gray-700/50 shadow-sm min-w-0"
          >
            <dt className="flex items-center gap-1.5 text-[11px] sm:text-sm text-gray-600 dark:text-gray-400 truncate">
              <span className={`hidden sm:inline-block w-2 h-2 rounded-full flex-shrink-0 ${tile.dot}`} aria-hidden="true" />
              <span className="truncate">{tile.label}</span>
            </dt>
            <dd className="mt-0.5 text-lg sm:text-2xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
              {stats ? stats[tile.key].toLocaleString() : '–'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
