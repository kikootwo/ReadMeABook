/**
 * Component: Author Detail Card
 * Documentation: documentation/frontend/components.md
 *
 * Hero section for the author detail page with circular portrait,
 * name, collapsible biography, and genre pills.
 */

'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { AuthorDetail } from '@/lib/hooks/useAuthors';
import { FollowAuthorButton } from './FollowAuthorButton';

interface AuthorDetailCardProps {
  author: AuthorDetail;
}

export function AuthorDetailCard({ author }: AuthorDetailCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasLongDescription = (author.description?.length || 0) > 300;

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
      {/* Circular Portrait */}
      <div className="flex-shrink-0">
        <div className="relative w-36 h-36 sm:w-44 sm:h-44 lg:w-52 lg:h-52 rounded-full overflow-hidden shadow-xl shadow-black/20 dark:shadow-black/40">
          {author.image ? (
            <Image
              src={author.image}
              alt={author.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 144px, (max-width: 1024px) 176px, 208px"
              priority
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900 dark:to-indigo-900 flex items-center justify-center">
              <svg className="w-1/3 h-1/3 text-blue-400 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Author Info */}
      <div className="flex-1 min-w-0 text-center sm:text-left">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100">
          {author.name}
        </h1>

        {/* Genre Pills */}
        {author.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center sm:justify-start gap-2">
            {author.genres.map(genre => (
              <span
                key={genre}
                className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300"
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        {/* Audible Link + Follow Button */}
        <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-3">
          {author.audibleUrl && (
            <a
              href={author.audibleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              View on Audible
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          <FollowAuthorButton
            asin={author.asin}
            name={author.name}
            image={author.image}
          />
        </div>

        {/* Description */}
        {author.description && (
          <div className="mt-4">
            <p
              className={`text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line ${
                !expanded && hasLongDescription ? 'line-clamp-4' : ''
              }`}
            >
              {author.description}
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

export function AuthorDetailSkeleton() {
  return (
    <div className="animate-pulse flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
      {/* Portrait skeleton */}
      <div className="flex-shrink-0">
        <div className="w-36 h-36 sm:w-44 sm:h-44 lg:w-52 lg:h-52 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800">
          <div className="w-full h-full rounded-full relative overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
        </div>
      </div>

      {/* Info skeleton */}
      <div className="flex-1 min-w-0 text-center sm:text-left space-y-4">
        <div className="h-9 bg-gray-200 dark:bg-gray-700 rounded-lg w-64 mx-auto sm:mx-0" />
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
