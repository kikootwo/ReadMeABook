/**
 * Component: Book Cover (shared cover art: aspect, image or placeholder, status ring and dot)
 * Documentation: documentation/frontend/components.md
 *
 * Used by AudiobookCard (Home, Search) and LibraryCard. Must sit inside a `group` element: the hover
 * lift and the dot fade key off it.
 */

'use client';

import React, { useState } from 'react';
import Image from 'next/image';

export type CoverTone = 'emerald' | 'amber' | 'blue' | 'red';

interface BookCoverProps {
  coverUrl?: string | null;
  squareCovers?: boolean;
  /** Ring (emerald/amber only) and dot colour; amber pulses. None: no ring, no dot. */
  tone?: CoverTone | null;
  /** The dot fades on hover (true where a hover overlay replaces it). */
  dotHidesOnHover?: boolean;
  /** Rendered before the dot (a hover overlay). */
  overlay?: React.ReactNode;
  /** Rendered after the dot (badges). */
  children?: React.ReactNode;
}

const PLACEHOLDER_COVER = '/placeholder_cover.svg';
const SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw';

export function BookCover({
  coverUrl,
  squareCovers = false,
  tone = null,
  dotHidesOnHover = true,
  overlay,
  children,
}: BookCoverProps) {
  const [coverError, setCoverError] = useState(false);

  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl
        shadow-lg shadow-black/20 dark:shadow-black/40
        group-hover:shadow-xl group-hover:shadow-black/25 dark:group-hover:shadow-black/50
        transform group-hover:scale-[1.02] group-hover:-translate-y-1
        transition-all duration-300 ease-out
        ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'}
        ${tone === 'emerald' ? 'ring-2 ring-emerald-400/60 dark:ring-emerald-500/50' : ''}
        ${tone === 'amber' ? 'ring-2 ring-amber-400/60 dark:ring-amber-500/50' : ''}
      `}
    >
      {coverUrl && !coverError ? (
        <Image
          src={coverUrl}
          alt=""
          fill
          className="object-cover"
          sizes={SIZES}
          onError={() => setCoverError(true)}
        />
      ) : (
        <Image src={PLACEHOLDER_COVER} alt="" fill className="object-cover" sizes={SIZES} />
      )}

      {overlay}

      {tone && (
        <div className={`
          absolute top-3 right-3 w-3 h-3 rounded-full
          shadow-lg transition-opacity duration-300 ${dotHidesOnHover ? 'group-hover:opacity-0' : ''}
          ${tone === 'emerald' ? 'bg-emerald-400' : ''}
          ${tone === 'amber' ? 'bg-amber-400 animate-pulse' : ''}
          ${tone === 'blue' ? 'bg-blue-400' : ''}
          ${tone === 'red' ? 'bg-red-400' : ''}
        `} />
      )}

      {children}
    </div>
  );
}
