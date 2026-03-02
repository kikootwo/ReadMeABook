/**
 * Component: Author Detail Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { use, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { AudiobookGrid } from '@/components/audiobooks/AudiobookGrid';
import { LoadMoreBar } from '@/components/ui/LoadMoreBar';
import { AuthorDetailCard, AuthorDetailSkeleton } from '@/components/authors/AuthorDetailCard';
import { SimilarAuthorsRow, SimilarAuthorsSkeleton } from '@/components/authors/SimilarAuthorsRow';
import { useAuthorDetail, useAuthorBooks } from '@/lib/hooks/useAuthors';
import { Audiobook } from '@/lib/hooks/useAudiobooks';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { SectionToolbar } from '@/components/ui/SectionToolbar';
import { usePreferences } from '@/contexts/PreferencesContext';

export default function AuthorDetailPage({
  params,
}: {
  params: Promise<{ asin: string }>;
}) {
  const { asin } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromAuthorName = searchParams.get('from');
  const { author, isLoading: authorLoading } = useAuthorDetail(asin);
  const { books, totalBooks, hasMore, isLoading: booksLoading, isLoadingMore, loadMore } = useAuthorBooks(
    asin,
    author?.name || null
  );
  const { cardSize, setCardSize, squareCovers, setSquareCovers, hideAvailable, setHideAvailable } = usePreferences();

  const handleBack = useCallback(() => {
    // Use browser back if we came from within the app, otherwise fallback to /authors
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/authors');
    }
  }, [router]);

  // Filter out available titles when hideAvailable is enabled
  const filteredBooks = useMemo(
    () => hideAvailable ? books.filter((b: Audiobook) => !b.isAvailable && b.requestStatus !== 'completed') : books,
    [books, hideAvailable]
  );

  // Header count text: reflects filtered counts
  const visibleCount = filteredBooks.length;
  const booksCountText = hasMore && totalBooks > books.length
    ? `${visibleCount.toLocaleString()} of ${totalBooks.toLocaleString()} title${totalBooks !== 1 ? 's' : ''}`
    : visibleCount > 0
      ? `${visibleCount.toLocaleString()} title${visibleCount !== 1 ? 's' : ''}`
      : '';

  return (
    <ProtectedRoute>
      <div className="min-h-screen">
        <Header />

        <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl space-y-8">
          {/* Back navigation */}
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {fromAuthorName ? `Back to ${fromAuthorName}` : 'Back to Authors'}
          </button>

          {/* Author Detail Card */}
          {authorLoading ? (
            <AuthorDetailSkeleton />
          ) : author ? (
            <AuthorDetailCard author={author} />
          ) : (
            <div className="text-center py-16 space-y-4">
              <svg className="mx-auto h-16 w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-xl text-gray-600 dark:text-gray-400">Author not found</p>
            </div>
          )}

          {/* Similar Authors */}
          {authorLoading ? (
            <SimilarAuthorsSkeleton />
          ) : author && author.similar.length > 0 ? (
            <SimilarAuthorsRow authors={author.similar} currentAuthorName={author.name} />
          ) : null}

          {/* Books Section */}
          {author && (
            <div className="space-y-6">
              {/* Sticky Books Header */}
              <div className="sticky top-14 sm:top-16 z-30">
                <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                      Books
                    </h2>
                    {!booksLoading && booksCountText && (
                      <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:inline whitespace-nowrap">
                        ({booksCountText})
                      </span>
                    )}
                    <SectionToolbar
                      hideAvailable={hideAvailable}
                      onToggleHideAvailable={setHideAvailable}
                      squareCovers={squareCovers}
                      onToggleSquareCovers={setSquareCovers}
                      cardSize={cardSize}
                      onCardSizeChange={setCardSize}
                    />
                  </div>
                </div>
              </div>

              {/* Books Grid */}
              <AudiobookGrid
                audiobooks={filteredBooks}
                isLoading={booksLoading}
                emptyMessage={`No books found for ${author.name}`}
                cardSize={cardSize}
                squareCovers={squareCovers}
              />

              {/* Load More Bar */}
              {filteredBooks.length > 0 && (
                <LoadMoreBar
                  loadedCount={filteredBooks.length}
                  totalCount={totalBooks > 0 ? totalBooks : undefined}
                  hasMore={hasMore}
                  isLoading={isLoadingMore}
                  onLoadMore={loadMore}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}
