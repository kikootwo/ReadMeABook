/**
 * Component: Library card (one button per book: cover, status pill and bar, title, author, meta)
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React from 'react';
import { BookCover } from '@/components/audiobooks/BookCover';
import type { LibraryItem } from '@/lib/library-view/types';
import { TONE_TEXT, cardAriaLabel, cardMeta, cardPill, coverTone, showsProgress } from './card-display';

interface LibraryCardProps {
  item: LibraryItem;
  squareCovers: boolean;
  /** False at the smallest card sizes, where the pill text would clip (the dot stays). */
  showPill: boolean;
  onOpen: (item: LibraryItem) => void;
}

export function LibraryCard({ item, squareCovers, showPill, onOpen }: LibraryCardProps) {
  const tone = coverTone(item);
  const pill = showPill ? cardPill(item) : null;
  const inLibrary = item.inLibrary || item.status === 'available';
  const progress = Math.max(0, Math.min(100, Math.round(item.progress ?? 0)));

  // self-start: a button stretched to its grid row centres its content, which pushed covers down
  // beside a card with a two-line title

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={cardAriaLabel(item)}
      data-library-card={item.id}
      className="group block self-start w-full text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 rounded-2xl"
    >
      <div className="relative">
        <BookCover coverUrl={item.coverUrl} squareCovers={squareCovers} tone={tone} dotHidesOnHover={false}>
          {pill && (
            <span className="absolute left-2 bottom-3 max-w-[calc(100%-1rem)] truncate px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-white text-[11px] font-medium">
              {pill}
            </span>
          )}
          {showsProgress(item) && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30" aria-hidden="true">
              <div className="h-full bg-amber-400 transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}
        </BookCover>
      </div>

      <div className="mt-3 px-1">
        <h3 className="font-semibold text-[15px] leading-snug text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200">
          {item.title}
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">{item.author}</p>
        <p
          className={`mt-0.5 text-xs truncate ${
            inLibrary || !tone ? 'text-gray-500 dark:text-gray-400' : TONE_TEXT[tone]
          }`}
        >
          {cardMeta(item) || ' '}
        </p>
      </div>
    </button>
  );
}
