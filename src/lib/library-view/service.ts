/**
 * Component: Library view service (full mode pipeline and live mode)
 * Documentation: documentation/features/library-view.md
 *
 * Full: row snapshot (snapshot.ts) + requests version → merged entries and query result (memo.ts) → page → page durations and enrichment → serialize per viewer.
 * Live: live audiobook requests whose book has no newer qualifying request, mapped to entry ids without running the engine.
 */

import { ebookSourcesEnabled } from '@/lib/services/ebook-sources';
import { LIVE_FAST_REFRESH_MS, LIVE_FAST_STATUSES, LIVE_SLOW_REFRESH_MS } from './constants';
import { encodeCursor } from './cursor';
import { enrichPage } from './enrich';
import { libraryRequestsVersion, loadBookRequests, loadLiveRequests, resolveActiveLibrary } from './loader';
import { fillPageDurations, getMergedLibrary, queryCoreFor } from './memo';
import { newestFirst } from './merge';
import { getPreparedLibrary } from './snapshot';
import type { FullModeParams } from './params';
import { pageOf } from './query';
import { serializeItem } from './serialize';
import type { LibraryLiveItem, LibraryLiveResponse, LibraryResponse, LibraryViewer } from './types';

export async function getLibraryPage(params: FullModeParams, viewer: LibraryViewer): Promise<LibraryResponse> {
  const { backend, libraryId } = await resolveActiveLibrary();
  const [library, requestsVersion] = await Promise.all([getPreparedLibrary(backend, libraryId), libraryRequestsVersion()]);
  const merged = await getMergedLibrary(library, requestsVersion);

  const core = await queryCoreFor(merged, params.filters, params.spec);
  const result = pageOf(core, params.spec, params.cursorTuple, params.limit);
  await fillPageDurations(merged, result.page);
  const [enrichment, canFetchEbook] = await Promise.all([
    enrichPage(result.page, viewer),
    viewer.isAdmin ? ebookSourcesEnabled() : Promise.resolve(undefined),
  ]);

  const viewerInfo: LibraryResponse['viewer'] = { isAdmin: viewer.isAdmin };
  if (viewer.isAdmin) viewerInfo.canFetchEbook = !!canFetchEbook;

  return {
    items: result.page.map((entry) => serializeItem(entry, viewer, enrichment)),
    nextCursor: result.nextTuple ? encodeCursor(params.scope, result.nextTuple) : null,
    matched: result.matched,
    stats: result.stats,
    facets: result.facets,
    groups: result.groups,
    viewer: viewerInfo,
    backend,
    libraryConfigured: !!libraryId,
  };
}

/**
 * One item per book whose primary request (full mode's choice: newest qualifying, ties by id) is
 * live. Library rows are not read: a card the list shows in the library stays as the list says.
 */
export async function getLibraryLive(now: number = Date.now()): Promise<LibraryLiveResponse> {
  const live = await loadLiveRequests(now);
  const primaryOf = new Map<string, { id: string; createdAt: Date }>();
  for (const r of await loadBookRequests([...new Set(live.map((r) => r.audiobookId))])) {
    const best = primaryOf.get(r.audiobookId);
    if (!best || newestFirst(r, best) < 0) primaryOf.set(r.audiobookId, r);
  }

  const items: LibraryLiveItem[] = [];
  for (const r of live) {
    if (primaryOf.get(r.audiobookId)?.id !== r.id) continue;
    items.push({ id: `req_${r.audiobookId}`, status: r.status, progress: r.progress, updatedAt: r.updatedAt.toISOString() });
  }
  const fast = items.some((i) => (LIVE_FAST_STATUSES as readonly string[]).includes(i.status));
  return { items, refreshMs: items.length === 0 ? 0 : fast ? LIVE_FAST_REFRESH_MS : LIVE_SLOW_REFRESH_MS };
}
