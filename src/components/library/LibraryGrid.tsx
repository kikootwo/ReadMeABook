/**
 * Component: Library grid (cover grid, skeletons, author group headers)
 * Documentation: documentation/features/library-view.md
 *
 * With group=author a header goes wherever sortKey(item.author) changes: the same key the API
 * groups by, so an author split across pages gets one header.
 */

'use client';

import React from 'react';
import { SkeletonCard, getGridClasses } from '@/components/audiobooks/AudiobookGrid';
import { sortKey } from '@/lib/library-view/fold';
import type { LibraryGroupMode, LibraryItem } from '@/lib/library-view/types';
import { LibraryCard } from './LibraryCard';

interface LibraryGridProps {
  items: LibraryItem[];
  group: LibraryGroupMode;
  groups: Map<string, { label: string; count: number }>;
  cardSize: number;
  squareCovers: boolean;
  isLoading: boolean;
  onOpen: (item: LibraryItem) => void;
}

const GAPS = 'gap-5 sm:gap-6 lg:gap-8';

/** Consecutive runs of one author key. */
export function authorRuns(items: LibraryItem[]): { key: string; items: LibraryItem[] }[] {
  const runs: { key: string; items: LibraryItem[] }[] = [];
  for (const item of items) {
    const key = sortKey(item.author);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.items.push(item);
    else runs.push({ key, items: [item] });
  }
  return runs;
}

export function LibraryGrid({ items, group, groups, cardSize, squareCovers, isLoading, onOpen }: LibraryGridProps) {
  const gridClasses = `grid ${getGridClasses(cardSize)} ${GAPS}`;
  const showPill = cardSize >= 4;

  if (isLoading) {
    return (
      <div className={gridClasses} aria-busy="true" aria-label="Loading the library">
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonCard key={i} squareCovers={squareCovers} index={i} />
        ))}
      </div>
    );
  }

  const cards = (list: LibraryItem[]) =>
    list.map((item) => (
      <LibraryCard key={item.id} item={item} squareCovers={squareCovers} showPill={showPill} onOpen={onOpen} />
    ));

  if (group !== 'author') return <div className={gridClasses}>{cards(items)}</div>;

  return (
    <div className="space-y-8">
      {authorRuns(items).map((run, index) => {
        const meta = groups.get(run.key);
        const label = meta?.label ?? run.items[0].author;
        return (
          <section key={`${run.key}-${index}`} aria-label={label}>
            <h2 className="flex items-baseline gap-2 mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              <span className="truncate">{label}</span>
              {meta && (
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  · {meta.count} {meta.count === 1 ? 'book' : 'books'}
                </span>
              )}
            </h2>
            <div className={gridClasses}>{cards(run.items)}</div>
          </section>
        );
      })}
    </div>
  );
}
