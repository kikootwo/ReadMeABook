/**
 * Component: Library page view (stats, toolbar, rail or sheet, chips, grid, detail)
 * Documentation: documentation/features/library-view.md
 *
 * Never decides permissions: it shows what GET /api/library returned for this viewer. The open
 * detail keeps a snapshot of its book, so an action or a settle that moves the book out of the
 * current filter never closes it.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoadMoreBar } from '@/components/ui/LoadMoreBar';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useLibrary } from '@/lib/hooks/useLibrary';
import { useLibraryQuery } from '@/lib/hooks/useLibraryQuery';
import type { LibraryItem } from '@/lib/library-view/types';
import { ActiveChips } from './ActiveChips';
import { FacetList } from './FacetList';
import { FilterSheet } from './FilterSheet';
import { LibraryDetail } from './LibraryDetail';
import { LibraryEmptyState, LoadErrorBar, NotConfiguredNotice } from './LibraryEmptyState';
import { LibraryGrid } from './LibraryGrid';
import { LibraryStats } from './LibraryStats';
import { LibraryToolbar } from './LibraryToolbar';

export function LibraryView() {
  const { user, accessToken } = useAuth();
  const prefs = usePreferences();
  const q = useLibraryQuery();
  const { query } = q;
  const data = useLibrary(query, prefs.hideAvailable, prefs.hydrated && !!accessToken);

  const [openId, setOpenId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LibraryItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The open book: the loaded card while it is on a page, else the last snapshot patched from live.
  const loadedOpen = useMemo(() => (openId ? data.items.find((i) => i.id === openId) ?? null : null), [openId, data.items]);
  if (loadedOpen && loadedOpen !== snapshot) setSnapshot(loadedOpen); // derived state, set while rendering
  const openItem = openId ? loadedOpen ?? (snapshot && snapshot.id === openId ? data.withLive(snapshot) : null) : null;

  const openDetail = useCallback((item: LibraryItem) => {
    setSnapshot(item);
    setOpenId(item.id);
  }, []);
  const closeDetail = useCallback(() => setOpenId(null), []);
  const { revalidate } = data;
  const onChanged = useCallback(() => void revalidate(), [revalidate]);

  // Requester ids the server does not know match nothing: drop them from the query and the URL.
  const { facets, lagging } = data;
  const { setRequestedBy } = q;
  useEffect(() => {
    if (!facets || lagging || query.requestedBy.length === 0) return;
    const known = new Set(facets.requestedBy.map((r) => r.userId));
    const kept = query.requestedBy.filter((id) => known.has(id));
    if (kept.length !== query.requestedBy.length) setRequestedBy(kept);
  }, [facets, lagging, query.requestedBy, setRequestedBy]);

  // A new query scrolls back to the top of the grid (only when scrolled past it).
  const gridTop = useRef<HTMLDivElement>(null);
  const listKey = JSON.stringify([query, prefs.hideAvailable]);
  const firstKey = useRef(listKey);
  useEffect(() => {
    if (listKey === firstKey.current) return;
    firstKey.current = listKey;
    const top = gridTop.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) gridTop.current?.scrollIntoView({ block: 'start' });
  }, [listKey]);

  const clearAll = useCallback(() => {
    q.clearAll();
    prefs.setHideAvailable(false);
  }, [q, prefs]);

  const isAdmin = data.viewer?.isAdmin ?? false;
  const activeFilterCount = query.status.length + query.source.length + query.requestedBy.length;
  const facetProps = {
    facets: data.facets,
    query,
    onToggleStatus: q.toggleStatus,
    onToggleSource: q.toggleSource,
    onToggleRequestedBy: q.toggleRequestedBy,
    onClearFacet: q.clearFacet,
  };

  let body: React.ReactNode;
  if (data.isLoading || (!data.loaded && !data.error)) {
    body = <LibraryGrid items={[]} group={query.group} groups={data.groups} cardSize={prefs.cardSize} squareCovers={prefs.squareCovers} isLoading onOpen={openDetail} />;
  } else if (!data.loaded) {
    body = <LibraryEmptyState kind="error" isAdmin={isAdmin} onRetry={data.retry} />;
  } else if ((data.stats?.total ?? 0) === 0) {
    body = <LibraryEmptyState kind="empty" isAdmin={isAdmin} />;
  } else if (data.matched === 0 && data.items.length === 0) {
    body = <LibraryEmptyState kind="no-match" isAdmin={isAdmin} onClearAll={clearAll} />;
  } else {
    body = (
      <div className={`space-y-6 transition-opacity ${data.lagging ? 'opacity-60' : ''}`} aria-busy={data.lagging}>
        {data.error && <LoadErrorBar onRetry={data.retry} />}
        <LibraryGrid
          items={data.items}
          group={query.group}
          groups={data.groups}
          cardSize={prefs.cardSize}
          squareCovers={prefs.squareCovers}
          isLoading={false}
          onOpen={openDetail}
        />
        <LoadMoreBar
          loadedCount={data.items.length}
          totalCount={data.matched}
          hasMore={data.hasMore}
          isLoading={data.isLoadingMore}
          onLoadMore={data.loadMore}
        />
      </div>
    );
  }

  return (
    <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl space-y-5 sm:space-y-6">
      <LibraryStats stats={data.stats} live={data.liveRefreshMs > 0} />
      {isAdmin && data.loaded && !data.libraryConfigured && <NotConfiguredNotice />}

      <LibraryToolbar
        input={q.input}
        onInput={q.setInput}
        sort={query.sort}
        onSort={q.setSort}
        group={query.group}
        onGroup={q.setGroup}
        activeFilterCount={activeFilterCount}
        onOpenFilters={() => setSheetOpen(true)}
        view={{
          hideAvailable: prefs.hideAvailable,
          onToggleHideAvailable: prefs.setHideAvailable,
          squareCovers: prefs.squareCovers,
          onToggleSquareCovers: prefs.setSquareCovers,
          cardSize: prefs.cardSize,
          onCardSizeChange: prefs.setCardSize,
        }}
      />

      <ActiveChips
        query={query}
        hideAvailable={prefs.hideAvailable}
        requesters={data.facets?.requestedBy ?? []}
        onClearSearch={q.clearSearch}
        onToggleStatus={q.toggleStatus}
        onToggleSource={q.toggleSource}
        onToggleRequestedBy={q.toggleRequestedBy}
        onShowAvailable={() => prefs.setHideAvailable(false)}
        onClearAll={clearAll}
      />

      <div className="flex gap-8 items-start" ref={gridTop} style={{ scrollMarginTop: '5rem' }}>
        <aside className="hidden lg:block w-[220px] flex-shrink-0 sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1" aria-label="Filters">
          <FacetList {...facetProps} />
        </aside>
        <div className="flex-1 min-w-0">{body}</div>
      </div>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        matched={data.matched}
        onClearAll={clearAll}
        {...facetProps}
      />

      <LibraryDetail
        item={openItem}
        viewer={data.viewer}
        user={user}
        live={!!openItem && data.liveIds.has(openItem.id)}
        onClose={closeDetail}
        onChanged={onChanged}
      />
    </main>
  );
}
