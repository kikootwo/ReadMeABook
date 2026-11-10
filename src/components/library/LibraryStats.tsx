/**
 * Component: Library heading and stats tiles (unfiltered counts; tiles are not buttons)
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React from 'react';
import type { LibraryResponse } from '@/lib/library-view/types';
import { STATUS_GROUP_DOTS } from './card-display';

interface LibraryStatsProps {
  stats: LibraryResponse['stats'] | null;
  /** Live polling is on (something is moving). */
  live: boolean;
}

/** Each tile's dots are its status groups' colours ("Need a look" counts two groups, so two dots). */
const TILES: { key: keyof LibraryResponse['stats']; label: string; dots: string[] }[] = [
  { key: 'total', label: 'Books', dots: ['bg-gray-400'] },
  { key: 'available', label: 'In your library', dots: [STATUS_GROUP_DOTS.available] },
  { key: 'onTheWay', label: 'On the way', dots: [STATUS_GROUP_DOTS.on_the_way] },
  { key: 'needsALook', label: 'Need a look', dots: [STATUS_GROUP_DOTS.problem, STATUS_GROUP_DOTS.needs_approval] },
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
      {/* Phones: two rows of two, so every label reads whole */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {TILES.map((tile) => (
          <div
            key={tile.key}
            className="rounded-xl sm:rounded-2xl px-3 py-2 sm:px-4 sm:py-3 bg-white/90 dark:bg-gray-800/90 border border-gray-200/50 dark:border-gray-700/50 shadow-sm min-w-0"
          >
            <dt className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">
              <span className="inline-flex -space-x-0.5 flex-shrink-0" aria-hidden="true" data-tile-dots={tile.key}>
                {tile.dots.map((dot) => (
                  <span key={dot} className={`inline-block w-2 h-2 rounded-full ring-1 ring-white dark:ring-gray-800 ${dot}`} />
                ))}
              </span>
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
