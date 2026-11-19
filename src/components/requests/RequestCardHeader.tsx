/**
 * Component: Request Card Header
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { creditLine } from '@/lib/utils/credits';

interface RequestCardHeaderProps {
  book: {
    title: string;
    author: string;
    narrator?: string | null;
    year?: number | null;
    series?: string | null;
    seriesPart?: string | null;
    description?: string | null;
  };
  /** Status and Ebook pills, in the top-right corner at every width */
  badges: React.ReactNode;
  /** Release date or progress text, on its own line under the details */
  note?: React.ReactNode;
}

/**
 * The details line: narrators with the year (the book's Audible release, on audiobook and ebook
 * requests alike), then the series with its book number. Parts the book lacks are left out.
 */
export function requestBookDetails(book: RequestCardHeaderProps['book']): { text: string; full: string } {
  const narrators = creditLine(book.narrator);
  const year = book.year ? String(book.year) : null;
  const series = book.series?.trim() ? `${book.series.trim()}${book.seriesPart ? `, Book ${book.seriesPart}` : ''}` : null;
  const line = (names?: string) => [names ? `Narrated by ${names}` : null, year, series].filter(Boolean).join(' · ');
  // The card shows the first narrators; the hover text names every one, with roles
  return { text: line(narrators.summary), full: line(narrators.full) };
}

export function RequestCardHeader({ book, badges, note }: RequestCardHeaderProps) {
  const authors = creditLine(book.author);
  const details = requestBookDetails(book);
  const description = book.description?.replace(/\s+/g, ' ').trim();

  return (
    // The title shares its row with the pills (their column takes what they need, the title the rest);
    // everything under it spans the full width. Under the title, three steps of emphasis: authors,
    // then narrators/year/series, then the dimmest, the description
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
      <h3
        title={book.title}
        className="text-sm sm:text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100 line-clamp-2"
      >
        {book.title}
      </h3>

      <div data-testid="request-card-badges" className="flex items-center justify-end gap-1.5 pt-0.5">
        {badges}
      </div>

      <p
        data-testid="request-book-authors"
        title={authors.full}
        className="col-span-2 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-200 truncate"
      >
        By {authors.summary || book.author}
      </p>

      {details.text && (
        <p
          data-testid="request-book-details"
          title={details.full}
          className="col-span-2 text-xs sm:text-sm text-gray-600 dark:text-gray-300 truncate sm:whitespace-normal"
        >
          {details.text}
        </p>
      )}

      {note && <div className="col-span-2 flex items-center gap-2 flex-wrap">{note}</div>}

      {description && (
        // Sized so the text stays within the cover's height: phones skip it, a card with a note line gets
        // 2 lines (3 from md otherwise). The details window has the whole summary.
        <p
          data-testid="request-book-description"
          className={cn(
            'hidden col-span-2 sm:line-clamp-2 text-sm text-gray-500 dark:text-gray-400',
            !note && 'md:line-clamp-3'
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
