/**
 * Component: User Profile Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useMemo } from 'react';
import { Header } from '@/components/layout/Header';
import { RequestCard } from '@/components/requests/RequestCard';
import { useAuth } from '@/contexts/AuthContext';
import { useRequests } from '@/lib/hooks/useRequests';
import { cn } from '@/lib/utils/cn';
import { ShelvesSection } from '@/components/profile/ShelvesSection';
import { ApiTokensSection } from '@/components/profile/ApiTokensSection';
import { WatchedSeriesSection, WatchedAuthorsSection } from '@/components/profile/WatchedListsSection';

const statConfig = [
  { key: 'total', label: 'Total', color: 'text-gray-900 dark:text-white' },
  { key: 'active', label: 'Active', color: 'text-blue-500' },
  { key: 'waiting', label: 'Waiting', color: 'text-amber-500' },
  { key: 'completed', label: 'Complete', color: 'text-emerald-500' },
  { key: 'failed', label: 'Failed', color: 'text-red-500' },
  { key: 'cancelled', label: 'Cancelled', color: 'text-gray-400 dark:text-gray-500' },
] as const;

type StatKey = (typeof statConfig)[number]['key'];

export default function ProfilePage() {
  const { user } = useAuth();
  const { requests, isLoading } = useRequests(undefined, 50, true);

  const stats = useMemo(() => {
    if (!requests.length) {
      return { total: 0, completed: 0, active: 0, waiting: 0, failed: 0, cancelled: 0 };
    }
    return {
      total: requests.length,
      completed: requests.filter((r: any) => ['available', 'downloaded'].includes(r.status)).length,
      active: requests.filter((r: any) => ['pending', 'searching', 'downloading', 'processing'].includes(r.status)).length,
      waiting: requests.filter((r: any) => ['awaiting_search', 'awaiting_import'].includes(r.status)).length,
      failed: requests.filter((r: any) => r.status === 'failed').length,
      cancelled: requests.filter((r: any) => r.status === 'cancelled').length,
    };
  }, [requests]);

  const activeDownloads = useMemo(() => {
    return requests.filter((r: any) => ['downloading', 'processing'].includes(r.status));
  }, [requests]);

  const recentRequests = useMemo(() => {
    return [...requests]
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [requests]);

  if (!user) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="container mx-auto px-4 py-20 max-w-5xl text-center">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Sign in required
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Please log in to view your profile
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-5xl space-y-10">
        {/* Profile Card — gradient banner + avatar + info + stats */}
        <section className="rounded-2xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 shadow-sm">
          {/* Gradient Banner */}
          <div className="h-32 sm:h-40 bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-600" />

          {/* Profile Content — overlapping the banner */}
          <div className="px-6 sm:px-8 pb-8 -mt-14 sm:-mt-16">
            {/* Avatar */}
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="w-28 h-28 rounded-full ring-4 ring-white dark:ring-gray-800 shadow-lg object-cover mb-5"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-4xl font-bold ring-4 ring-white dark:ring-gray-800 shadow-lg mb-5">
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Name + Email + Badge */}
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {user.username}
            </h1>
            {user.email && (
              <p className="text-base text-gray-500 dark:text-gray-400 mt-1">
                {user.email}
              </p>
            )}
            <div className="mt-3">
              <span
                className={cn(
                  'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide',
                  user.role === 'admin'
                    ? 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400'
                )}
              >
                {user.role === 'admin' ? 'Administrator' : 'User'}
              </span>
            </div>
          </div>

          {/* Stats Strip */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-gray-100 dark:bg-gray-700/30">
            {statConfig.map((stat) => (
              <div
                key={stat.key}
                className="py-5 sm:py-6 px-3 text-center bg-white dark:bg-gray-800"
              >
                <div className={cn('text-2xl sm:text-3xl font-bold tabular-nums', stat.color)}>
                  {isLoading ? '\u2013' : stats[stat.key as StatKey]}
                </div>
                <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-1.5">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Generic Shelves Section */}
        <ShelvesSection />

        {/* Watched Series */}
        <WatchedSeriesSection />

        {/* Watched Authors */}
        <WatchedAuthorsSection />

        {/* Active Downloads */}
        {activeDownloads.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Active Downloads
              </h2>
              <a
                href="/requests"
                className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                View All
              </a>
            </div>
            <div className="space-y-4">
              {activeDownloads.map((request: any) => (
                <RequestCard key={request.id} request={request} showActions={false} />
              ))}
            </div>
          </section>
        )}

        {/* Recent Requests */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Recent Requests
            </h2>
            {requests.length > 0 && (
              <a
                href="/requests"
                className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                View All
              </a>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 p-5 animate-pulse"
                >
                  <div className="flex gap-4">
                    <div className="w-20 h-28 bg-gray-100 dark:bg-gray-700/50 rounded-lg flex-shrink-0" />
                    <div className="flex-1 space-y-3 py-1">
                      <div className="h-6 bg-gray-100 dark:bg-gray-700/50 rounded w-3/4" />
                      <div className="h-4 bg-gray-100 dark:bg-gray-700/50 rounded w-1/2" />
                      <div className="h-6 bg-gray-100 dark:bg-gray-700/50 rounded w-24" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : recentRequests.length > 0 ? (
            <div className="space-y-4">
              {recentRequests.map((request: any) => (
                <RequestCard key={request.id} request={request} showActions={false} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700/50 py-16 text-center">
              <svg
                className="mx-auto w-10 h-10 text-gray-300 dark:text-gray-600 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
              </svg>
              <p className="text-base font-medium text-gray-500 dark:text-gray-400">
                No requests yet
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-600 mt-1">
                Search for audiobooks to get started
              </p>
              <a
                href="/search"
                className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                Search Audiobooks
              </a>
            </div>
          )}
        </section>

        {/* API Tokens */}
        <ApiTokensSection />
      </main>
    </div>
  );
}
