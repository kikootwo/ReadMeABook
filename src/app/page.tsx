/**
 * Component: Homepage - Audiobook Discovery
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useState, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { AudiobookGrid } from '@/components/audiobooks/AudiobookGrid';
import { useAudiobooks } from '@/lib/hooks/useAudiobooks';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { StickyPagination } from '@/components/ui/StickyPagination';

export default function HomePage() {
  const [popularPage, setPopularPage] = useState(1);
  const [newReleasesPage, setNewReleasesPage] = useState(1);

  // Refs for auto-scrolling to section tops
  const popularSectionRef = useRef<HTMLElement>(null);
  const newReleasesSectionRef = useRef<HTMLElement>(null);

  const {
    audiobooks: popular,
    isLoading: loadingPopular,
    totalPages: popularTotalPages,
    message: popularMessage,
  } = useAudiobooks('popular', 20, popularPage);

  const {
    audiobooks: newReleases,
    isLoading: loadingNewReleases,
    totalPages: newReleasesTotalPages,
    message: newReleasesMessage,
  } = useAudiobooks('new-releases', 20, newReleasesPage);

  // Handle page changes with auto-scroll to section top
  const handlePopularPageChange = (page: number) => {
    setPopularPage(page);
    popularSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleNewReleasesPageChange = (page: number) => {
    setNewReleasesPage(page);
    newReleasesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen">
        <Header />

      <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl space-y-8 sm:space-y-12">
        {/* Popular Audiobooks Section */}
        <section ref={popularSectionRef} className="relative">
          {/* Sticky Section Header */}
          <div className="sticky top-14 sm:top-16 z-30 mb-4 sm:mb-6">
            <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
                <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
                  Popular Audiobooks
                </h2>
              </div>
            </div>
          </div>

          {/* Section Content */}
          <div className="bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-2xl p-4 sm:p-6 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
            {popularMessage && !loadingPopular && popular.length === 0 ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 text-center">
                <p className="text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
                  No popular audiobooks found
                </p>
                <p className="text-yellow-700 dark:text-yellow-300 text-sm">
                  {popularMessage}
                </p>
              </div>
            ) : (
              <AudiobookGrid
                audiobooks={popular}
                isLoading={loadingPopular}
                emptyMessage="No popular audiobooks available"
              />
            )}
          </div>
        </section>

        {/* New Releases Section */}
        <section ref={newReleasesSectionRef} className="relative">
          {/* Sticky Section Header */}
          <div className="sticky top-14 sm:top-16 z-30 mb-4 sm:mb-6">
            <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full" />
                <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
                  New Releases
                </h2>
              </div>
            </div>
          </div>

          {/* Section Content */}
          <div className="bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-2xl p-4 sm:p-6 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
            {newReleasesMessage && !loadingNewReleases && newReleases.length === 0 ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 text-center">
                <p className="text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
                  No new releases found
                </p>
                <p className="text-yellow-700 dark:text-yellow-300 text-sm">
                  {newReleasesMessage}
                </p>
              </div>
            ) : (
              <AudiobookGrid
                audiobooks={newReleases}
                isLoading={loadingNewReleases}
                emptyMessage="No new releases available"
              />
            )}
          </div>
        </section>

        {/* Call to Action */}
        <section className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl p-6 sm:p-8 text-center border border-blue-200/50 dark:border-blue-800/50 shadow-sm">
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Can't find what you're looking for?
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Use our search to find any audiobook from Audible
          </p>
          <a
            href="/search"
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg"
          >
            Search Audiobooks
          </a>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-16">
        <div className="container mx-auto px-4 py-6 max-w-7xl">
          <div className="text-center text-sm text-gray-600 dark:text-gray-400">
            <p>ReadMeABook - Audiobook Library Management System</p>
            <p className="mt-1">
              Powered by{' '}
              <a
                href="https://www.plex.tv"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Plex
              </a>
              {' '}&{' '}
              <a
                href="https://www.audible.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Audible
              </a>
            </p>
          </div>
        </div>
      </footer>

      {/* Sticky Pagination Controls */}
      <StickyPagination
        currentPage={popularPage}
        totalPages={popularTotalPages}
        onPageChange={handlePopularPageChange}
        sectionRef={popularSectionRef}
        label="Popular Audiobooks"
      />
      <StickyPagination
        currentPage={newReleasesPage}
        totalPages={newReleasesTotalPages}
        onPageChange={handleNewReleasesPageChange}
        sectionRef={newReleasesSectionRef}
        label="New Releases"
      />
      </div>
    </ProtectedRoute>
  );
}
