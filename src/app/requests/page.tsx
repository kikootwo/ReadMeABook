/**
 * Component: My Requests Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { RequestCard } from '@/components/requests/RequestCard';
import { useMyRequests, RequestFilterGroup, RequestCounts } from '@/lib/hooks/useRequests';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils/cn';

// ── Tab configuration ────────────────────────────────────────────────────────

interface TabOption {
  value: RequestFilterGroup;
  label: string;
  countKey: keyof RequestCounts;
}

const TABS: TabOption[] = [
  { value: 'all',       label: 'All',       countKey: 'all'       },
  { value: 'active',    label: 'Active',    countKey: 'active'    },
  { value: 'waiting',   label: 'Waiting',   countKey: 'waiting'   },
  { value: 'completed', label: 'Completed', countKey: 'completed' },
  { value: 'failed',    label: 'Failed',    countKey: 'failed'    },
  { value: 'cancelled', label: 'Cancelled', countKey: 'cancelled' },
];

// ── Count badge ──────────────────────────────────────────────────────────────

function CountBadge({ count, active }: { count: number; active: boolean }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold tabular-nums transition-all duration-200',
        active
          ? 'bg-blue-500/20 text-blue-600 dark:bg-blue-400/20 dark:text-blue-400'
          : 'bg-gray-200/80 text-gray-500 dark:bg-white/[0.07] dark:text-gray-400'
      )}
    >
      {count > 999 ? '999+' : count}
    </span>
  );
}

// ── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-800/60 rounded-xl overflow-hidden border border-gray-100 dark:border-white/[0.06]">
      <div className="flex gap-3 sm:gap-4 p-3 sm:p-4">
        {/* Cover placeholder */}
        <div className="flex-shrink-0 w-16 sm:w-24 aspect-[2/3] rounded-lg bg-gray-200 dark:bg-white/[0.06] animate-pulse" />
        {/* Content placeholder */}
        <div className="flex-1 min-w-0 space-y-3 pt-1">
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-white/[0.06] rounded-md animate-pulse w-3/4" />
            <div className="h-3 bg-gray-200 dark:bg-white/[0.06] rounded-md animate-pulse w-1/2" />
          </div>
          <div className="h-5 bg-gray-200 dark:bg-white/[0.06] rounded-full animate-pulse w-20" />
          <div className="pt-3 border-t border-gray-100 dark:border-white/[0.05]">
            <div className="h-3 bg-gray-200 dark:bg-white/[0.06] rounded animate-pulse w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: RequestFilterGroup }) {
  const isAll = filter === 'all';
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-5">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center">
        <svg
          className="w-8 h-8 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {isAll ? 'No requests yet' : `No ${filter} requests`}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
          {isAll
            ? 'Start by searching for audiobooks and requesting them'
            : `You don't have any ${filter} requests right now`}
        </p>
      </div>
      {isAll && (
        <a
          href="/search"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-xl transition-all duration-150 shadow-sm hover:shadow-md"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Browse Audiobooks
        </a>
      )}
    </div>
  );
}

// ── Load More button ─────────────────────────────────────────────────────────

function LoadMoreButton({ onClick, isLoading }: { onClick: () => void; isLoading: boolean }) {
  return (
    <div className="flex justify-center pt-2 pb-4">
      <button
        onClick={onClick}
        disabled={isLoading}
        className={cn(
          'inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
          'border border-gray-200 dark:border-white/[0.1]',
          'text-gray-700 dark:text-gray-300',
          'bg-white dark:bg-white/[0.04]',
          'hover:bg-gray-50 dark:hover:bg-white/[0.07]',
          'active:scale-[0.98]',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
          'shadow-sm'
        )}
      >
        {isLoading ? (
          <>
            <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading more...
          </>
        ) : (
          <>
            Load more
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>
    </div>
  );
}

// ── Live indicator ───────────────────────────────────────────────────────────

function LiveIndicator({ hasActive }: { hasActive: boolean }) {
  if (!hasActive) return null;
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
      </span>
      Live
    </div>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────────────

interface TabBarProps {
  filter: RequestFilterGroup;
  counts: RequestCounts;
  countsLoaded: boolean;
  onChange: (f: RequestFilterGroup) => void;
}

function TabBar({ filter, counts, countsLoaded, onChange }: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view on mount/change
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector('[data-active="true"]') as HTMLElement | null;
    if (active) {
      const { offsetLeft, offsetWidth } = active;
      const { scrollLeft, clientWidth } = container;
      if (offsetLeft < scrollLeft || offsetLeft + offsetWidth > scrollLeft + clientWidth) {
        container.scrollTo({ left: offsetLeft - 16, behavior: 'smooth' });
      }
    }
  }, [filter]);

  return (
    <div className="relative -mx-4 sm:mx-0">
      {/* Left fade */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white dark:from-gray-950 to-transparent z-10 sm:hidden" />
      {/* Right fade */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white dark:from-gray-950 to-transparent z-10 sm:hidden" />

      <div
        ref={scrollRef}
        className="flex gap-1 overflow-x-auto scrollbar-hide px-4 sm:px-0"
        role="tablist"
      >
        {TABS.map((tab) => {
          const isActive = filter === tab.value;
          const count = counts[tab.countKey];
          // Hide tabs with 0 count unless it's 'all' or currently active
          if (!isActive && tab.value !== 'all' && countsLoaded && count === 0) return null;
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={isActive}
              data-active={isActive}
              onClick={() => onChange(tab.value)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none flex-shrink-0',
                'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                isActive
                  ? 'bg-white dark:bg-white/[0.08] text-gray-900 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_6px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)] border border-gray-200/80 dark:border-white/[0.1]'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
              )}
            >
              {tab.label}
              {countsLoaded
                ? <CountBadge count={count} active={isActive} />
                : tab.value !== 'all' && (
                    <span className="inline-block w-5 h-3.5 rounded bg-gray-200 dark:bg-white/[0.07] animate-pulse" />
                  )
              }
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Showing count bar ────────────────────────────────────────────────────────

function ShowingBar({ showing, total, hasActive }: { showing: number; total: number; hasActive: boolean }) {
  if (showing === 0) return null;
  return (
    <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 px-0.5">
      <span>
        Showing <span className="text-gray-600 dark:text-gray-300 font-medium tabular-nums">{showing}</span>
        {' of '}
        <span className="text-gray-600 dark:text-gray-300 font-medium tabular-nums">{total}</span>
        {total === 1 ? ' request' : ' requests'}
      </span>
      <LiveIndicator hasActive={hasActive} />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function RequestsPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<RequestFilterGroup>('all');

  const {
    requests,
    counts,
    hasMore,
    isLoading,
    isLoadingMore,
    isEmpty,
    loadMore,
  } = useMyRequests(filter);

  const countsLoaded = !isLoading || requests.length > 0;
  const totalForFilter = counts[filter === 'all' ? 'all' : filter as keyof RequestCounts] ?? 0;
  const hasActiveRequests = requests.some(r =>
    ['pending', 'awaiting_search', 'awaiting_approval', 'searching', 'downloading', 'processing', 'awaiting_import'].includes(r.status)
  );

  const handleFilterChange = (f: RequestFilterGroup) => {
    setFilter(f);
  };

  // ── Unauthenticated ────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Authentication Required</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Please log in to view your audiobook requests</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Authenticated ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-6 sm:py-10 max-w-4xl">

        {/* Page header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
            My Requests
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Track the status of your audiobook requests in real-time
          </p>
        </div>

        {/* Tab bar */}
        <div className="mb-5">
          <TabBar
            filter={filter}
            counts={counts}
            countsLoaded={countsLoaded}
            onChange={handleFilterChange}
          />
        </div>

        {/* Showing bar */}
        {!isLoading && requests.length > 0 && (
          <div className="mb-4">
            <ShowingBar
              showing={requests.length}
              total={totalForFilter}
              hasActive={hasActiveRequests}
            />
          </div>
        )}

        {/* Loading state — skeleton cards */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                style={{ animationDelay: `${i * 60}ms` }}
                className="animate-[fadeIn_0.3s_ease-out_both]"
              >
                <SkeletonCard />
              </div>
            ))}
          </div>
        )}

        {/* Request list */}
        {!isLoading && requests.length > 0 && (
          <div className="space-y-3">
            {requests.map((request, i) => (
              <div
                key={request.id}
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                className="animate-[fadeInUp_0.25s_ease-out_both]"
              >
                <RequestCard request={request} showActions={true} />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && isEmpty && (
          <EmptyState filter={filter} />
        )}

        {/* Load more */}
        {!isLoading && hasMore && (
          <div className="mt-4">
            <LoadMoreButton onClick={loadMore} isLoading={isLoadingMore} />
          </div>
        )}

        {/* Load more skeleton (when fetching additional pages) */}
        {isLoadingMore && (
          <div className="mt-3 space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <SkeletonCard key={`more-${i}`} />
            ))}
          </div>
        )}

      </main>
    </div>
  );
}
