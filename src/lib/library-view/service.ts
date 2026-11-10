/**
 * Component: Library view service (full mode pipeline and live mode)
 * Documentation: documentation/features/library-view.md
 *
 * Full: load (rows from the snapshot cache, requests fresh) → merge → derive → filter/facet/sort/page → page enrichment → serialize per viewer.
 * Live: live audiobook requests only, mapped to entry ids without running the engine.
 */

import { ebookSourcesEnabled } from '@/lib/services/ebook-sources';
import { LIVE_FAST_REFRESH_MS, LIVE_FAST_STATUSES, LIVE_SLOW_REFRESH_MS } from './constants';
import { encodeCursor } from './cursor';
import { enrichPage } from './enrich';
import { loadDurations, loadLibraryRequests, loadLiveRequests, resolveActiveLibrary } from './loader';
import { applyDurations, mergeLibrary, requestOnlyAsins } from './merge';
import { getPreparedLibrary } from './snapshot';
import type { FullModeParams } from './params';
import { runQuery } from './query';
import { serializeItem } from './serialize';
import type { LibraryLiveItem, LibraryLiveResponse, LibraryResponse, LibraryViewer } from './types';

export async function getLibraryPage(params: FullModeParams, viewer: LibraryViewer): Promise<LibraryResponse> {
  const { backend, libraryId } = await resolveActiveLibrary();
  const [library, requests] = await Promise.all([getPreparedLibrary(backend, libraryId), loadLibraryRequests()]);

  const entries = mergeLibrary(library, requests);
  applyDurations(entries, await loadDurations(requestOnlyAsins(entries)));

  const result = runQuery(entries, params.filters, params.spec, params.cursorTuple, params.limit);
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

/** One item per book (its newest live request); poll faster while anything is moving. */
export async function getLibraryLive(now: number = Date.now()): Promise<LibraryLiveResponse> {
  const live = await loadLiveRequests(now);
  const seen = new Set<string>();
  const items: LibraryLiveItem[] = [];
  for (const r of live) {
    if (seen.has(r.audiobookId)) continue;
    seen.add(r.audiobookId);
    items.push({ id: `req_${r.audiobookId}`, status: r.status, progress: r.progress, updatedAt: r.updatedAt.toISOString() });
  }
  const fast = items.some((i) => (LIVE_FAST_STATUSES as readonly string[]).includes(i.status));
  return { items, refreshMs: items.length === 0 ? 0 : fast ? LIVE_FAST_REFRESH_MS : LIVE_SLOW_REFRESH_MS };
}
