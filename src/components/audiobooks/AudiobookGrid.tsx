/**
 * Component: Audiobook Grid
 * Documentation: documentation/frontend/components.md
 *
 * Premium grid layout with generous spacing and elegant skeletons
 */

'use client';

import React from 'react';
import { AudiobookCard } from './AudiobookCard';
import { Audiobook } from '@/lib/hooks/useAudiobooks';

interface AudiobookGridProps {
  audiobooks: Audiobook[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRequestSuccess?: () => void;
  cardSize?: number; // 1-9, default 5
  squareCovers?: boolean; // true = square (1:1), false = rectangle (2:3)
}

// Grid classes with generous spacing for premium feel
// IMPORTANT: Classes must be explicit strings for Tailwind purging
export function getGridClasses(size: number): string {
  const sizeMap: Record<number, string> = {
    1: 'grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10',
    2: 'grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9',
    3: 'grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
    4: 'grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7',
    5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
    6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
    7: 'grid-cols-2 md:grid-cols-3',
    8: 'grid-cols-2',
    9: 'grid-cols-1',
  };
  return sizeMap[size] || sizeMap[5];
}

export function AudiobookGrid({
  audiobooks,
  isLoading = false,
  emptyMessage = 'No audiobooks found',
  onRequestSuccess,
  cardSize = 5,
  squareCovers = false,
}: AudiobookGridProps) {
  const gridClasses = getGridClasses(cardSize);

  if (isLoading) {
    return (
      <div className={`grid ${gridClasses} gap-5 sm:gap-6 lg:gap-8`}>
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonCard key={i} squareCovers={squareCovers} index={i} />
        ))}
      </div>
    );
  }

  if (audiobooks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-lg">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`grid ${gridClasses} gap-5 sm:gap-6 lg:gap-8`}>
      {audiobooks.map((audiobook) => (
        <AudiobookCard
          key={audiobook.asin}
          audiobook={audiobook}
          onRequestSuccess={onRequestSuccess}
          squareCovers={squareCovers}
        />
      ))}
    </div>
  );
}

// Premium skeleton with shimmer effect
export function SkeletonCard({ squareCovers = false, index = 0 }: { squareCovers?: boolean; index?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Cover Skeleton */}
      <div
        className={`
          relative overflow-hidden rounded-2xl
          bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800
          ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'}
        `}
      >
        {/* Shimmer overlay */}
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      {/* Text Skeleton */}
      <div className="mt-3 px-1 space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-lg w-4/5" />
        <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded-lg w-3/5" />
      </div>
    </div>
  );
}
