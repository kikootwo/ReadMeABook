/**
 * Component: Series Grid
 * Documentation: documentation/frontend/components.md
 *
 * Grid layout for series cards with loading skeletons and empty state.
 * Uses the same responsive column system as AudiobookGrid since
 * series cards use rectangular (2:3) aspect ratios like book covers.
 */

'use client';

import React from 'react';
import { SeriesCard } from './SeriesCard';
import { SeriesSummary } from '@/lib/hooks/useSeries';

interface SeriesGridProps {
  series: SeriesSummary[];
  isLoading?: boolean;
  emptyMessage?: string;
  cardSize?: number;
  squareCovers?: boolean;
}

function getGridClasses(size: number): string {
  const sizeMap: Record<number, string> = {
    1: 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10',
    2: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9',
    3: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8',
    4: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7',
    5: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
    6: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
    7: 'grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
    8: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
    9: 'grid-cols-1 sm:grid-cols-2',
  };
  return sizeMap[size] || sizeMap[5];
}

export function SeriesGrid({
  series,
  isLoading = false,
  emptyMessage = 'No series found',
  cardSize = 5,
  squareCovers = false,
}: SeriesGridProps) {
  const gridClasses = getGridClasses(cardSize);

  if (isLoading) {
    return (
      <div className={`grid ${gridClasses} gap-4 sm:gap-5 lg:gap-6`}>
        {Array.from({ length: 10 }).map((_, i) => (
          <SeriesSkeletonCard key={i} index={i} squareCovers={squareCovers} />
        ))}
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-20 h-20 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-lg">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`grid ${gridClasses} gap-4 sm:gap-5 lg:gap-6`}>
      {series.map(s => (
        <SeriesCard key={s.asin} series={s} squareCovers={squareCovers} />
      ))}
    </div>
  );
}

function SeriesSkeletonCard({ index = 0, squareCovers = false }: { index?: number; squareCovers?: boolean }) {
  return (
    <div
      className="animate-pulse"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Rectangular cover skeleton */}
      <div className={`relative overflow-hidden rounded-xl w-full ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'} bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800`}>
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      {/* Text skeleton */}
      <div className="mt-3 px-1 flex flex-col items-center space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-lg w-4/5" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-lg w-3/5" />
      </div>
    </div>
  );
}
