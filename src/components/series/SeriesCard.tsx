/**
 * Component: Series Card
 * Documentation: documentation/frontend/components.md
 *
 * Premium "Cover First" design - metadata integrated into the cover overlay.
 * Rating badge top-left, book count top-right, tags in bottom gradient overlay.
 * Only the title lives below the cover, ensuring consistent row heights in the grid.
 */

'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SeriesSummary } from '@/lib/hooks/useSeries';

interface SeriesCardProps {
  series: SeriesSummary;
  squareCovers?: boolean;
}

export function SeriesCard({ series, squareCovers = false }: SeriesCardProps) {
  const visibleTags = series.tags.slice(0, 2);
  const hasTags = visibleTags.length > 0;
  const hasRating = series.rating != null && series.rating > 0;

  return (
    <Link
      href={`/series/${series.asin}`}
      className="group outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded-2xl block"
      aria-label={`View ${series.title} series`}
    >
      {/* Cover Container — The Hero */}
      <div
        className={`
          relative overflow-hidden rounded-xl
          w-full ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'}
          shadow-lg shadow-black/20 dark:shadow-black/40
          group-hover:shadow-xl group-hover:shadow-black/30 dark:group-hover:shadow-black/55
          transform group-hover:scale-[1.02] group-hover:-translate-y-0.5
          transition-all duration-300 ease-out
        `}
      >
        {/* Cover Art or Fallback */}
        {series.coverArtUrl ? (
          <Image
            src={series.coverArtUrl}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 to-teal-800 dark:from-emerald-700 dark:to-teal-900 flex items-center justify-center">
            <svg
              className="w-1/3 h-1/3 text-white/40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.2}
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
        )}

        {/* Top-row badges — Rating (left) + Book count (right) */}
        {/* Rating Badge — top-left, matches AudiobookCard pattern exactly */}
        {hasRating && (
          <div className="
            absolute top-2.5 left-2.5
            flex items-center gap-1 px-2 py-1
            rounded-lg bg-black/50 backdrop-blur-md
            text-white text-xs font-medium
            transition-opacity duration-300 group-hover:opacity-0
          ">
            <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span>{series.rating!.toFixed(1)}</span>
          </div>
        )}

        {/* Book count badge — top-right */}
        {series.bookCount > 0 && (
          <div className="
            absolute top-2.5 right-2.5
            px-2 py-1
            text-[11px] font-bold rounded-lg
            bg-black/50 backdrop-blur-md
            text-white
            transition-opacity duration-300 group-hover:opacity-0
          ">
            {series.bookCount} {series.bookCount === 1 ? 'Book' : 'Books'}
          </div>
        )}

        {/* Bottom gradient overlay — always present, deepens on hover */}
        <div className={`
          absolute inset-x-0 bottom-0
          transition-all duration-300
          ${hasTags
            ? 'h-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent group-hover:h-24 group-hover:from-black/85'
            : 'h-10 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100'
          }
        `} />

        {/* Tag pills — pinned to bottom of cover, inside gradient */}
        {hasTags && (
          <div className="
            absolute inset-x-0 bottom-0
            flex items-end gap-1.5 p-2.5
            pointer-events-none
          ">
            {visibleTags.map(tag => (
              <span
                key={tag}
                className="
                  inline-block px-2.5 py-0.5
                  text-[10px] font-medium
                  rounded-full
                  bg-black/30 backdrop-blur-md
                  text-white/90
                  ring-1 ring-white/15
                  transition-opacity duration-300
                "
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Below-cover: title only — fixed, predictable height across all cards */}
      <div className="mt-2.5 px-0.5">
        <h3 className="
          font-semibold text-[14px] leading-snug
          text-gray-900 dark:text-gray-100
          line-clamp-2
          group-hover:text-emerald-600 dark:group-hover:text-emerald-400
          transition-colors duration-200
        ">
          {series.title}
        </h3>
      </div>
    </Link>
  );
}
