/**
 * Component: Author Card
 * Documentation: documentation/frontend/components.md
 *
 * Premium circular portrait design - distinguishes authors from audiobook covers.
 * Hover effects and typography match the AudiobookCard aesthetic.
 * Clicking navigates to the author's detail page.
 */

'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Author } from '@/lib/hooks/useAuthors';
import { FollowAuthorButton } from './FollowAuthorButton';

interface AuthorCardProps {
  author: Author;
}

export function AuthorCard({ author }: AuthorCardProps) {
  return (
    <Link
      href={`/authors/${author.asin}`}
      className="group outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-2xl"
      aria-label={`View details for ${author.name}`}
    >
      {/* Circular Portrait Container */}
      <div className="flex justify-center relative">
        {/* Follow button overlay */}
        <div className="absolute top-0 right-0 z-10">
          <FollowAuthorButton
            asin={author.asin}
            name={author.name}
            image={author.image}
            compact
          />
        </div>
        <div
          className="
            relative overflow-hidden rounded-full
            w-full aspect-square
            shadow-lg shadow-black/20 dark:shadow-black/40
            group-hover:shadow-xl group-hover:shadow-black/25 dark:group-hover:shadow-black/50
            transform group-hover:scale-[1.04] group-hover:-translate-y-1
            transition-all duration-300 ease-out
          "
        >
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

          {/* Subtle hover overlay */}
          <div className="
            absolute inset-0 rounded-full
            bg-black/0 group-hover:bg-black/10
            transition-colors duration-300
          " />
        </div>
      </div>

      {/* Author Info */}
      <div className="mt-3 px-1 text-center">
        <h3 className="font-semibold text-[15px] leading-snug text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200">
          {author.name}
        </h3>

        {/* Genre Pills */}
        {author.genres.length > 0 && (
          <div className="mt-1.5 flex flex-wrap justify-center gap-1">
            {author.genres.map(genre => (
              <span
                key={genre}
                className="inline-block px-2 py-0.5 text-[11px] font-medium rounded-full bg-gray-100 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
