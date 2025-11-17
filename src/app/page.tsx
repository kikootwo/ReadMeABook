/**
 * Component: Homepage - Audiobook Discovery
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { AudiobookGrid } from '@/components/audiobooks/AudiobookGrid';
import { useAudiobooks } from '@/lib/hooks/useAudiobooks';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Pagination } from '@/components/ui/Pagination';

export default function HomePage() {
  const [popularPage, setPopularPage] = useState(1);
  const [newReleasesPage, setNewReleasesPage] = useState(1);

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

  return (
    <ProtectedRoute>
      <div className="min-h-screen">
        <Header />

      <main className="container mx-auto px-4 py-8 max-w-7xl space-y-12">
        {/* Popular Audiobooks */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
              Popular Audiobooks
            </h2>
          </div>

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
            <>
              <AudiobookGrid
                audiobooks={popular}
                isLoading={loadingPopular}
                emptyMessage="No popular audiobooks available"
              />

              <Pagination
                currentPage={popularPage}
                totalPages={popularTotalPages}
                onPageChange={setPopularPage}
                className="mt-8"
              />
            </>
          )}
        </section>

        {/* New Releases */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
              New Releases
            </h2>
          </div>

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
            <>
              <AudiobookGrid
                audiobooks={newReleases}
                isLoading={loadingNewReleases}
                emptyMessage="No new releases available"
              />

              <Pagination
                currentPage={newReleasesPage}
                totalPages={newReleasesTotalPages}
                onPageChange={setNewReleasesPage}
                className="mt-8"
              />
            </>
          )}
        </section>

        {/* Call to Action */}
        <section className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-8 text-center">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Can't find what you're looking for?
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Use our search to find any audiobook from Audible
          </p>
          <a
            href="/search"
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
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
      </div>
    </ProtectedRoute>
  );
}
