/**
 * Component: Series Detail Card
 * Documentation: documentation/frontend/components.md
 *
 * Hero section for the series detail page with rectangular cover image,
 * title, book count, rating, collapsible description, and tag pills.
 */

'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { SeriesDetail } from '@/lib/hooks/useSeries';

interface SeriesDetailCardProps {
  series: SeriesDetail;
  squareCovers?: boolean;
}

export function SeriesDetailCard({ series, squareCovers = false }: SeriesDetailCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasLongDescription = (series.description?.length || 0) > 300;

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
      {/* Rectangular Cover */}
      <div className="flex-shrink-0">
        <div className={`relative w-36 sm:w-44 lg:w-52 ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'} rounded-xl overflow-hidden shadow-xl shadow-black/20 dark:shadow-black/40`}>
          {series.books[0]?.coverArtUrl ? (
            <Image
              src={series.books[0].coverArtUrl}
              alt={series.title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 144px, (max-width: 1024px) 176px, 208px"
              priority
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-100 to-teal-200 dark:from-emerald-900 dark:to-teal-900 flex items-center justify-center">
              <svg className="w-1/3 h-1/3 text-emerald-400 dark:text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Series Info */}
      <div className="flex-1 min-w-0 text-center sm:text-left">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100">
          {series.title}
        </h1>

        {/* Meta row: book count + rating */}
        <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-3">
          {series.bookCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              {series.bookCount} Book{series.bookCount !== 1 ? 's' : ''}
            </span>
          )}

          {series.rating != null && series.rating > 0 && (
            <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              {series.rating.toFixed(1)}
              {series.ratingCount != null && series.ratingCount > 0 && (
                <span className="text-gray-400 dark:text-gray-500">
                  ({series.ratingCount.toLocaleString()})
                </span>
              )}
            </span>
          )}
        </div>

        {/* Tag Pills */}
        {series.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center sm:justify-start gap-2">
            {series.tags.map(tag => (
              <span
                key={tag}
                className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Audible Link */}
        {series.audibleUrl && (
          <a
            href={series.audibleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            View on Audible
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}

        {/* Description */}
        {series.description && (
          <div className="mt-4">
            <p
              className={`text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line ${
                !expanded && hasLongDescription ? 'line-clamp-4' : ''
              }`}
            >
              {series.description}
            </p>
            {hasLongDescription && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SeriesDetailSkeleton({ squareCovers = false }: { squareCovers?: boolean }) {
  return (
    <div className="animate-pulse flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
      {/* Cover skeleton */}
      <div className="flex-shrink-0">
        <div className={`w-36 sm:w-44 lg:w-52 ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'} rounded-xl bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 relative overflow-hidden`}>
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>
      </div>

      {/* Info skeleton */}
      <div className="flex-1 min-w-0 text-center sm:text-left space-y-4">
        <div className="h-9 bg-gray-200 dark:bg-gray-700 rounded-lg w-64 mx-auto sm:mx-0" />
        <div className="flex gap-2 justify-center sm:justify-start">
          <div className="h-7 w-24 bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>
        <div className="flex gap-2 justify-center sm:justify-start">
          <div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-4/6" />
        </div>
      </div>
    </div>
  );
}
