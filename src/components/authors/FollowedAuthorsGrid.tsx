/**
 * Component: Followed Authors Grid
 * Documentation: documentation/features/followed-authors.md
 *
 * Displays the user's followed authors in a responsive grid.
 * Each card links to the author detail page where books can be browsed.
 */

'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FollowedAuthor, useFollowActions } from '@/lib/hooks/useAuthors';

interface FollowedAuthorsGridProps {
  authors: FollowedAuthor[];
  isLoading: boolean;
}

function FollowedAuthorCard({ author }: { author: FollowedAuthor }) {
  const { unfollow, isLoading } = useFollowActions();

  const handleUnfollow = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoading) {
      await unfollow(author.asin);
    }
  };

  return (
    <div className="group relative">
      <Link
        href={`/authors/${author.asin}`}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-2xl"
        aria-label={`View books by ${author.name}`}
      >
        {/* Circular Portrait */}
        <div className="flex justify-center">
          <div className="relative overflow-hidden rounded-full w-full aspect-square shadow-lg shadow-black/20 dark:shadow-black/40 group-hover:shadow-xl group-hover:shadow-black/25 dark:group-hover:shadow-black/50 transform group-hover:scale-[1.04] group-hover:-translate-y-1 transition-all duration-300 ease-out">
            {author.image ? (
              <Image
                src={author.image}
                alt=""
                fill
                className="object-cover"
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900 dark:to-indigo-900 flex items-center justify-center">
                <svg className="w-1/3 h-1/3 text-blue-400 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
            )}

            {/* Hover overlay */}
            <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
          </div>
        </div>

        {/* Author Name */}
        <div className="mt-3 px-1 text-center">
          <h3 className="font-semibold text-[15px] leading-snug text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200">
            {author.name}
          </h3>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            Followed {new Date(author.createdAt).toLocaleDateString()}
          </p>
        </div>
      </Link>

      {/* Unfollow button (top-right) */}
      <button
        onClick={handleUnfollow}
        disabled={isLoading}
        className="absolute top-0 right-0 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/40 text-red-500 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/60 transition-all duration-200 opacity-0 group-hover:opacity-100 disabled:opacity-50"
        aria-label={`Unfollow ${author.name}`}
        title={`Unfollow ${author.name}`}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
        </svg>
      </button>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="flex justify-center">
        <div className="w-full aspect-square rounded-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800" />
      </div>
      <div className="mt-3 px-1 text-center space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mx-auto" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mx-auto" />
      </div>
    </div>
  );
}

export function FollowedAuthorsGrid({ authors, isLoading }: FollowedAuthorsGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 sm:gap-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (authors.length === 0) {
    return (
      <div className="text-center py-16 space-y-4">
        <svg
          className="mx-auto h-16 w-16 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
          />
        </svg>
        <p className="text-xl text-gray-600 dark:text-gray-400">
          No followed authors yet
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500">
          Search for authors and click the heart to follow them.
          <br />
          You&apos;ll see their books and can request new ones here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 sm:gap-8">
      {authors.map((author) => (
        <FollowedAuthorCard key={author.id} author={author} />
      ))}
    </div>
  );
}
