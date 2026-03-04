/**
 * Component: Combined Shelves Section (Profile Page)
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useState } from 'react';
import { useShelves, GenericShelf } from '@/lib/hooks/useShelves';
import { useDeleteGoodreadsShelf } from '@/lib/hooks/useGoodreadsShelves';
import { useDeleteHardcoverShelf } from '@/lib/hooks/useHardcoverShelves';
import { AddShelfModal } from '@/components/ui/AddShelfModal';
import { AudiobookDetailsModal } from '@/components/audiobooks/AudiobookDetailsModal';
import { usePreferences } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/utils/cn';
import { Modal } from '@/components/ui/Modal';
import { ManageShelfModal } from '@/components/ui/ManageShelfModal';
import { ShelfBook } from '@/lib/hooks/useGoodreadsShelves';

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function ShelvesSection() {
  const { shelves, isLoading } = useShelves();
  const { deleteShelf: deleteGoodreads, isLoading: isDeletingGoodreads } =
    useDeleteGoodreadsShelf();
  const { deleteShelf: deleteHardcover, isLoading: isDeletingHardcover } =
    useDeleteHardcoverShelf();
  const { squareCovers } = usePreferences();

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAddShelf, setShowAddShelf] = useState(false);
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [manageShelf, setManageShelf] = useState<GenericShelf | null>(null);

  const handleDelete = async (shelf: GenericShelf) => {
    try {
      if (shelf.type === 'goodreads') {
        await deleteGoodreads(shelf.id);
      } else {
        await deleteHardcover(shelf.id);
      }
      setConfirmDeleteId(null);
    } catch {
      // Error handled by hook
    }
  };

  const isDeleting = isDeletingGoodreads || isDeletingHardcover;

  return (
    <section>
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-500/10 dark:to-teal-500/10 flex items-center justify-center ring-1 ring-emerald-200/50 dark:ring-emerald-500/10">
            <svg
              className="w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">
              Shelves
            </h2>
            {!isLoading && shelves.length > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {shelves.length} {shelves.length === 1 ? 'shelf' : 'shelves'}{' '}
                connected
              </p>
            )}
          </div>
        </div>

        {shelves.length > 0 && (
          <button
            onClick={() => setShowAddShelf(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/70 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 shadow-sm"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            Add Shelf
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <ShelfCardSkeleton squareCovers={squareCovers} />
      ) : shelves.length > 0 ? (
        <div className="space-y-4">
          {shelves.map((shelf) => (
            <ShelfCard
              key={shelf.id}
              shelf={shelf}
              squareCovers={squareCovers}
              isDeleting={isDeleting && confirmDeleteId === shelf.id}
              isConfirmingDelete={confirmDeleteId === shelf.id}
              onDelete={() => handleDelete(shelf)}
              onConfirmDelete={() => setConfirmDeleteId(shelf.id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onManage={() => setManageShelf(shelf)}
              onBookClick={(asin) => setSelectedAsin(asin)}
            />
          ))}
        </div>
      ) : (
        <EmptyState onAdd={() => setShowAddShelf(true)} />
      )}

      {/* Modals */}
      <AddShelfModal
        isOpen={showAddShelf}
        onClose={() => setShowAddShelf(false)}
      />

      <ManageShelfModal
        isOpen={!!manageShelf}
        onClose={() => setManageShelf(null)}
        shelf={manageShelf}
      />

      {selectedAsin && (
        <AudiobookDetailsModal
          asin={selectedAsin}
          isOpen={true}
          onClose={() => setSelectedAsin(null)}
          hideRequestActions
        />
      )}
    </section>
  );
}

/* ─── Empty State ─── */

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700/40 p-10 sm:p-14 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-500/10 dark:to-teal-500/10 flex items-center justify-center mb-5 ring-1 ring-emerald-200/50 dark:ring-emerald-500/10">
        <svg
          className="w-7 h-7 text-emerald-500 dark:text-emerald-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
          />
        </svg>
      </div>

      <h3 className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
        Connect your reading list
      </h3>
      <p className="text-sm text-gray-400 dark:text-gray-500 max-w-xs mx-auto mb-7 leading-relaxed">
        Link a Goodreads or Hardcover shelf and we'll automatically request the
        audiobook for every book you add.
      </p>

      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        Add Your First Shelf
      </button>
    </div>
  );
}

/* ─── Loading Skeleton ─── */

function ShelfCardSkeleton({ squareCovers }: { squareCovers: boolean }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/30 p-6 sm:p-7">
      <div className="mb-5">
        <div className="h-[18px] w-52 bg-gray-100 dark:bg-gray-700/50 rounded-lg animate-pulse mb-2.5" />
        <div className="flex items-center gap-2">
          <div className="h-[22px] w-16 bg-gray-100 dark:bg-gray-700/50 rounded-md animate-pulse" />
          <div className="h-3.5 w-24 bg-gray-100 dark:bg-gray-700/50 rounded-md animate-pulse" />
        </div>
      </div>
      <div className="flex items-end">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className={cn(
              'rounded-xl bg-gray-100 dark:bg-gray-700/40 animate-pulse flex-shrink-0 ring-2 ring-white dark:ring-gray-800',
              squareCovers ? 'w-[80px] h-[80px]' : 'w-[72px] h-[108px]',
            )}
            style={{ marginLeft: i > 0 ? '-16px' : 0, zIndex: 5 - i }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Shelf Card ─── */

interface ShelfCardProps {
  shelf: GenericShelf;
  squareCovers: boolean;
  isDeleting: boolean;
  isConfirmingDelete: boolean;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onManage: () => void;
  onBookClick: (asin: string) => void;
}

function ShelfCard({
  shelf,
  squareCovers,
  isDeleting,
  isConfirmingDelete,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onManage,
  onBookClick,
}: ShelfCardProps) {
  const displayBooks = shelf.books.slice(0, 6);
  const hasCovers = displayBooks.length > 0;
  const remainingCount = Math.max(
    0,
    (shelf.bookCount || 0) - displayBooks.length,
  );
  const isSyncing = !shelf.lastSyncAt;

  const providerIcon =
    shelf.type === 'goodreads' ? (
      <img
        src="/goodreads-icon.png"
        alt="Goodreads"
        className="w-5 h-5 ml-2 object-contain"
      />
    ) : (
      <img
        src="/hardcover-icon.svg"
        alt="Hardcover"
        className="w-5 h-5 ml-2 object-contain"
      />
    );

  return (
    <div className="group rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/30 p-6 sm:p-7 transition-all duration-300 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/20 hover:border-gray-200 dark:hover:border-gray-600/40">
      {/* Top: Shelf info + actions */}
      <div
        className={cn(
          'flex items-start justify-between',
          (hasCovers || isSyncing) && 'mb-5',
        )}
      >
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white truncate leading-snug flex items-center">
            {shelf.name} {providerIcon}
          </h3>
          <div className="flex items-center gap-2 mt-2">
            {shelf.bookCount != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 tabular-nums">
                {shelf.bookCount} {shelf.bookCount === 1 ? 'book' : 'books'}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              {isSyncing ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                  </span>
                  Syncing&hellip;
                </>
              ) : shelf.lastSyncAt ? (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Synced {formatRelativeTime(shelf.lastSyncAt)}
                </>
              ) : (
                'Pending sync'
              )}
            </span>
          </div>
        </div>

        {/* Delete action */}
        <div className="flex-shrink-0 ml-4">
          {isConfirmingDelete ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onDelete}
                disabled={isDeleting}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Removing\u2026' : 'Remove'}
              </button>
              <button
                onClick={onCancelDelete}
                disabled={isDeleting}
                className="px-2 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={onManage}
                className="p-2 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-all duration-200 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-500/10 opacity-40 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-blue-500/40 outline-none"
                title="Manage shelf"
                aria-label="Manage shelf"
              >
                <svg
                  className="w-[18px] h-[18px]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                  />
                </svg>
              </button>
              <button
                onClick={onConfirmDelete}
                className="p-2 text-gray-400 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-all duration-200 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 opacity-40 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-500/40 outline-none"
                title="Remove shelf"
                aria-label="Remove shelf"
              >
                <svg
                  className="w-[18px] h-[18px]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Stacked book covers */}
      {hasCovers ? (
        <CoverStack
          books={displayBooks}
          remainingCount={remainingCount}
          squareCovers={squareCovers}
          onBookClick={onBookClick}
        />
      ) : isSyncing ? (
        <div className="flex items-end">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className={cn(
                'rounded-xl bg-gray-50 dark:bg-gray-700/30 animate-pulse flex-shrink-0 ring-2 ring-white dark:ring-gray-800',
                squareCovers ? 'w-[80px] h-[80px]' : 'w-[72px] h-[108px]',
              )}
              style={{ marginLeft: i > 0 ? '-16px' : 0, zIndex: 3 - i }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Stacked Cover Display ─── */

function CoverStack({
  books,
  remainingCount,
  squareCovers,
  onBookClick,
}: {
  books: ShelfBook[];
  remainingCount: number;
  squareCovers: boolean;
  onBookClick: (asin: string) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const coverSize = squareCovers
    ? 'w-[80px] aspect-square'
    : 'w-[72px] aspect-[2/3]';

  return (
    <div className="flex items-end">
      {books.map((book, i) => (
        <div
          key={i}
          className={cn(
            'relative rounded-xl overflow-hidden shadow-md flex-shrink-0',
            'ring-2 ring-white dark:ring-gray-800',
            'transition-all duration-300 ease-out',
            hoveredIndex === i && 'scale-[1.18] shadow-xl',
            coverSize,
            book.asin ? 'cursor-pointer' : 'cursor-default',
          )}
          style={{
            marginLeft: i > 0 ? '-16px' : 0,
            zIndex: hoveredIndex === i ? 50 : books.length - i,
          }}
          onMouseEnter={() => setHoveredIndex(i)}
          onMouseLeave={() => setHoveredIndex(null)}
          onClick={() => book.asin && onBookClick(book.asin)}
          title={
            book.asin
              ? `${book.title}${book.author ? ` by ${book.author}` : ''}`
              : undefined
          }
        >
          <img
            src={book.coverUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            draggable={false}
          />
        </div>
      ))}
      {remainingCount > 0 && (
        <div
          className={cn(
            'rounded-xl flex items-center justify-center bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700/40 flex-shrink-0 ring-2 ring-white dark:ring-gray-800',
            coverSize,
          )}
          style={{ marginLeft: '-16px', zIndex: 0 }}
        >
          <span className="text-sm font-semibold text-gray-400 dark:text-gray-500 tabular-nums">
            +{remainingCount}
          </span>
        </div>
      )}
    </div>
  );
}
